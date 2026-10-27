import { app, BrowserWindow, ipcMain, session, desktopCapturer, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chatSession } from './core/chatSession'
import { geminiAudioToTextStream } from './core/geminiAudio'
import { geminiTextToSpeech } from './core/tts'
import { startSystemMonitor } from './actions/systemMonitor'
import {
  getTtsInTextChat, saveTtsInTextChat,
  getCommandPrefix, saveCommandPrefix,
  getVoiceProfile, saveVoiceProfile,
} from './core/configManager'
import { startRemoteServer } from './core/remoteServer'
import { saveDownloadHistory, loadDownloadHistory } from './core/downloadHistory'
import {
  notifyDesktopDeviceStatus,
  sendTestPushNotification,
  setActiveNotificationUser,
} from './core/pushNotifications'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

// ── Core modules ──────────────────────────────────────────────────────────
import { geminiText, geminiJson, FAST } from './core/gemini'
import { callLlm, callLlmText, getLlmProvider } from './core/llmClient'
import {
  getGeminiKey, saveApiKeys, isConfigured,
  getAssistantName, getUserName, saveAssistantConfig,
  getVoice, saveVoice, AVAILABLE_VOICES,
} from './core/configManager'

// ── Memory module ─────────────────────────────────────────────────────────
import {
  loadMemory, updateMemory, remember, forget,
  searchMemory, allEntriesForUI,
  saveSessionSummary, popLastSession,
  formatMemoryForPrompt,
} from './memory/memoryManager'

import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './core/firebase'
import { networkInterfaces } from 'node:os'

let heartbeatInterval: NodeJS.Timeout | null = null
let activeDesktopUserId: string | null = null
const pendingChatAcknowledgments = new Map<string, {
  senderId: number
  resolve: () => void
  timeout: NodeJS.Timeout
}>()

function emitChatAcknowledgment(
  sender: WebContents,
  text: string,
  requiresPlayback: boolean,
): Promise<void> {
  const id = randomUUID()
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingChatAcknowledgments.delete(id)
      console.warn('[Chat] Acknowledgment was not confirmed; continuing with the command')
      resolve()
    }, 15_000)
    pendingChatAcknowledgments.set(id, { senderId: sender.id, resolve, timeout })
    sender.send('chat:acknowledgment', { id, text, requiresPlayback })
  })
}
let setCurrentDeviceOffline: (() => Promise<void>) | null = null
let allowQuitAfterOfflineSync = false

app.on('before-quit', (event) => {
  if (allowQuitAfterOfflineSync || !setCurrentDeviceOffline) return

  event.preventDefault()
  const setOffline = setCurrentDeviceOffline
  void setOffline()
    .catch((error: unknown) => console.error('[Main] Could not sync offline status before quit:', error))
    .finally(() => {
      allowQuitAfterOfflineSync = true
      app.quit()
    })
})

function getLocalIPv4Addresses() {
  return [...new Set(
    Object.values(networkInterfaces())
      .flatMap((addresses) => addresses ?? [])
      .filter((address) => {
        if (address.internal || (address.family !== 'IPv4' && address.family !== 4)) return false
        const octets = address.address.split('.').map(Number)
        if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
        return octets[0] === 10
          || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
          || (octets[0] === 192 && octets[1] === 168)
      })
      .map((address) => address.address),
  )]
}

function setOnlineStatus(userId: string) {
  if (!userId) return

  if (activeDesktopUserId === userId && heartbeatInterval) return

  if (heartbeatInterval) clearInterval(heartbeatInterval)
  activeDesktopUserId = userId
  let onlineNotificationSent = false
  let offlinePromise: Promise<void> | null = null
  const deviceRef = doc(db, 'devices', userId)

  const setOffline = (): Promise<void> => {
    if (offlinePromise) return offlinePromise
    if (activeDesktopUserId !== userId) return Promise.resolve()

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval)
      heartbeatInterval = null
    }
    offlinePromise = (async () => {
      await setDoc(deviceRef, {
        status: 'offline',
        localIps: [],
        lastSeen: serverTimestamp(),
        platform: 'desktop'
      }, { merge: true })
      activeDesktopUserId = null
      setCurrentDeviceOffline = null
      console.log('[Main] 📴 Status set to offline')
      if (onlineNotificationSent) {
        try {
          await notifyDesktopDeviceStatus(userId, 'offline')
        } catch (error) {
          console.error('[Main] Could not send laptop-offline notification:', error)
        }
      }
    })().finally(() => {
      offlinePromise = null
    })
    return offlinePromise
  }

  const updateOnlineStatus = () => setDoc(deviceRef, {
    status: 'online',
    localIps: getLocalIPv4Addresses(),
    lastSeen: serverTimestamp(),
    platform: 'desktop'
  }, { merge: true })

  setCurrentDeviceOffline = setOffline

  updateOnlineStatus()
  .then(async () => {
    console.log(`[Main] ✅ Status set to online for: ${userId}`)
    if (activeDesktopUserId !== userId || onlineNotificationSent) return
    onlineNotificationSent = true
    try {
      await notifyDesktopDeviceStatus(userId, 'online')
    } catch (error) {
      console.error('[Main] Could not send laptop-online notification:', error)
    }
  })
  .catch((e) => console.error('[Main] Failed to set online:', e))

  heartbeatInterval = setInterval(() => {
    updateOnlineStatus().catch((error) => console.error('[Main] Failed to refresh online status:', error))
  }, 5000)

  win?.once('closed', () => {
    void setOffline().catch((error: unknown) => console.error('[Main] Could not sync offline status:', error))
  })
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC || '', 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(process.env.APP_ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function registerIpcHandlers() {
  ipcMain.on('chat:acknowledgment-played', (event, id: unknown) => {
    if (typeof id !== 'string') return
    const pending = pendingChatAcknowledgments.get(id)
    if (!pending || pending.senderId !== event.sender.id) return

    clearTimeout(pending.timeout)
    pendingChatAcknowledgments.delete(id)
    pending.resolve()
  })

  ipcMain.handle('push:test', () => sendTestPushNotification())

  ipcMain.handle('config:is-configured', () => isConfigured())
  ipcMain.handle('config:get-key', () => getGeminiKey())
  ipcMain.handle('config:save-key', (_e, key: string) => { saveApiKeys(key); return true })
  ipcMain.handle('config:get-assistant-name', () => getAssistantName())
  ipcMain.handle('config:get-user-name', () => getUserName())
  ipcMain.handle('config:save-assistant', (_e, a: string, u: string) => { saveAssistantConfig(a, u); return true })
  ipcMain.handle('config:get-voice', () => getVoice())
  ipcMain.handle('config:get-voices', () => AVAILABLE_VOICES)
  ipcMain.handle('config:save-voice', (_e, v: string) => { saveVoice(v); return true })

  ipcMain.handle('download:get-history', () => loadDownloadHistory())
  ipcMain.handle('download:save-history', (_e, history) => { saveDownloadHistory(history); return true })

  ipcMain.on('download:progress', (event, data) => {
    BrowserWindow.getAllWindows().forEach(w => { w.webContents.send('download:progress', data) })
  })

  ipcMain.handle('config:get-tts-text-chat', () => getTtsInTextChat())
  ipcMain.handle('config:save-tts-text-chat', (_e, enabled: boolean) => { saveTtsInTextChat(enabled); return true })

  ipcMain.handle('config:get-command-prefix', () => getCommandPrefix())
  ipcMain.handle('config:save-command-prefix', (_e, prefix: string) => {
    saveCommandPrefix(prefix)
    const cleanPrefix = String(prefix || '').trim() || 'Jarvis'
    BrowserWindow.getAllWindows().forEach((w) => { w.webContents.send('command-prefix:changed', cleanPrefix) })
    return true
  })

  ipcMain.handle('config:get-voice-profile', () => getVoiceProfile())
  ipcMain.handle('config:save-voice-profile', (_e, profile: any) => {
    saveVoiceProfile(profile)
    BrowserWindow.getAllWindows().forEach((w) => { w.webContents.send('voice-profile:changed', profile) })
    return true
  })
  ipcMain.handle('config:delete-voice-profile', () => {
    saveVoiceProfile(null)
    BrowserWindow.getAllWindows().forEach((w) => { w.webContents.send('voice-profile:changed', null) })
    return true
  })

  ipcMain.handle('chat:send', async (event, message: string) => {
    return await chatSession.send(message, (ackText) =>
      emitChatAcknowledgment(event.sender, ackText, false))
  })
  ipcMain.handle('chat:history', () => chatSession.getHistory())
  ipcMain.handle('chat:clear', () => { chatSession.clearHistory(); return true })

  ipcMain.handle('chat:send-stream', async (event, message: string) => {
    return await chatSession.sendStream(
      message,
      (chunk, done) => { event.sender.send('chat:chunk', { chunk, done }) },
      (ackText) => emitChatAcknowledgment(event.sender, ackText, true),
    )
  })

  ipcMain.handle('audio:to-text-stream', async (event, base64Audio, mimeType) => {
    try {
      const reply = await geminiAudioToTextStream(base64Audio, mimeType, (chunk) => { event.sender.send('audio:chunk', chunk) })
      return { ok: true, reply }
    } catch (e: any) { return { ok: false, error: e?.message || String(e) } }
  })

  ipcMain.handle('tts:speak', async (_e, text: string, voice?: string) => {
    try {
      const audioBase64 = await geminiTextToSpeech(text, voice)
      return { ok: true, audioBase64 }
    } catch (e: any) { return { ok: false, error: e?.message || String(e) } }
  })

  ipcMain.handle('gemini:text', async (_e, contents: any, tier: string = FAST) => await geminiText(contents, tier))
  ipcMain.handle('gemini:json', async (_e, contents: any, tier: string = FAST) => await geminiJson(contents, tier))
  ipcMain.handle('gemini:test', async () => {
    try { const reply = await geminiText('Reply with exactly: Hello from Gemini', FAST); return { ok: true, reply } }
    catch (e: any) { return { ok: false, error: e?.message || String(e) } }
  })

  ipcMain.handle('llm:provider', () => getLlmProvider())
  ipcMain.handle('llm:text', async (_e, prompt: string, system?: string) => await callLlmText(prompt, system || null))
  ipcMain.handle('llm:chat', async (_e, messages: any[], tools?: any[]) => await callLlm(messages, tools || null))

  ipcMain.handle('memory:load', () => loadMemory())
  ipcMain.handle('memory:update', (_e, update: Record<string, any>) => updateMemory(update))
  ipcMain.handle('memory:remember', (_e, key: string, value: string, category?: string) => remember(key, value, category))
  ipcMain.handle('memory:forget', (_e, key: string, category?: string) => forget(key, category))
  ipcMain.handle('memory:search', (_e, query: string, limit?: number) => searchMemory(query, limit))
  ipcMain.handle('memory:all-entries', () => allEntriesForUI())
  ipcMain.handle('memory:save-session', (_e, summary: string, language?: string) => saveSessionSummary(summary, language || ''))
  ipcMain.handle('memory:pop-session', () => popLastSession())
  ipcMain.handle('memory:format-prompt', () => formatMemoryForPrompt(loadMemory()))
  
  ipcMain.handle('user:logged-in', async (_e, userId: string) => {
    if (userId) {
      setActiveNotificationUser(userId)
      setOnlineStatus(userId)
    } else {
      await setCurrentDeviceOffline?.()
      setActiveNotificationUser(null)
    }
    return true
  })

  // ✅ NAYA: Screen Source ID lene ka handler
  ipcMain.handle('get-screen-source', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    if (sources.length > 0) {
      return sources[0].id
    }
    return null
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') { callback(true) } else { callback(false) }
  })

  startRemoteServer()
  startSystemMonitor()
  registerIpcHandlers()
  createWindow()
})
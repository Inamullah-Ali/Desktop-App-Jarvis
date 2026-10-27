// electron/core/remoteServer.ts
import { collection, query, where, onSnapshot, addDoc, getDocs, updateDoc, type DocumentReference } from 'firebase/firestore'
import { db } from './firebase'
import { chatSession } from './chatSession'
import { WebSocketServer, WebSocket } from 'ws'
import { BrowserWindow, ipcMain } from 'electron'

// Nut.js ko dynamic import kar rahe hain (Vite build issue se bachne ke liye)
let nutModule: any = null
async function getNut() {
  if (!nutModule) {
    nutModule = await import('@nut-tree-fork/nut-js')
  }
  return nutModule
}

const APP_START_TIME = Date.now()
const TWO_MINUTES_AGO = APP_START_TIME - 2 * 60 * 1000

const activeListeners = new Set<string>()
const processedMessageIds = new Set<string>()
const processedCommandIds = new Set<string>()

function waitForMobileAcknowledgment(acknowledgmentRef: DocumentReference): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {}
    const timeout = setTimeout(() => {
      unsubscribe()
      console.warn('[Remote] Mobile acknowledgment was not confirmed; continuing with the command')
      resolve()
    }, 15_000)

    unsubscribe = onSnapshot(
      acknowledgmentRef,
      (snapshot) => {
        if (snapshot.data()?.acknowledged !== true) return
        clearTimeout(timeout)
        unsubscribe()
        resolve()
      },
      (error) => {
        clearTimeout(timeout)
        unsubscribe()
        reject(error)
      },
    )
  })
}

let wss: WebSocketServer | null = null

// ✅ WebRTC signaling ke liye active WebSocket connections
const activeWsClients = new Set<WebSocket>()

export function startRemoteServer() {
  console.log('[Remote] 🚀 Firebase Listener Started')

  // ✅ 1. Local WebSocket Server
  wss = new WebSocketServer({ port: 8080 })
  console.log('[Remote] ⚡ Local WebSocket Server running on ws://0.0.0.0:8080')

  wss.on('connection', (ws) => {
    console.log('[Remote] 📱 Mobile connected via Local WebSocket')
    activeWsClients.add(ws)

    ws.on('close', () => {
      console.log('[Remote] 📴 Mobile disconnected from WebSocket')
      activeWsClients.delete(ws)
    })

    ws.on('message', async (data) => {
      try {
        const cmdData = JSON.parse(data.toString())

        // ═══ WebRTC Signaling (Mobile → Desktop Renderer) ═══
        if (cmdData.type === 'webrtc_offer') {
          console.log('[Remote] 📺 WebRTC Offer received from Mobile')
          BrowserWindow.getAllWindows().forEach(w => {
            w.webContents.send('webrtc_offer', cmdData.offer)
          })
          return
        }

        if (cmdData.type === 'webrtc_ice') {
          console.log('[Remote] 🧊 WebRTC ICE received from Mobile')
          BrowserWindow.getAllWindows().forEach(w => {
            w.webContents.send('webrtc_ice', cmdData.candidate)
          })
          return
        }

        // ═══ Mouse/Keyboard Commands ═══
        await executeCommand(cmdData, true)
      } catch (err) {
        console.error('[WS Command Error]:', err)
      }
    })
  })

  // ✅ 2. IPC Handlers (React se answer/ice receive karke mobile ko bhejna)
  ipcMain.handle('webrtc:send-answer', (_e, answer) => {
    console.log('[Remote] 📤 Sending WebRTC Answer to Mobile')
    let sent = false
    activeWsClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'webrtc_answer', answer }))
        sent = true
      }
    })
    if (!sent) throw new Error('No active mobile WebSocket connection to receive the WebRTC answer')
    return true
  })

  ipcMain.handle('webrtc:send-ice', (_e, candidate) => {
    console.log('[Remote] 📤 Sending ICE candidate to Mobile')
    let sent = false
    activeWsClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'webrtc_ice', candidate }))
        sent = true
      }
    })
    if (!sent) throw new Error('No active mobile WebSocket connection to receive the ICE candidate')
    return true
  })

  // ✅ 3. Firebase Listener
  const qSessions = query(
    collection(db, 'pairing_sessions'),
    where('status', '==', 'paired')
  )

  onSnapshot(qSessions, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added' || change.type === 'modified') {
        const sessionData = change.doc.data()
        const userId = sessionData.userId

        if (!userId) return
        if (activeListeners.has(userId)) return
        activeListeners.add(userId)

        console.log(`[Remote] 👂 Starting listener for user: ${userId}`)

        listenToMessagesForUser(userId)
        listenToCommandsForUser(userId)
        processPendingMessages(userId)
      }
    })
  })
}

// ══════════════════════════════════════════════════════════════════════════
// ✅ CORE COMMAND EXECUTOR (Mouse, Keyboard, Scroll, Drag)
// ══════════════════════════════════════════════════════════════════════════
async function executeCommand(cmdData: any, isLocal: boolean) {
  try {
    const nut = await getNut()
    const { mouse, keyboard, Point, Button, Key } = nut

    mouse.config.mouseSpeed = isLocal ? 6000 : 3000
    console.log(`[Remote] 🖱️ Executing: ${cmdData.type}`)

    if (cmdData.type === 'mouse_move') {
      const currentPos = await mouse.getPosition()
      await mouse.setPosition(new Point(
        currentPos.x + Math.round(cmdData.dx),
        currentPos.y + Math.round(cmdData.dy)
      ))
    }
    else if (cmdData.type === 'click') {
      const btn = cmdData.button === 'right' ? Button.RIGHT
        : (cmdData.button === 'middle' ? Button.MIDDLE : Button.LEFT)
      await mouse.click(btn)
    }
    else if (cmdData.type === 'mouse_down') {
      await mouse.pressButton(Button.LEFT)
    }
    else if (cmdData.type === 'mouse_up') {
      await mouse.releaseButton(Button.LEFT)
    }
    else if (cmdData.type === 'scroll') {
      if (cmdData.dy > 0) await mouse.scrollDown(cmdData.dy)
      else await mouse.scrollUp(Math.abs(cmdData.dy))
    }
    else if (cmdData.type === 'type') {
      await keyboard.type(cmdData.text)
    }
    else if (cmdData.type === 'key') {
      if (cmdData.key === 'ENTER') await keyboard.pressKey(Key.Enter)
      else if (cmdData.key === 'ESC') await keyboard.pressKey(Key.Escape)
      else if (cmdData.key === 'TAB') await keyboard.pressKey(Key.Tab)
    }
  } catch (err: any) {
    console.error('[Remote] Command execution failed:', err?.message || err)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ✅ FIREBASE COMMANDS LISTENER (Cloud Fallback)
// ══════════════════════════════════════════════════════════════════════════
function listenToCommandsForUser(userId: string) {
  const q = query(
    collection(db, 'commands'),
    where('userId', '==', userId)
  )

  onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === 'added') {
        const cmdData = change.doc.data()
        const cmdId = change.doc.id

        if (cmdData.processed) return
        if (
          typeof cmdData.timestamp !== 'number'
          || !Number.isFinite(cmdData.timestamp)
          || cmdData.timestamp <= APP_START_TIME
        ) {
          console.log(`[Remote] Discarding stale offline command: ${cmdId}`)
          try {
            await updateDoc(change.doc.ref, { processed: true })
          } catch (error) {
            console.error(`[Remote] Could not discard stale offline command ${cmdId}:`, error)
          }
          return
        }
        if (processedCommandIds.has(cmdId)) return
        processedCommandIds.add(cmdId)

        try {
          await executeCommand(cmdData, false)
          await updateDoc(change.doc.ref, { processed: true })
        } catch (err: any) {
          console.error('[Remote Command Error]:', err?.message || err)
        }
      }
    })
  })
}

// ══════════════════════════════════════════════════════════════════════════
// ✅ CHAT MESSAGES LISTENER
// ══════════════════════════════════════════════════════════════════════════
function listenToMessagesForUser(userId: string) {
  const q = query(
    collection(db, 'messages'),
    where('userId', '==', userId)
  )

  onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === 'added') {
        const msgData = change.doc.data()
        const msgId = change.doc.id

        if (msgData.from !== 'phone') return
        if (msgData.timestamp < APP_START_TIME) return
        if (msgData.processed) return
        if (processedMessageIds.has(msgId)) return

        processedMessageIds.add(msgId)
        console.log(`[Remote] 📱 New message: ${msgData.content}`)

        try {
          const reply = await chatSession.send(msgData.content, async (acknowledgment) => {
            const acknowledgmentRef = await addDoc(collection(db, 'messages'), {
              userId,
              from: 'desktop',
              role: 'assistant',
              kind: 'acknowledgment',
              content: acknowledgment,
              timestamp: Date.now(),
              replyTo: msgId,
              inputMode: msgData.inputMode || 'text',
              acknowledged: false,
            })
            await waitForMobileAcknowledgment(acknowledgmentRef)
          })
          await addDoc(collection(db, 'messages'), {
            userId: userId,
            from: 'desktop',
            role: 'assistant',
            content: reply.text,
            timestamp: Date.now(),
            processed: true,
            replyTo: msgId
          })
          await updateDoc(change.doc.ref, { processed: true })
          console.log('[Remote] ✅ Reply sent')
        } catch (e) {
          console.error('[Remote] Error:', e)
        }
      }
    })
  })
}

// ══════════════════════════════════════════════════════════════════════════
// ✅ OFFLINE QUEUE PROCESS
// ══════════════════════════════════════════════════════════════════════════
async function processPendingMessages(userId: string) {
  console.log('[Remote] 🔄 Checking for pending messages...')

  try {
    const q = query(
      collection(db, 'messages'),
      where('userId', '==', userId),
      where('from', '==', 'phone'),
      where('processed', '==', false)
    )

    const snapshot = await getDocs(q)

    const recentMessages = snapshot.docs
      .filter((doc) => {
        const data = doc.data()
        return data.timestamp >= TWO_MINUTES_AGO && data.timestamp <= APP_START_TIME
      })
      .sort((a, b) => a.data().timestamp - b.data().timestamp)

    if (recentMessages.length === 0) {
      console.log('[Remote] ✅ No pending messages found.')
      return
    }

    for (const doc of recentMessages) {
      if (processedMessageIds.has(doc.id)) continue
      processedMessageIds.add(doc.id)

      console.log(`[Remote] 📱 Processing offline message: ${doc.data().content}`)
      try {
        const messageData = doc.data()
        const reply = await chatSession.send(messageData.content, async (acknowledgment) => {
          const acknowledgmentRef = await addDoc(collection(db, 'messages'), {
            userId,
            from: 'desktop',
            role: 'assistant',
            kind: 'acknowledgment',
            content: acknowledgment,
            timestamp: Date.now(),
            replyTo: doc.id,
            inputMode: messageData.inputMode || 'text',
            acknowledged: false,
          })
          await waitForMobileAcknowledgment(acknowledgmentRef)
        })
        await addDoc(collection(db, 'messages'), {
          userId: userId,
          from: 'desktop',
          role: 'assistant',
          content: reply.text,
          timestamp: Date.now(),
          processed: true,
          replyTo: doc.id
        })
        await updateDoc(doc.ref, { processed: true })
      } catch (e) {
        console.error('[Remote] Error processing offline message:', e)
      }
    }
  } catch (error: any) {
    console.log('[Remote] ⚠️ Pending query error:', error.message?.slice(0, 100))
  }
}
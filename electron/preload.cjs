const { ipcRenderer, contextBridge } = require('electron')

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...callbackArgs) => listener(event, ...callbackArgs))
  },
  off(...args) {
    const [channel, ...remainingArgs] = args
    return ipcRenderer.off(channel, ...remainingArgs)
  },
  send(...args) {
    const [channel, ...remainingArgs] = args
    return ipcRenderer.send(channel, ...remainingArgs)
  },
  invoke(...args) {
    const [channel, ...remainingArgs] = args
    return ipcRenderer.invoke(channel, ...remainingArgs)
  },
})

contextBridge.exposeInMainWorld('jarvis', {
  testPushNotification: () => ipcRenderer.invoke('push:test'),

  // ── Config ─────────────────────────────────────────────────────────────
  isConfigured: () => ipcRenderer.invoke('config:is-configured'),
  getKey: () => ipcRenderer.invoke('config:get-key'),
  saveKey: (key) => ipcRenderer.invoke('config:save-key', key),
  getAssistantName: () => ipcRenderer.invoke('config:get-assistant-name'),
  getUserName: () => ipcRenderer.invoke('config:get-user-name'),
  saveAssistant: (assistant, user) => ipcRenderer.invoke('config:save-assistant', assistant, user),
  getVoice: () => ipcRenderer.invoke('config:get-voice'),
  getVoices: () => ipcRenderer.invoke('config:get-voices'),
  saveVoice: (voice) => ipcRenderer.invoke('config:save-voice', voice),

  // ── TTS in text chat ───────────────────────────────────────────────────
  getTtsInTextChat: () => ipcRenderer.invoke('config:get-tts-text-chat'),
  saveTtsInTextChat: (enabled) => ipcRenderer.invoke('config:save-tts-text-chat', enabled),

    getScreenSource: () => ipcRenderer.invoke('get-screen-source'),

  // ✅ Command prefix
  getCommandPrefix: () => ipcRenderer.invoke('config:get-command-prefix'),
  saveCommandPrefix: (prefix) => ipcRenderer.invoke('config:save-command-prefix', prefix),

  // ✅ Command prefix change listener (event-based sync)
  onCommandPrefixChanged: (callback) => {
    const handler = (_event, prefix) => callback(prefix)
    ipcRenderer.on('command-prefix:changed', handler)
    return () => ipcRenderer.off('command-prefix:changed', handler)
  },

  // ✅ Voice Profile (Speaker Verification)
  getVoiceProfile: () => ipcRenderer.invoke('config:get-voice-profile'),
  saveVoiceProfile: (profile) => ipcRenderer.invoke('config:save-voice-profile', profile),
  deleteVoiceProfile: () => ipcRenderer.invoke('config:delete-voice-profile'),
  onVoiceProfileChanged: (callback) => {
    const handler = (_event, profile) => callback(profile)
    ipcRenderer.on('voice-profile:changed', handler)
    return () => ipcRenderer.off('voice-profile:changed', handler)
  },

  // ✅ Streaming chat
  chatSendStream: (message) => ipcRenderer.invoke('chat:send-stream', message),
  onChatChunk: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('chat:chunk', handler)
    return () => ipcRenderer.off('chat:chunk', handler)
  },

  onDownloadProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('download:progress', handler)
    return () => ipcRenderer.off('download:progress', handler)
  },

  // ✅ Download History APIs
  getDownloadHistory: () => ipcRenderer.invoke('download:get-history'),
  saveDownloadHistory: (history) => ipcRenderer.invoke('download:save-history', history),

  // ── Gemini ─────────────────────────────────────────────────────────────
  geminiText: (contents, tier) => ipcRenderer.invoke('gemini:text', contents, tier),
  geminiJson: (contents, tier) => ipcRenderer.invoke('gemini:json', contents, tier),
  geminiTest: () => ipcRenderer.invoke('gemini:test'),

  // ── Local LLM ──────────────────────────────────────────────────────────
  llmProvider: () => ipcRenderer.invoke('llm:provider'),
  llmText: (prompt, system) => ipcRenderer.invoke('llm:text', prompt, system),
  llmChat: (messages, tools) => ipcRenderer.invoke('llm:chat', messages, tools),

  // ── System alerts ──────────────────────────────────────────────────────
  onSystemAlert: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('system:alert', handler)
    return () => ipcRenderer.off('system:alert', handler)
  },

  userLoggedIn: (userId) => ipcRenderer.invoke('user:logged-in', userId),

  // ── Memory ─────────────────────────────────────────────────────────────
  memoryLoad: () => ipcRenderer.invoke('memory:load'),
  memoryUpdate: (update) => ipcRenderer.invoke('memory:update', update),
  memoryRemember: (key, value, category) => ipcRenderer.invoke('memory:remember', key, value, category),
  memoryForget: (key, category) => ipcRenderer.invoke('memory:forget', key, category),
  memorySearch: (query, limit) => ipcRenderer.invoke('memory:search', query, limit),
  memoryAllEntries: () => ipcRenderer.invoke('memory:all-entries'),
  memorySaveSession: (summary, language) => ipcRenderer.invoke('memory:save-session', summary, language),
  memoryPopSession: () => ipcRenderer.invoke('memory:pop-session'),
  memoryFormatPrompt: () => ipcRenderer.invoke('memory:format-prompt'),

  // ── Chat ───────────────────────────────────────────────────────────────
  onChatAcknowledgment: (callback) => {
    const handler = (_event, acknowledgment) => callback(acknowledgment)
    ipcRenderer.on('chat:acknowledgment', handler)
    return () => ipcRenderer.off('chat:acknowledgment', handler)
  },
  chatAcknowledgmentPlayed: (id) => ipcRenderer.send('chat:acknowledgment-played', id),

  chatSend: (message) => ipcRenderer.invoke('chat:send', message),
  chatHistory: () => ipcRenderer.invoke('chat:history'),
  chatClear: () => ipcRenderer.invoke('chat:clear'),

  // ── Audio ──────────────────────────────────────────────────────────────
  audioToTextStream: (base64Audio, mimeType) =>
    ipcRenderer.invoke('audio:to-text-stream', base64Audio, mimeType),
  onAudioChunk: (callback) => {
    const handler = (_event, chunk) => callback(chunk)
    ipcRenderer.on('audio:chunk', handler)
    return () => ipcRenderer.off('audio:chunk', handler)
  },

  // ✅ Reminder TTS
  onReminderSpeak: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('reminder:speak', handler)
    return () => ipcRenderer.off('reminder:speak', handler)
  },

  // ── TTS ────────────────────────────────────────────────────────────────
  ttsSpeak: (text, voice) => ipcRenderer.invoke('tts:speak', text, voice),

  // ── Reminders ──────────────────────────────────────────────────────────
  onReminderFired: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('reminder:fired', handler)
    return () => ipcRenderer.off('reminder:fired', handler)
  },

  // ══════════════════════════════════════════════════════════════════════
  // ✅ WEBRTC SCREEN SHARING FUNCTIONS (NAYA)
  // ══════════════════════════════════════════════════════════════════════

  // Mobile se aane wala Offer React ko bhejna
  onWebRtcOffer: (callback) => {
    const handler = (_event, offer) => callback(offer)
    ipcRenderer.on('webrtc_offer', handler)
    return () => ipcRenderer.off('webrtc_offer', handler)
  },

  // Mobile se aane wala ICE candidate React ko bhejna
  onWebRtcIce: (callback) => {
    const handler = (_event, candidate) => callback(candidate)
    ipcRenderer.on('webrtc_ice', handler)
    return () => ipcRenderer.off('webrtc_ice', handler)
  },

  // React se Answer le kar Main Process ko bhejna (jo Mobile ko forward karega)
  sendWebRtcAnswer: (answer) => ipcRenderer.invoke('webrtc:send-answer', answer),

  // React se ICE candidate le kar Main Process ko bhejna (jo Mobile ko forward karega)
  sendWebRtcIce: (candidate) => ipcRenderer.invoke('webrtc:send-ice', candidate),
})
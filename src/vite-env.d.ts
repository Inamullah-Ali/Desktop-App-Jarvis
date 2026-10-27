/// <reference types="vite/client" />
/// <reference types="vite-plugin-electron/electron-env" />

// ── JARVIS API Interface ──────────────────────────────────────────────────
interface JarvisAPI {
  // Config
  isConfigured(): Promise<boolean>
  getKey(): Promise<string | null>
  saveKey(key: string): Promise<boolean>
  getAssistantName(): Promise<string>
  getUserName(): Promise<string>
  saveAssistant(a: string, u: string): Promise<boolean>
  getVoice(): Promise<string>
  getVoices(): Promise<string[]>
  saveVoice(v: string): Promise<boolean>

  // TTS in text chat
  getTtsInTextChat(): Promise<boolean>
  saveTtsInTextChat(enabled: boolean): Promise<boolean>

  // Screen sharing
  getScreenSource(): Promise<string | null>
  onWebRtcOffer(callback: (offer: RTCSessionDescriptionInit) => void): () => void
  onWebRtcIce(callback: (candidate: RTCIceCandidateInit) => void): () => void
  sendWebRtcAnswer(answer: RTCSessionDescriptionInit): Promise<boolean>
  sendWebRtcIce(candidate: RTCIceCandidateInit): Promise<boolean>

  // ✅ Command prefix
  getCommandPrefix(): Promise<string>
  saveCommandPrefix(prefix: string): Promise<boolean>
  onCommandPrefixChanged(callback: (prefix: string) => void): () => void

  // Gemini
  geminiText(contents: any, tier?: string): Promise<string>
  geminiJson(contents: any, tier?: string): Promise<any>
  geminiTest(): Promise<{ ok: boolean; reply?: string; error?: string }>

  // Local LLM
  llmProvider(): Promise<string>
  llmText(prompt: string, system?: string): Promise<string>
  llmChat(messages: any[], tools?: any[]): Promise<any>

  // System alerts
  onSystemAlert(callback: (data: { type: string; value: number; message: string }) => void): () => void

  // Authentication status
  userLoggedIn(userId: string): Promise<boolean>
  testPushNotification(): Promise<string>

  // Memory
  memoryLoad(): Promise<any>
  memoryUpdate(update: Record<string, any>): Promise<any>
  memoryRemember(key: string, value: string, category?: string): Promise<string>
  memoryForget(key: string, category?: string): Promise<string>
  memorySearch(query: string, limit?: number): Promise<string>
  memoryAllEntries(): Promise<any[]>
  memorySaveSession(summary: string, language?: string): Promise<void>
  memoryPopSession(): Promise<any>
  memoryFormatPrompt(): Promise<string>

  // Chat
  onChatAcknowledgment(callback: (acknowledgment: { id: string; text: string; requiresPlayback: boolean }) => void): () => void
  chatAcknowledgmentPlayed(id: string): void
  chatSend(message: string): Promise<any>
  chatHistory(): Promise<any[]>
  chatClear(): Promise<boolean>
  onDownloadProgress?(callback: (progress: {
    id: string
    state: 'downloading' | 'complete' | 'cancelled' | 'error'
    received: number
    total?: number
    percent?: number
    cancellable?: boolean
    error?: string
    path?: string
  }) => void): () => void
  cancelDownload?(id: string): Promise<void>

  // Audio
  audioToTextStream(base64Audio: string, mimeType: string): Promise<{ ok: boolean; reply?: string; error?: string }>
  onAudioChunk(callback: (chunk: string) => void): () => void

  // TTS
  ttsSpeak(text: string, voice?: string): Promise<{ ok: boolean; audioBase64?: string; error?: string }>

  // Reminders
  onReminderFired(callback: (data: { id: string; text: string }) => void): () => void

  // Wake word
  notifyWakeWord(keyword: string): Promise<boolean>
  onWakeWord(callback: (data: { keyword: string }) => void): () => void
    // ✅ Voice Profile (Speaker Verification)
  getVoiceProfile(): Promise<{ embedding: number[]; createdAt: number; sampleCount: number } | null>
  saveVoiceProfile(profile: { embedding: number[]; createdAt: number; sampleCount: number }): Promise<boolean>
  deleteVoiceProfile(): Promise<boolean>
  onVoiceProfileChanged(callback: (profile: any) => void): () => void
    // ✅ Streaming chat
  chatSendStream(message: string): Promise<any>
  onChatChunk(callback: (data: { chunk: string; done: boolean }) => void): () => void
}

declare global {
  interface Window {
    ipcRenderer: any
    jarvis: JarvisAPI
  }
}

export {}
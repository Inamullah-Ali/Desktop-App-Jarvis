import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

// ── Paths ──────────────────────────────────────────────────────────────────
// Electron mein __dirname hota hai, lekin packaged app mein app.getPath('userData')
// behtar hai. Development mein project root use karenge.
function getBaseDir(): string {
  if (app.isPackaged) {
    return path.dirname(app.getPath('exe'))
  }
  return path.join(process.cwd())
}

const BASE_DIR = getBaseDir()
const CONFIG_DIR = path.join(BASE_DIR, 'config')
const CONFIG_FILE = path.join(CONFIG_DIR, 'api_keys.json')

// ── Helpers ────────────────────────────────────────────────────────────────
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

function loadConfig(): Record<string, any> {
  if (!fs.existsSync(CONFIG_FILE)) return {}
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch (e) {
    console.error('❌ Failed to load api_keys.json:', e)
    return {}
  }
}

function saveConfig(data: Record<string, any>): void {
  ensureConfigDir()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

function patchConfig(fields: Record<string, any>): void {
  const data = loadConfig()
  Object.assign(data, fields)
  saveConfig(data)
}

// ── API Key ────────────────────────────────────────────────────────────────
export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE)
}

export function saveApiKeys(geminiApiKey: string): void {
  const data = loadConfig()
  data.gemini_api_key = geminiApiKey.trim()
  saveConfig(data)
}

export function loadApiKeys(): Record<string, any> {
  return loadConfig()
}

export function getGeminiKey(): string | null {
  return loadConfig().gemini_api_key || null
}

export function isConfigured(): boolean {
  const key = getGeminiKey()
  return !!key && key.length > 15
}

// ── Assistant Identity ─────────────────────────────────────────────────────
export function getAssistantName(): string {
  return loadConfig().assistant_name || 'JARVIS'
}

export function getUserName(): string {
  return loadConfig().user_name || ''
}

export function saveAssistantConfig(assistantName: string, userName: string): void {
  patchConfig({
    assistant_name: assistantName.trim() || 'JARVIS',
    user_name: userName.trim(),
  })
}

// ── Voice ──────────────────────────────────────────────────────────────────
export const AVAILABLE_VOICES = ['Charon', 'Puck', 'Kore', 'Fenrir', 'Aoede']
export const DEFAULT_VOICE = 'Charon'

export function getVoice(): string {
  const v = loadConfig().voice_name || DEFAULT_VOICE
  return AVAILABLE_VOICES.includes(v) ? v : DEFAULT_VOICE
}

export function saveVoice(voiceName: string): void {
  const v = (voiceName || '').trim()
  patchConfig({
    voice_name: AVAILABLE_VOICES.includes(v) ? v : DEFAULT_VOICE,
  })
}

// ── Toggles ────────────────────────────────────────────────────────────────
export function getWakeWordEnabled(): boolean {
  return !!loadConfig().wake_word_enabled
}

export function saveWakeWordEnabled(enabled: boolean): void {
  patchConfig({ wake_word_enabled: !!enabled })
}

export function getPushToTalkEnabled(): boolean {
  return !!loadConfig().push_to_talk_enabled
}

export function savePushToTalkEnabled(enabled: boolean): void {
  patchConfig({ push_to_talk_enabled: !!enabled })
}

// ── HUD Style ──────────────────────────────────────────────────────────────
export const HUD_STYLES = ['face', 'core'] as const

export function getHudStyle(): string {
  const v = String(loadConfig().hud_style || 'face').toLowerCase()
  return HUD_STYLES.includes(v as any) ? v : 'face'
}

export function saveHudStyle(style: string): void {
  const s = String(style || '').toLowerCase()
  patchConfig({ hud_style: HUD_STYLES.includes(s as any) ? s : 'face' })
}

// ── Live Tuning ────────────────────────────────────────────────────────────
export function getThinkingEnabled(): boolean {
  return !!loadConfig().thinking_enabled
}

export function saveThinkingEnabled(enabled: boolean): void {
  patchConfig({ thinking_enabled: !!enabled })
}

export function getTurnTuning(): Record<string, any> {
  const cfg = loadConfig().turn_tuning
  const c = cfg && typeof cfg === 'object' ? cfg : {}
  const clamp = (key: string, def: number, lo: number, hi: number) => {
    const v = parseInt(c[key] ?? def, 10)
    if (isNaN(v)) return def
    return Math.max(lo, Math.min(hi, v))
  }
  return {
    enabled: !!c.enabled,
    silence_ms: clamp('silence_ms', 550, 200, 3000),
    prefix_ms: clamp('prefix_ms', 150, 0, 1000),
    end_sensitivity: String(c.end_sensitivity || 'high').toLowerCase(),
    start_sensitivity: String(c.start_sensitivity || 'default').toLowerCase(),
  }
}

export function saveTurnTuning(values: Record<string, any>): void {
  const data = loadConfig()
  const cur = data.turn_tuning && typeof data.turn_tuning === 'object' ? data.turn_tuning : {}
  data.turn_tuning = { ...cur, ...values }
  saveConfig(data)
}

export function getProactiveAudioEnabled(): boolean {
  const v = loadConfig().proactive_audio
  return v === undefined ? true : !!v
}

export function saveProactiveAudioEnabled(enabled: boolean): void {
  patchConfig({ proactive_audio: !!enabled })
}

// ── Media Resolution ───────────────────────────────────────────────────────
export const MEDIA_RESOLUTIONS = ['default', 'low', 'medium', 'high']

export function getMediaResolution(): string {
  const v = String(loadConfig().media_resolution || 'medium').toLowerCase()
  return MEDIA_RESOLUTIONS.includes(v) ? v : 'medium'
}

export function saveMediaResolution(value: string): void {
  const v = String(value || '').toLowerCase()
  patchConfig({ media_resolution: MEDIA_RESOLUTIONS.includes(v) ? v : 'medium' })
}

// ── Misc Toggles ───────────────────────────────────────────────────────────
export function getBriefEnabled(): boolean {
  const v = loadConfig().morning_brief_enabled
  return v === undefined ? true : !!v
}

export function saveBriefEnabled(enabled: boolean): void {
  patchConfig({ morning_brief_enabled: !!enabled })
}

// ── Audio Devices ──────────────────────────────────────────────────────────
export function getInputDevice(): string {
  return String(loadConfig().input_device || '').trim()
}

export function saveInputDevice(name: string): void {
  patchConfig({ input_device: (name || '').trim() })
}

export function getOutputDevice(): string {
  return String(loadConfig().output_device || '').trim()
}

export function saveOutputDevice(name: string): void {
  patchConfig({ output_device: (name || '').trim() })
}

// ── Plugins ────────────────────────────────────────────────────────────────
export function getPluginEnabled(pluginName: string): boolean {
  const enabled = loadConfig().plugins_enabled || {}
  return enabled[pluginName] !== false
}

export function savePluginEnabled(pluginName: string, enabled: boolean): void {
  const data = loadConfig()
  const pluginsCfg = data.plugins_enabled && typeof data.plugins_enabled === 'object'
    ? data.plugins_enabled : {}
  pluginsCfg[pluginName] = enabled
  data.plugins_enabled = pluginsCfg
  saveConfig(data)
}

export function getPluginConfig(namespace: string): Record<string, any> {
  const cfg = loadConfig().plugin_config
  const val = cfg && typeof cfg === 'object' ? cfg[namespace] : null
  return val && typeof val === 'object' ? { ...val } : {}
}

export function getPluginSetting(namespace: string, key: string, defaultValue: any = null): any {
  const c = getPluginConfig(namespace)
  return c[key] !== undefined ? c[key] : defaultValue
}

export function savePluginConfig(namespace: string, values: Record<string, any>): void {
  const data = loadConfig()
  const pc = data.plugin_config && typeof data.plugin_config === 'object' ? data.plugin_config : {}
  const cur = pc[namespace] && typeof pc[namespace] === 'object' ? pc[namespace] : {}
  pc[namespace] = { ...cur, ...values }
  data.plugin_config = pc
  saveConfig(data)
}

// ── TTS in text chat ───────────────────────────────────────────────────────
export function getTtsInTextChat(): boolean {
  return !!loadConfig().tts_in_text_chat
}

export function saveTtsInTextChat(enabled: boolean): void {
  patchConfig({ tts_in_text_chat: !!enabled })
}

// ── Custom command prefix ──────────────────────────────────────────────────
export function getCommandPrefix(): string {
  const prefix = loadConfig().command_prefix
  return (typeof prefix === 'string' && prefix.trim()) ? prefix.trim() : 'Jarvis'
}

export function saveCommandPrefix(prefix: string): void {
  const p = String(prefix || '').trim() || 'Jarvis'
  patchConfig({ command_prefix: p })
}

// ── Voice Profile (Speaker Verification) ───────────────────────────────────
export interface VoiceProfile {
  embedding: number[]      // Voice fingerprint (WavLM embedding)
  createdAt: number        // Kab banaya
  sampleCount: number      // Kitne samples se bana
}

export function getVoiceProfile(): VoiceProfile | null {
  const profile = loadConfig().voice_profile
  if (!profile || !profile.embedding || !Array.isArray(profile.embedding)) {
    return null
  }
  return profile as VoiceProfile
}

export function saveVoiceProfile(profile: VoiceProfile | null): void {
  if (profile === null) {
    patchConfig({ voice_profile: null })
    console.log('[Config] Voice profile deleted')
    return
  }
  patchConfig({ voice_profile: profile })
  console.log(`[Config] Voice profile saved (${profile.embedding.length} dims, ${profile.sampleCount} samples)`)
}
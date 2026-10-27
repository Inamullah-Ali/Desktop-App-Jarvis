import { GoogleGenAI } from '@google/genai'
import { getGeminiKey } from './configManager'

// ── Ladder Definitions ─────────────────────────────────────────────────────
export const FAST = 'fast'
export const SMART = 'smart'
export const SEARCH = 'search'
export const LIVE = 'live'

// Model ladders — gemini.py se exactly copied
const LADDERS: Record<string, string[]> = {
  [FAST]: [
    LIVE, 
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash',           // ← Yahan naya model
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-2.5-flash',
    'gemini-3.6-flash',
    'gemini-3-flash-preview',
  ],
  [SMART]: [
    LIVE, 
    'gemini-3.8-flash',           // ← Yahan bhi
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
    'gemini-3.6-flash',
    'gemini-3-flash-preview',
    'gemini-flash-latest',
  ],
  [SEARCH]: [
    'gemini-3.5-flash',
    'gemini-3.8-flash',           // ← Yahan bhi
    'gemini-2.5-flash',
    'gemini-flash-latest',
  ],
}

export const LIVE_MODELS = [
  'models/gemini-3.1-flash-live-preview',
  'models/gemini-2.5-flash-native-audio-preview-12-2025',
]

const LIVE_FALLBACK = 'models/gemini-3.1-flash-live-preview'

// ── Cooldowns ──────────────────────────────────────────────────────────────
const COOLDOWN_SECONDS = 300        // 5 min — quota
const GONE_SECONDS = 6 * 60 * 60    // 6 hours — 404
const UNAVAILABLE_SECONDS = 30 * 60 // 30 min — 503/504

const cooldown = new Map<string, number>()

function cool(model: string, seconds: number = COOLDOWN_SECONDS): void {
  cooldown.set(model, Date.now() + seconds * 1000)
}

function isCooling(model: string): boolean {
  const until = cooldown.get(model)
  if (until && Date.now() < until) return true
  cooldown.delete(model)
  return false
}

// ── Error Classification ───────────────────────────────────────────────────
export function isQuotaError(err: string): boolean {
  return err.includes('429') || err.includes('RESOURCE_EXHAUSTED')
}

export function isUnavailableError(err: string): boolean {
  const low = err.toLowerCase()
  return err.includes('503') || err.includes('504') ||
    low.includes('unavailable') || low.includes('deadline_exceeded')
}

export function isGoneError(err: string): boolean {
  const low = err.toLowerCase()
  return err.includes('404') || low.includes('not found') ||
    low.includes('is not supported') || low.includes('permission') || err.includes('403')
}

// ── Live Model Helpers ─────────────────────────────────────────────────────
export function liveModel(): string {
  for (const m of LIVE_MODELS) {
    if (!isCooling(m)) return m
  }
  return LIVE_MODELS[0]
}

export function noteLiveFailure(model: string, err: string): boolean {
  if (isQuotaError(err)) {
    cool(model, COOLDOWN_SECONDS)
    console.log(`[Gemini] Live model ${model} is out of quota — switching`)
    return true
  }
  if (isGoneError(err)) {
    cool(model, GONE_SECONDS)
    console.log(`[Gemini] Live model ${model} is unavailable to this key`)
    return true
  }
  return false
}

// ── Client Factory ─────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 10_000
const MIN_TIMEOUT_MS = 10_000

export function getClient(timeoutMs: number = DEFAULT_TIMEOUT_MS): GoogleGenAI {
  const key = getGeminiKey()
  if (!key) throw new Error('no Gemini API key is configured')
  return new GoogleGenAI({ apiKey: key })
}

// ── One-Shot System Prompt ─────────────────────────────────────────────────
const ONE_SHOT_SYSTEM = 
  'You are a data-processing function, not an assistant and not in a ' +
  'conversation. There is no person listening to you. Produce exactly the ' +
  'output the request asks for and nothing else: no greeting, no ' +
  'acknowledgement, no \'Understood\', no explanation, no closing remark, no ' +
  'restating of the question. If the request asks for JSON, emit only the ' +
  'JSON. If it asks for code, emit only the code. If it asks for one word, ' +
  'emit that one word. Preserve the exact spelling, punctuation, capitals ' +
  'and whitespace of anything you are asked to copy or return.'

// ── Reply Shape ────────────────────────────────────────────────────────────
export interface GeminiReply {
  text: string
}

// ── One-Shot Live Call ─────────────────────────────────────────────────────
// NOTE: Live API in JS SDK works differently from Python. Ye simplified version
// hai jo sirf text return karta hai. Audio Live session main.ts mein banega.
async function liveCall(
  contents: any,
  config: any,
  timeoutMs: number,
  key: string,
): Promise<GeminiReply | null> {
  // JS SDK mein Live API ke liye alag client chahiye
  // Filhaal hum ise skip kar rahe hain — REST ladder use karenge
  // Baad mein (Phase 3) mein poora Live session banayenge
  throw new Error('Live one-shot not yet implemented in JS SDK')
}

// ── Main Call ──────────────────────────────────────────────────────────────
export async function callGemini(
  contents: any,
  tier: string = FAST,
  config: any = null,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  key: string = '',
): Promise<any> {
  const resolvedKey = key || getGeminiKey()
  if (!resolvedKey) {
    console.log('[Gemini] no Gemini API key is configured')
    return null
  }

  let ladder = LADDERS[tier]
  if (!ladder) {
    ladder = [tier, ...LADDERS[SMART].filter((m) => m !== tier)]
  }

  const tried = ladder.filter((m) => !isCooling(m))
  const finalLadder = tried.length > 0 ? tried : ladder

  let client: GoogleGenAI | null = null

  for (const model of finalLadder) {
    try {
      if (model === LIVE) {
        // Live one-shot abhi skip — REST par gir jao
        throw new Error('Live one-shot not implemented')
      }

      if (!client) {
        client = new GoogleGenAI({ apiKey: resolvedKey })
      }

      const response = await client.models.generateContent({
        model,
        contents,
        config: config || undefined,
      })
      return response
    } catch (e: any) {
      const msg = String(e?.message || e)
      if (isQuotaError(msg)) {
        cool(model, COOLDOWN_SECONDS)
        console.log(`[Gemini] ${model}: out of quota — skipping 5 min`)
      } else if (isGoneError(msg)) {
        cool(model, GONE_SECONDS)
        console.log(`[Gemini] ${model}: unavailable to this key`)
      } else if (isUnavailableError(msg)) {
        cool(model, UNAVAILABLE_SECONDS)
        console.log(`[Gemini] ${model}: not answering — resting 30 min`)
      } else {
        console.log(`[Gemini] ${model}: ${msg.slice(0, 140)}`)
      }
    }
  }

  return null
}

// ── Text Helper ────────────────────────────────────────────────────────────
export async function geminiText(
  contents: any,
  tier: string = FAST,
  config: any = null,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  key: string = '',
  defaultValue: string = '',
): Promise<string> {
  const resp = await callGemini(contents, tier, config, timeoutMs, key)
  if (!resp) return defaultValue
  const text = (resp.text || '').trim()
  return text || defaultValue
}

// ── JSON Helper ────────────────────────────────────────────────────────────
export async function geminiJson(
  contents: any,
  tier: string = FAST,
  config: any = null,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  key: string = '',
  defaultValue: any = null,
): Promise<any> {
  let raw = await geminiText(contents, tier, config, timeoutMs, key)
  if (!raw) return defaultValue

  // Strip markdown fences / prose
  if (raw.includes('{') && raw.includes('}')) {
    raw = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  } else if (raw.includes('[') && raw.includes(']')) {
    raw = raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)
  }

  try {
    return JSON.parse(raw)
  } catch (e) {
    console.log('[Gemini] reply was not JSON:', e)
    return defaultValue
  }
}
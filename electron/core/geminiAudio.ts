import { getGeminiKey } from './configManager'
import { buildSystemPrompt } from './promptBuilder'

// ── Retry Configuration ────────────────────────────────────────────────────
const MAX_RETRIES = 3                    // Har model ke liye 3 koshish
const INITIAL_BACKOFF_MS = 1000          // Pehli retry: 1s
const MAX_BACKOFF_MS = 8000              // Max wait: 8s
const RETRY_ON_STATUS = [429, 500, 503, 504]  // In par retry karein

// ── Helper: Exponential Backoff with Jitter ────────────────────────────────
function backoffDelay(attempt: number): number {
  // 1s, 2s, 4s, 8s (max) — plus random jitter (0-500ms)
  const base = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS)
  const jitter = Math.random() * 500
  return base + jitter
}

// ── Helper: Error status nikaalein ─────────────────────────────────────────
function extractStatus(err: any): number | null {
  // SDK errors: { code: 503, status: 'UNAVAILABLE', message: '...' }
  if (err?.code && typeof err.code === 'number') return err.code
  if (err?.status && typeof err.status === 'number') return err.status
  const msg = String(err?.message || err)
  // Message ke andar "code": 503 dhundein
  const match = msg.match(/"code"\s*:\s*(\d+)/)
  if (match) return parseInt(match[1], 10)
  // Plain text numbers
  if (msg.includes('429')) return 429
  if (msg.includes('500')) return 500
  if (msg.includes('503')) return 503
  if (msg.includes('504')) return 504
  if (msg.includes('404')) return 404
  return null
}

// ── Helper: Kab retry karna hai ────────────────────────────────────────────
function isRetryable(status: number | null): boolean {
  return status !== null && RETRY_ON_STATUS.includes(status)
}

// ── Helper: Kab next model par jana hai ────────────────────────────────────
function isModelGone(status: number | null): boolean {
  return status === 404
}

// ── Main Function: Audio → Text (Streaming + Retry) ────────────────────────
export async function geminiAudioToTextStream(
  base64Audio: string,
  mimeType: string = 'audio/wav',
  onChunk: (text: string) => void,
  timeoutMs: number = 20_000,
): Promise<string> {
  const key = getGeminiKey()
  if (!key) throw new Error('No Gemini API key configured')

  const { GoogleGenAI } = await import('@google/genai')
  const client = new GoogleGenAI({ apiKey: key })

  // ✅ SIRF TRANSCRIPTION — jawab nahi
  const transcriptionInstruction =
    'You are a transcription function, not an assistant. Your ONLY job ' +
    'is to transcribe the audio into text in the language the speaker ' +
    'used. Do NOT answer questions. Do NOT respond to commands. Do NOT ' +
    'add commentary, greetings, or acknowledgments. Just output the ' +
    'exact words the speaker said.'

  const models = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']

  let lastError: any = null
  for (const model of models) {
    try {
      console.log(`[GeminiAudio] Transcribing with ${model}...`)
      const start = Date.now()

      const response = await client.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: base64Audio } },
              { text: 'Transcribe this audio. Output only the transcription.' },
            ],
          },
        ],
        config: {
          systemInstruction: transcriptionInstruction,
        } as any,
      })

      const text = (response.text || '').trim()
      if (text) {
        console.log(`[GeminiAudio] ✅ Transcribed in ${((Date.now() - start) / 1000).toFixed(1)}s`)
        onChunk(text)
        return text
      }
      throw new Error('Empty transcription')
    } catch (e: any) {
      lastError = e
      console.log(`[GeminiAudio] ${model} failed: ${String(e?.message || e).slice(0, 100)}`)
      continue
    }
  }
  throw lastError || new Error('All transcription models failed')
}

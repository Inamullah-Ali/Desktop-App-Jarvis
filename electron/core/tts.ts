import { getGeminiKey, getVoice } from './configManager'

// ── Gemini TTS: Text → PCM Audio (24 kHz, 16-bit mono) ─────────────────────
export async function geminiTextToSpeech(
  text: string,
  voiceName?: string,
  timeoutMs: number = 30_000,
): Promise<string> {
  const key = getGeminiKey()
  if (!key) throw new Error('No Gemini API key configured')

  const voice = voiceName || getVoice() || 'Charon'
  const trimmed = (text || '').trim()
  if (!trimmed) throw new Error('Empty text')

  const { GoogleGenAI } = await import('@google/genai')
  const client = new GoogleGenAI({ apiKey: key })

  console.log(`[TTS] Generating speech (voice=${voice})…`)
  const start = Date.now()

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [
      {
        role: 'user',
        parts: [{ text: trimmed }],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    } as any,
  })

  // PCM audio nikaalein
  const candidate = response.candidates?.[0]
  const part = candidate?.content?.parts?.[0]
  const audioData = (part as any)?.inlineData?.data

  if (!audioData) {
    throw new Error('No audio data returned from TTS')
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`[TTS] ✅ Done in ${elapsed}s (${Math.round(audioData.length / 1024)} KB)`)

  // Base64 PCM return karein (UI WAV header add karegi)
  return audioData as string
}
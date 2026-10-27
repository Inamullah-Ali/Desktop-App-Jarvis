import { useState, useRef, useEffect } from 'react'
import { VadRecorder } from 'vad-recorder'

// ══════════════════════════════════════════════════════════════════════════
// ✅ VOICE VERIFICATION — WavLM Speaker Embedding (Offline & Local)
// ══════════════════════════════════════════════════════════════════════════

let processor: any = null
let model: any = null
let modelLoading: Promise<void> | null = null

async function loadVoiceModel(): Promise<void> {
  if (processor && model) return
  if (modelLoading) return modelLoading

  modelLoading = (async () => {
    console.log('[Voice] Loading WavLM model (Offline)...')
    const { AutoProcessor, AutoModel, env } = await import('@huggingface/transformers')
    env.backends.onnx.wasm.numThreads = 1
    env.backends.onnx.wasm.proxy = false
    env.allowLocalModels = false

    processor = await AutoProcessor.from_pretrained('Xenova/wavlm-base-plus-sv')
    model = await AutoModel.from_pretrained('Xenova/wavlm-base-plus-sv')
    console.log('[Voice] ✅ WavLM model loaded')
  })()

  return modelLoading
}

async function getVoiceEmbedding(audioBlob: Blob): Promise<number[]> {
  await loadVoiceModel()
  const arrayBuffer = await audioBlob.arrayBuffer()
  const audioCtx = new AudioContext({ sampleRate: 16000 })
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
  const audioData = audioBuffer.getChannelData(0)
  await audioCtx.close()

  const inputs = await processor(audioData)
  const output = await model(inputs)
  const embeddings = output.embeddings || output.last_hidden_state
  const data = embeddings.data ? Array.from(embeddings.data) : Array.from(embeddings)
  console.log(`[Voice] Embedding extracted: ${data.length} dims`)
  return data as number[]
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// ══════════════════════════════════════════════════════════════════════════
// ✅ SIRI-STYLE ENROLLMENT PHRASES
// ══════════════════════════════════════════════════════════════════════════

const ENROLL_PHRASES = [
  'Chrome kholo',
  'Time kya hai',
  'Mausam batao',
  'Aaj ki news sunao',
  'System status dikhao',
]

// ══════════════════════════════════════════════════════════════════════════
// ✅ MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════

export default function AudioTestPanel() {
  const [permissionGranted, setPermissionGranted] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDevice, setSelectedDevice] = useState('')

  // Voice Profile State
  const [voiceProfile, setVoiceProfile] = useState<{ embedding: number[]; createdAt: number; sampleCount: number } | null>(null)
  const [verificationEnabled, setVerificationEnabled] = useState(true)
  const [similarityScore, setSimilarityScore] = useState<number | null>(null)

  // UI & Mode State
  const [continuousMode, setContinuousMode] = useState(false)
  const [echoSafeMode, setEchoSafeMode] = useState(true)
  const [enrollMode, setEnrollMode] = useState(false)
  const [modelReady, setModelReady] = useState(false)
  const [modelLoadingMsg, setModelLoadingMsg] = useState('')
  const [vadStatus, setVadStatus] = useState('idle')

  // ✅ Siri-style Enrollment Dialog States
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false)
  const [enrollPhraseIndex, setEnrollPhraseIndex] = useState(0)
  const [enrollSamples, setEnrollSamples] = useState<number[][]>([])
  const [enrollPhraseStatus, setEnrollPhraseStatus] = useState<'idle' | 'recording' | 'done'>('idle')
  const [enrollComplete, setEnrollComplete] = useState(false)

  // UI Text State
  const [userText, setUserText] = useState('')
  const [replyText, setReplyText] = useState('')
  const [ackText, setAckText] = useState('')
  const [toolsUsed, setToolsUsed] = useState<string[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [detectedLang, setDetectedLang] = useState<'ur' | 'en' | ''>('')
  const [error, setError] = useState('')

  // ✅ Streaming State
  const [streamingReply, setStreamingReply] = useState('')
  const streamBufferRef = useRef<string>('')
  const streamSpeakTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Refs
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const speakQueueRef = useRef<string[]>([])
  const isSpeakingRef = useRef<boolean>(false)
  const voiceProfileRef = useRef<{ embedding: number[]; createdAt: number; sampleCount: number } | null>(null)
  const verificationEnabledRef = useRef<boolean>(true)
  const continuousModeRef = useRef<boolean>(false)
  const echoSafeModeRef = useRef<boolean>(true)
  const enrollModeRef = useRef<boolean>(false)
  const sendingRef = useRef(false)
  const vadRecorderRef = useRef<any>(null)
  const audioBlobRef = useRef<Blob | null>(null)
  const ttsActiveRef = useRef<boolean>(false)
  const bargeInCooldownRef = useRef<number>(0)
  const enrollPhraseIndexRef = useRef<number>(0)
  const enrollSamplesRef = useRef<number[][]>([])

  // ── Load devices ───────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        tempStream.getTracks().forEach((t) => t.stop())
        setPermissionGranted(true)
        const allDevices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = allDevices.filter((d) => d.kind === 'audioinput')
        setDevices(audioInputs)
        if (audioInputs.length > 0) setSelectedDevice(audioInputs[0].deviceId)
      } catch (e: any) {
        setError(`Permission denied: ${e?.message || String(e)}`)
      }
    })()
  }, [])

  // ✅ Sync Refs
  useEffect(() => { verificationEnabledRef.current = verificationEnabled }, [verificationEnabled])
  useEffect(() => { continuousModeRef.current = continuousMode }, [continuousMode])
  useEffect(() => { echoSafeModeRef.current = echoSafeMode }, [echoSafeMode])
  useEffect(() => { enrollModeRef.current = enrollMode }, [enrollMode])
  useEffect(() => { enrollPhraseIndexRef.current = enrollPhraseIndex }, [enrollPhraseIndex])
  useEffect(() => { enrollSamplesRef.current = enrollSamples }, [enrollSamples])

  // ✅ Load voice profile
  useEffect(() => {
    window.jarvis.getVoiceProfile().then((profile) => {
      if (profile) { setVoiceProfile(profile); voiceProfileRef.current = profile }
    })
  }, [])

  // ✅ Model pre-load
  useEffect(() => {
    setModelLoadingMsg('Voice model load ho raha hai...')
    loadVoiceModel().then(() => setModelReady(true)).catch((e) => setModelLoadingMsg(`Failed: ${e.message}`))
  }, [])

  // ══════════════════════════════════════════════════════════════════════
  // ✅ VAD RECORDER INITIALIZATION
  // ══════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!permissionGranted) return

    (async () => {
      try {
        const recorder = new VadRecorder({
          threshold: 0.55,
          minSpeechDuration: 250,
          minSilenceDuration: 900,
          prependSilence: 120,
          appendSilence: 300,
        })

        recorder.onReady(() => console.log('[VAD] ✅ Ready'))

        recorder.onSpeechStart(() => {
          console.log('[VAD] 🎤 Speech detected')
          setVadStatus('speech')
          if (enrollDialogOpen) setEnrollPhraseStatus('recording')

          if (!echoSafeModeRef.current && (ttsActiveRef.current || isSpeakingRef.current)) {
            const now = Date.now()
            if (now - bargeInCooldownRef.current > 500) {
              console.log('[BargeIn] 🛑 Interrupt! TTS Cancel.')
              window.speechSynthesis.cancel()
              speakQueueRef.current = []
              isSpeakingRef.current = false
              ttsActiveRef.current = false
              setSpeaking(false)
              bargeInCooldownRef.current = now
            }
          }
        })

        recorder.onSpeechEnd(() => {
          console.log('[VAD] 🔇 Speech ended')
          setVadStatus('processing')
        })

        recorder.onRecord((blob: Blob) => {
          console.log('[VAD] 📦 Blob:', blob.size, 'bytes')
          audioBlobRef.current = blob
          setTimeout(() => sendToGemini(), 150)
        })

        recorder.onError((err: any) => console.error('[VAD] Error:', err))

        await recorder.initialize((event: any) => {
          if (event.status === 'downloading') setModelLoadingMsg(`VAD: ${Math.round(event.progress * 100)}%`)
        })

        vadRecorderRef.current = recorder
        setModelReady(true)
        setModelLoadingMsg('')
      } catch (e: any) {
        setError(`VAD init failed: ${e?.message}`)
      }
    })()
  }, [permissionGranted, enrollDialogOpen])

  // ── Helper: Command verb check ─────────────────────────────────────────
  const isValidCommand = (text: string): boolean => {
    const t = text.trim()
    if (t.length < 3 || /^[\d:.\s,]+$/.test(t)) return false
    const words = t.toLowerCase().split(/\s+/).filter((w) => w.length >= 2)
    if (words.length < 2) return false
    const verbs = ['kholo','khol','banao','bana','batao','bata','dikhao','dikha','chalao','chala','band','bajao','baja','likho','likh','dhundho','dhundo','karo','kar','do','de','le','ja','wapis','undo','wapas','yaad','dilao','dilana','mausam','khabar','akhbar','samachar','waqt','samay','tareekh','din','gaana','gana','song','video','movie','open','close','create','make','show','play','stop','start','search','find','get','set','change','run','launch','read','write','move','copy','delete','remove','rename','list','time','date','weather','news','help','system','status','volume','brightness']
    return words.some((w) => verbs.some((v) => w.includes(v)))
  }

  // ── ACKNOWLEDGMENT LISTENER ────────────────────────────────────────────
  useEffect(() => {
    if (!window.jarvis.onChatAcknowledgment) return
    const unsub = window.jarvis.onChatAcknowledgment(({ id, text, requiresPlayback }) => {
      console.log(`[AudioTest] 🔊 Ack: "${text}"`)
      setAckText(text)
      if (!requiresPlayback) return
      speakText(text, () => window.jarvis.chatAcknowledgmentPlayed(id))
    })
    return () => unsub()
  }, [])

  // ══════════════════════════════════════════════════════════════════════
  // ✅ CHAT CHUNK LISTENER — streaming display + TTS
  // ══════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!window.jarvis.onChatChunk) return
    const unsub = window.jarvis.onChatChunk((data: { chunk: string; done: boolean }) => {
      if (data.chunk) {
        // UI mein append karein
        setStreamingReply((prev) => prev + data.chunk)
        streamBufferRef.current += data.chunk

        // ✅ TTS buffer — 200ms ke baad bolo
        if (streamSpeakTimerRef.current) clearTimeout(streamSpeakTimerRef.current)
        streamSpeakTimerRef.current = setTimeout(() => {
          const text = streamBufferRef.current.trim()
          if (text && continuousModeRef.current) {
            console.log(`[Stream] 🔊 TTS: "${text}"`)
            speakQueueRef.current.push(text)
            processSpeakQueue()
            streamBufferRef.current = ''
          }
        }, 200)
      }

      if (data.done) {
        // Final — buffer mein bacha hua bolo
        const remaining = streamBufferRef.current.trim()
        if (remaining && continuousModeRef.current) {
          speakQueueRef.current.push(remaining)
          processSpeakQueue()
          streamBufferRef.current = ''
        }
        // Reply ko final set karein
        setReplyText(streamingReply)
      }
    })
    return () => unsub()
  }, [streamingReply])

  // ── Reminder TTS ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!window.jarvis.onReminderSpeak) return
    const unsub = window.jarvis.onReminderSpeak((data: any) => { speakText(data.text) })
    return () => unsub()
  }, [])

  // ── Speak (Single) ─────────────────────────────────────────────────────
  const speakText = (text: string, onDone?: () => void) => {
    if (!text.trim() || !window.speechSynthesis) { if (onDone) onDone(); return }
    setSpeaking(true); ttsActiveRef.current = true; bargeInCooldownRef.current = Date.now()
    window.speechSynthesis.cancel()
    const lang = detectLanguage(text)
    setDetectedLang(lang)
    const voices = voicesRef.current.length > 0 ? voicesRef.current : window.speechSynthesis.getVoices()
    let voice: SpeechSynthesisVoice | null = null
    if (lang === 'ur') { voice = voices.find(v => v.lang.startsWith('ur')) || voices.find(v => v.lang.startsWith('hi')) || voices.find(v => v.lang === 'en-IN') || null }
    if (!voice) voice = voices.find(v => v.lang === 'en-US' || v.lang === 'en-GB' || v.lang.startsWith('en')) || voices[0] || null
    const utt = new SpeechSynthesisUtterance(text)
    if (voice) { utt.voice = voice; utt.lang = voice.lang } else { utt.lang = lang === 'ur' ? 'ur-PK' : 'en-US' }
    utt.onend = () => { setSpeaking(false); ttsActiveRef.current = false; if (onDone) setTimeout(onDone, 400) }
    utt.onerror = () => { setSpeaking(false); ttsActiveRef.current = false; if (onDone) setTimeout(onDone, 400) }
    window.speechSynthesis.speak(utt)
  }

  // ══════════════════════════════════════════════════════════════════════
  // ✅ SPEAK QUEUE (Echo-Safe Logic)
  // ══════════════════════════════════════════════════════════════════════
  const processSpeakQueue = async () => {
    if (isSpeakingRef.current) return
    const nextText = speakQueueRef.current.shift()
    if (!nextText) return

    if (echoSafeModeRef.current && vadRecorderRef.current) {
      try {
        await vadRecorderRef.current.stop?.()
        console.log('[VAD] ⏹️ EchoSafe: VAD Stopped (TTS ke doran)')
        setVadStatus('idle')
      } catch (e) {}
    }

    isSpeakingRef.current = true
    ttsActiveRef.current = true
    bargeInCooldownRef.current = Date.now()
    setSpeaking(true)
    window.speechSynthesis.cancel()

    const lang = detectLanguage(nextText)
    setDetectedLang(lang)
    const voice = pickVoice(lang)
    const utt = new SpeechSynthesisUtterance(nextText)
    if (voice) { utt.voice = voice; utt.lang = voice.lang } else { utt.lang = lang === 'ur' ? 'ur-PK' : 'en-US' }

    const onTtsDone = async () => {
      isSpeakingRef.current = false
      ttsActiveRef.current = false
      setSpeaking(false)

      if (speakQueueRef.current.length > 0) {
        setTimeout(processSpeakQueue, 200)
      } else {
        if (echoSafeModeRef.current && vadRecorderRef.current && continuousModeRef.current) {
          setTimeout(async () => {
            try {
              await vadRecorderRef.current.start()
              setVadStatus('listening')
              console.log('[VAD] ▶️ EchoSafe: VAD Restarted (TTS complete)')
            } catch (e) {
              console.error('[VAD] Restart failed:', e)
            }
          }, 800)
        }
      }
    }

    utt.onend = onTtsDone
    utt.onerror = onTtsDone
    window.speechSynthesis.speak(utt)
  }

  const detectLanguage = (text: string): 'ur' | 'en' => {
    const urduRegex = /[\u0600-\u06FF]/
    if (urduRegex.test(text)) return 'ur'
    const roman = ['kya','kaise','kaisa','kaisi','haal','hai','hain','mujhe','tum','aap','mera','meri','tera','teri','uska','uski','nahi','haan','ji','bhai','yaar','acha','theek','salam','khuda','hafiz','shukriya','kro','karo','batao','bata','raha','rahi','kar','sun']
    const lower = text.toLowerCase()
    const words = lower.split(/\s+/)
    if (words.filter(w => roman.includes(w)).length >= 2) return 'ur'
    return 'en'
  }

  const pickVoice = (lang: 'ur' | 'en'): SpeechSynthesisVoice | null => {
    const voices = voicesRef.current.length > 0 ? voicesRef.current : window.speechSynthesis.getVoices()
    if (lang === 'ur') { let v = voices.find(v => v.lang.startsWith('ur')); if (v) return v; v = voices.find(v => v.lang.startsWith('hi')); if (v) return v; v = voices.find(v => v.lang === 'en-IN'); if (v) return v }
    return voices.find(v => v.lang === 'en-US' || v.lang === 'en-GB' || v.lang.startsWith('en')) || voices[0] || null
  }

  // ── VAD CONTROL ────────────────────────────────────────────────────────
  const startVad = async () => {
    if (!vadRecorderRef.current) { setError('VAD not ready'); return }
    setError(''); audioBlobRef.current = null
    if (!enrollDialogOpen) {
      setUserText(''); setReplyText(''); setAckText(''); setToolsUsed([])
      setStreamingReply('')
      streamBufferRef.current = ''
    }
    try {
      await vadRecorderRef.current.start()
      setVadStatus('listening')
      console.log('[VAD] ▶️ Listening...')
    } catch (e: any) { setError(`VAD start failed: ${e.message}`) }
  }

  const stopVad = async () => {
    if (!vadRecorderRef.current) return
    try { await vadRecorderRef.current.stop() } catch {}
    setVadStatus('idle')
    console.log('[VAD] ⏹️ Stopped')
  }

  // ══════════════════════════════════════════════════════════════════════
  // ✅ SIRI-STYLE ENROLLMENT (5 Phrases)
  // ══════════════════════════════════════════════════════════════════════
  const enrollVoice = async (blob: Blob) => {
    try {
      setError('')
      const currentIndex = enrollPhraseIndexRef.current
      console.log(`[Enroll] Phrase ${currentIndex + 1}/5 process ho raha hai...`)

      const embedding = await getVoiceEmbedding(blob)
      const newSamples = [...enrollSamplesRef.current, embedding]
      setEnrollSamples(newSamples)
      enrollSamplesRef.current = newSamples

      if (newSamples.length < 5) {
        const nextIndex = newSamples.length
        setEnrollPhraseIndex(nextIndex)
        enrollPhraseIndexRef.current = nextIndex
        setEnrollPhraseStatus('done')
        console.log(`[Enroll] ✅ Phrase ${newSamples.length}/5 complete`)

        setTimeout(() => {
          setEnrollPhraseStatus('idle')
          speakText(ENROLL_PHRASES[nextIndex])
          setTimeout(() => startVad(), 1500)
        }, 1000)
      } else {
        console.log('[Enroll] ✅ Sab phrases complete — average embedding ban rahi hai...')

        const dim = newSamples[0].length
        const avgEmbedding = new Array(dim).fill(0)
        for (const emb of newSamples) {
          for (let i = 0; i < dim; i++) avgEmbedding[i] += emb[i]
        }
        for (let i = 0; i < dim; i++) avgEmbedding[i] /= newSamples.length

        let norm = 0
        for (const v of avgEmbedding) norm += v * v
        norm = Math.sqrt(norm) || 1
        const normalizedEmbedding = avgEmbedding.map(v => v / norm)

        const profile = {
          embedding: normalizedEmbedding,
          createdAt: Date.now(),
          sampleCount: 5,
        }

        await window.jarvis.saveVoiceProfile(profile)
        setVoiceProfile(profile)
        voiceProfileRef.current = profile

        setEnrollComplete(true)
        setEnrollDialogOpen(false)
        setEnrollMode(false)
        setEnrollSamples([])
        enrollSamplesRef.current = []
        setEnrollPhraseIndex(0)
        enrollPhraseIndexRef.current = 0
        setEnrollPhraseStatus('idle')

        console.log('[Enroll] ✅ Enrollment complete (5 samples)')
        speakText('Perfect! Aapki awaaz enroll ho gayi. Ab aap baat kar sakte hain.')
        setVadStatus('idle')
      }
    } catch (e: any) {
      setError(`Enrollment failed: ${e?.message || String(e)}`)
      setEnrollPhraseStatus('idle')
    }
  }

  const deleteVoiceProfile = async () => {
    await window.jarvis.deleteVoiceProfile()
    setVoiceProfile(null); voiceProfileRef.current = null
    setReplyText('Voice profile deleted.')
  }

  // ══════════════════════════════════════════════════════════════════════
  // ✅ SEND TO GEMINI (Streaming)
  // ══════════════════════════════════════════════════════════════════════
  const sendToGemini = async () => {
    if (!audioBlobRef.current) return
    sendingRef.current = true; setError('')

    try {
      // Enrollment mode
      if (enrollModeRef.current && enrollDialogOpen) {
        console.log('[AudioTest] 🎓 Enrollment mode')
        await enrollVoice(audioBlobRef.current)
        return
      }

      // Voice Verification (50% Threshold)
      if (verificationEnabledRef.current && voiceProfileRef.current) {
        const newEmbedding = await getVoiceEmbedding(audioBlobRef.current)
        const similarity = cosineSimilarity(newEmbedding, voiceProfileRef.current.embedding)
        setSimilarityScore(similarity)
        console.log(`[AudioTest] Similarity: ${(similarity * 100).toFixed(1)}%`)
        if (similarity < 0.50) {
          setError(`❌ Voice match fail (${(similarity * 100).toFixed(0)}%)`)
          setVadStatus('listening'); return
        }
      }

      // Audio → Text
      const base64 = await blobToWavBase64(audioBlobRef.current)
      const res = await window.jarvis.audioToTextStream(base64, 'audio/wav')
      if (!res.ok) { setError(res.error || 'Audio->Text failed'); setVadStatus('listening'); return }
      const userMessage = (res.reply || '').trim()
      setUserText(userMessage)
      if (!userMessage) { setError('No speech detected'); setVadStatus('listening'); return }

      // Command verb check
      if (!isValidCommand(userMessage)) {
        console.log(`[AudioTest] ⏭️ Invalid command: "${userMessage}"`)
        setVadStatus('listening')
        return
      }

      // ✅ Execute with STREAMING
      console.log(`[AudioTest] ✅ Command: "${userMessage}"`)
      setStreamingReply('')
      streamBufferRef.current = ''

      const chatReply = await window.jarvis.chatSendStream(userMessage)
      setReplyText(chatReply.text || '')
      if (chatReply.toolsUsed) setToolsUsed(chatReply.toolsUsed)

      setVadStatus('listening')
    } catch (e: any) {
      setError(`Send failed: ${e.message}`)
      setVadStatus('listening')
    } finally {
      sendingRef.current = false
    }
  }

  const blobToWavBase64 = async (blob: Blob): Promise<string> => {
    const arrayBuffer = await blob.arrayBuffer()
    const audioCtx = new AudioContext({ sampleRate: 16000 })
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
    const ch0 = audioBuffer.getChannelData(0)
    const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0
    const mono = new Float32Array(ch0.length)
    for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) / 2
    const int16 = new Int16Array(mono.length)
    for (let i = 0; i < mono.length; i++) { const s = Math.max(-1, Math.min(1, mono[i])); int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff }
    const wavBuffer = new ArrayBuffer(44 + int16.length * 2)
    const view = new DataView(wavBuffer)
    const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }
    writeStr(0, 'RIFF'); view.setUint32(4, 36 + int16.length * 2, true); writeStr(8, 'WAVE'); writeStr(12, 'fmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, 16000, true); view.setUint32(28, 16000 * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
    writeStr(36, 'data'); view.setUint32(40, int16.length * 2, true)
    for (let i = 0; i < int16.length; i++) view.setInt16(44 + i * 2, int16[i], true)
    const bytes = new Uint8Array(wavBuffer)
    let binary = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any)
    return btoa(binary)
  }

  // ── Cleanup ────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel()
      if (streamSpeakTimerRef.current) clearTimeout(streamSpeakTimerRef.current)
      if (vadRecorderRef.current) try { vadRecorderRef.current.destroy?.() } catch {}
    }
  }, [])

  // ── Styles ─────────────────────────────────────────────────────────────
  const box: React.CSSProperties = { padding: 20, fontFamily: 'system-ui', maxWidth: 700, margin: '0 auto', color: '#e0e0e0' }
  const section: React.CSSProperties = { marginBottom: 20, padding: 16, background: '#1e1e1e', borderRadius: 8, border: '1px solid #333' }
  const select: React.CSSProperties = { width: '100%', padding: 10, fontSize: 14, background: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: 4, boxSizing: 'border-box', marginBottom: 10 }
  const btn = (color: string): React.CSSProperties => ({ padding: '10px 20px', fontSize: 14, background: color, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', marginRight: 8 })

  const statusColor = vadStatus === 'listening' ? '#4caf50' : vadStatus === 'speech' ? '#f44336' : vadStatus === 'processing' ? '#ff9800' : '#888'
  const statusText = vadStatus === 'listening' ? '🎙️ Listening...' : vadStatus === 'speech' ? '🔴 Recording...' : vadStatus === 'processing' ? '⏳ Processing...' : '⏹️ Idle'

  return (
    <div style={box}>
      <h1 style={{ color: '#4a90d9' }}>🎤 Voice Assistant</h1>
      <p style={{ color: '#888', fontSize: 13 }}>
        Stonic-style: Bas bolein — koi command prefix nahi, koi wake word nahi
      </p>

      {/* Profile Status */}
      <div style={{ ...section, background: voiceProfile ? '#1b3a1b' : '#3a2a1b', borderColor: voiceProfile ? '#4caf50' : '#ff9800', padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong style={{ color: voiceProfile ? '#4caf50' : '#ff9800' }}>
              {voiceProfile ? `✅ Voice Enrolled (${voiceProfile.sampleCount} samples)` : '⚠️ Voice Not Enrolled'}
            </strong>
          </div>
          <div>
            <button onClick={() => setVerificationEnabled(!verificationEnabled)} style={{ padding: '6px 12px', fontSize: 12, background: verificationEnabled ? '#4caf50' : '#666', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', marginRight: 8 }}>
              {verificationEnabled ? '🔒 Verify ON' : '🔓 Verify OFF'}
            </button>
            {voiceProfile && <button onClick={deleteVoiceProfile} style={{ padding: '6px 12px', fontSize: 12, background: '#c62828', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>🗑 Delete</button>}
          </div>
        </div>
      </div>

      {/* Enrollment Button */}
      {!voiceProfile && !enrollDialogOpen && (
        <div style={{ ...section, background: '#1b2a3a', borderColor: '#4a90d9' }}>
          <h3>🎓 Voice Enrollment</h3>
          <p style={{ fontSize: 13, color: '#aaa' }}>
            Siri jaisa setup — 5 phrases bolein, aapki awaaz enroll ho jayegi
          </p>
          <button
            onClick={() => {
              setEnrollMode(true)
              setEnrollDialogOpen(true)
              setEnrollPhraseIndex(0)
              enrollPhraseIndexRef.current = 0
              setEnrollSamples([])
              enrollSamplesRef.current = []
              setEnrollComplete(false)
              setEnrollPhraseStatus('idle')

              setTimeout(() => {
                speakText(ENROLL_PHRASES[0])
                setTimeout(() => startVad(), 1500)
              }, 500)
            }}
            disabled={!modelReady}
            style={btn(modelReady ? '#4caf50' : '#444')}
          >
            {modelReady ? '🎤 Voice Enrollment (5 Phrases)' : '⏳ Loading...'}
          </button>
        </div>
      )}

      {/* Siri-Style Enrollment Dialog */}
      {enrollDialogOpen && !enrollComplete && (
        <div style={{ ...section, background: '#1b2a3a', borderColor: '#4a90d9', padding: 24 }}>
          <h2 style={{ margin: '0 0 16px 0', color: '#4a90d9', textAlign: 'center' }}>🎤 Voice Setup</h2>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 20 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} style={{
                width: 40, height: 40, borderRadius: '50%',
                background: i < enrollSamples.length ? '#4caf50' : i === enrollPhraseIndex ? '#4a90d9' : '#333',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 'bold', fontSize: 14,
                transition: 'background 0.3s',
              }}>
                {i < enrollSamples.length ? '✓' : i + 1}
              </div>
            ))}
          </div>

          <div style={{ background: '#0d1b2a', padding: 24, borderRadius: 8, marginBottom: 20, textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
              Phrase {enrollPhraseIndex + 1} / 5 — Bolein:
            </p>
            <p style={{ fontSize: 22, color: '#4caf50', fontWeight: 'bold', margin: 0 }}>
              "{ENROLL_PHRASES[enrollPhraseIndex]}"
            </p>
          </div>

          <div style={{ textAlign: 'center', fontSize: 14, color: '#aaa' }}>
            {enrollPhraseStatus === 'idle' && '🎙️ Taiyar hain? Bolein...'}
            {enrollPhraseStatus === 'recording' && '🔴 Sun raha hoon...'}
            {enrollPhraseStatus === 'done' && '✅ Shukriya! Agla phrase aa raha hai...'}
          </div>

          <div style={{ marginTop: 20, textAlign: 'center' }}>
            <button
              onClick={() => {
                setEnrollDialogOpen(false)
                setEnrollMode(false)
                setEnrollSamples([])
                enrollSamplesRef.current = []
                setEnrollPhraseIndex(0)
                enrollPhraseIndexRef.current = 0
                setEnrollPhraseStatus('idle')
                stopVad()
                window.speechSynthesis.cancel()
              }}
              style={{
                padding: '8px 16px', fontSize: 13,
                background: 'transparent', color: '#888',
                border: '1px solid #555', borderRadius: 4, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Enrollment Complete */}
      {enrollComplete && (
        <div style={{ ...section, background: '#1b3a1b', borderColor: '#4caf50', padding: 24, textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 8px 0', color: '#4caf50' }}>✅ Voice Setup Complete!</h2>
          <p style={{ color: '#aaa', margin: 0 }}>
            Aapki awaaz 5 phrases se enroll ho gayi. Ab aap baat kar sakte hain.
          </p>
          <button
            onClick={() => setEnrollComplete(false)}
            style={{
              marginTop: 16, padding: '10px 24px', fontSize: 14,
              background: '#4caf50', color: '#fff',
              border: 'none', borderRadius: 4, cursor: 'pointer',
            }}
          >
            Theek Hai
          </button>
        </div>
      )}

      {/* Main Control Panel */}
      {!enrollDialogOpen && (
        <div style={{ ...section, background: continuousMode ? '#1b3a1b' : '#2a2a2a', borderColor: continuousMode ? '#4caf50' : '#555', padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0, color: continuousMode ? '#4caf50' : '#e0e0e0' }}>{continuousMode ? statusText : '🎙️ Voice Assistant'}</h3>
              <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#888' }}>
                {continuousMode ? (echoSafeMode ? 'Echo-Safe Mode: TTS ke doran mic pause' : 'Full-Duplex Mode: Barge-in enabled') : 'Start dabayein → bas baat karein jaise dost se'}
              </p>
            </div>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
          </div>

          {!continuousMode ? (
            <button onClick={() => { setContinuousMode(true); setTimeout(() => startVad(), 300) }} disabled={!permissionGranted} style={{ padding: '12px 24px', fontSize: 15, fontWeight: 'bold', background: permissionGranted ? '#4caf50' : '#444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              ▶ Start Assistant
            </button>
          ) : (
            <button onClick={() => { setContinuousMode(false); stopVad(); window.speechSynthesis.cancel(); isSpeakingRef.current = false; ttsActiveRef.current = false; speakQueueRef.current = []; setSpeaking(false); setVadStatus('idle') }} style={{ padding: '12px 24px', fontSize: 15, fontWeight: 'bold', background: '#c62828', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              ⏹ Stop Assistant
            </button>
          )}
        </div>
      )}

      {/* Settings */}
      {!enrollDialogOpen && (
        <div style={{ ...section, background: '#1b2a3a', borderColor: '#4a90d9', padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>⚙️ Settings</h3>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <input type="checkbox" id="echoSafe" checked={echoSafeMode} onChange={(e) => setEchoSafeMode(e.target.checked)} style={{ marginRight: 8 }} />
            <label htmlFor="echoSafe" style={{ fontSize: 13 }}>Echo-Safe Mode (Use without Headphones)</label>
          </div>
          <p style={{ fontSize: 11, color: '#888', margin: 0 }}>Agar aap headphone use nahi kar rahe, to ye ON rakhein. TTS ke doran mic pause ho jayega.</p>
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 13 }}>Microphone: </label>
            <select value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)} style={{ ...select, marginTop: 4 }} disabled={continuousMode}>
              {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 6)}`}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Status */}
      {!enrollDialogOpen && (
        <div style={{ ...section, background: '#2a2a2a', borderColor: statusColor, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span><strong>Status:</strong> {statusText}</span>
            {similarityScore !== null && <span style={{ color: similarityScore >= 0.5 ? '#4caf50' : '#f44336' }}>🎤 {(similarityScore * 100).toFixed(1)}%</span>}
          </div>
        </div>
      )}

      {userText && !enrollDialogOpen && <div style={{ ...section, background: '#1b2a3a', borderColor: '#4a90d9' }}><h3>🗣️ You said</h3><p>{userText}</p></div>}
      {ackText && !enrollDialogOpen && <div style={{ ...section, background: '#3a2a1b', borderColor: '#ff9800' }}><h3>💬 Ack</h3><p>{ackText}</p></div>}

      {/* ✅ Streaming Reply — word by word */}
      {(streamingReply || replyText) && !enrollDialogOpen && (
        <div style={{ ...section, background: '#1b3a1b', borderColor: '#4caf50' }}>
          <h3>🤖 Reply {detectedLang && `(${detectedLang})`}</h3>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {streamingReply || replyText}
            {streamingReply && !replyText && <span style={{ opacity: 0.5, marginLeft: 2 }}>▌</span>}
          </p>
          {toolsUsed.length > 0 && <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>🔧 {toolsUsed.join(', ')}</p>}
        </div>
      )}

      {speaking && !enrollDialogOpen && <div style={{ ...section, background: '#2a1b3a', borderColor: '#9c27b0' }}>🔊 <strong>Speaking…</strong></div>}
      {error && permissionGranted && !enrollDialogOpen && <div style={{ ...section, background: '#3a1b1b', borderColor: '#f44336' }}><strong>{error}</strong></div>}
    </div>
  )
}
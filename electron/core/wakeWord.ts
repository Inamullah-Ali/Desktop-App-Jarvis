import { OpenWakeWord } from 'openwakeword-web'
import { Microphone } from 'openwakeword-web/microphone'
import { EventEmitter } from 'node:events'

// ══════════════════════════════════════════════════════════════════════════
// WAKE WORD DETECTOR — OpenWakeWord (100% Free, No Signup)
// ══════════════════════════════════════════════════════════════════════════
export class WakeWordDetector extends EventEmitter {
  private oww: any = null
  private mic: any = null
  private isListening: boolean = false
  private lastDetection: number = 0
  private cooldownMs: number = 3000   // 3 second cooldown

  constructor() {
    super()
  }

  // ── Start listening ────────────────────────────────────────────────────
  async start(): Promise<void> {
    if (this.isListening) return

    try {
      console.log('[WakeWord] Initializing OpenWakeWord...')

      // ✅ OpenWakeWord initialize karein — "hey_jarvis" model ke saath
      this.oww = await OpenWakeWord.create({
        baseUrl: './models/',           // Models yahan se load honge
        wakewordModels: ['hey_jarvis'], // ✅ Pre-trained "Hey Jarvis" model
        threshold: 0.5,                 // Detection sensitivity (0.5 default)
        onDetection: ({ label, score }: any) => {
          const now = Date.now()
          if (now - this.lastDetection < this.cooldownMs) return   // Cooldown

          this.lastDetection = now
          console.log(`[WakeWord] 🎤 "${label}" detected! (score: ${score.toFixed(2)})`)
          this.emit('wake', label)
        },
      })

      // ✅ Microphone se audio capture karein
      this.mic = new Microphone(async (frame: Int16Array) => {
        if (!this.oww) return
        await this.oww.predict(frame)   // Frame ko model ko bhejein
      })

      await this.mic.start()
      this.isListening = true
      console.log('[WakeWord] ✅ Listening for "Hey Jarvis"...')
      this.emit('ready')
    } catch (e: any) {
      console.error('[WakeWord] Initialization failed:', e)
      this.emit('error', e)
      this.isListening = false
    }
  }

  // ── Stop listening ──────────────────────────────────────────────────────
  stop(): void {
    if (!this.isListening) return
    this.isListening = false

    try {
      if (this.mic) {
        this.mic.stop()
        this.mic = null
      }
      if (this.oww) {
        this.oww = null
      }
      console.log('[WakeWord] Stopped')
    } catch (e) {
      console.error('[WakeWord] Stop error:', e)
    }
  }
}
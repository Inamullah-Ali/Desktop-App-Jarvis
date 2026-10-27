declare module '@edyrkaj/openwakeword-wasm-browser' {
  interface WakeWordOptions {
    baseAssetUrl?: string
    ortWasmPath?: string
    keywords?: string[]
    detectionThreshold?: number
    cooldownMs?: number
  }

  interface DetectionEvent {
    keyword: string
    score: number
  }

  type EventName = 'detect' | 'speech-start' | 'speech-end' | 'error'

  export default class WakeWordEngine {
    constructor(options?: WakeWordOptions)
    load(): Promise<void>
    start(): Promise<void>
    stop(): void
    on(event: EventName, callback: (data: any) => void): void
    off(event: EventName, callback: (data: any) => void): void
  }
}
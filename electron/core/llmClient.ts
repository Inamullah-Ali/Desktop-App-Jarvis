import axios from 'axios'
import { loadApiKeys } from './configManager'

// ── Config ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
  llm_url: 'http://localhost:11434',
  llm_model: 'llama3.2',
  llm_provider: 'ollama',
}

export function getLlmProvider(): 'ollama' | 'openai' {
  const raw = String(loadApiKeys().llm_provider || 'ollama').toLowerCase()
  return ['openai', 'lmstudio', 'localai', 'jan', 'llamacpp'].includes(raw)
    ? 'openai' : 'ollama'
}

export function getLlmSettings(): [string, string] {
  const cfg = loadApiKeys()
  const url = String(cfg.llm_url || DEFAULTS.llm_url).replace(/\/$/, '')
  const model = String(cfg.llm_model || DEFAULTS.llm_model)
  return [url, model]
}

// ── Health Check ───────────────────────────────────────────────────────────
export async function ensureLlmRunning(timeout = 15): Promise<boolean> {
  const [url] = getLlmSettings()
  const provider = getLlmProvider()

  if (provider === 'openai') {
    try {
      const res = await axios.get(`${url}/v1/models`, { timeout: 5000 })
      const ok = res.status === 200
      console.log(ok
        ? `[LLM] OpenAI-compatible server reachable at ${url}`
        : `[LLM] Server at ${url} returned non-200`)
      return ok
    } catch {
      console.log(`[LLM] Cannot reach OpenAI-compatible server at ${url}`)
      return false
    }
  }

  // Ollama
  const health = `${url}/api/tags`
  try {
    const res = await axios.get(health, { timeout: 3000 })
    if (res.status === 200) return true
  } catch {
    // Not running — try to launch
  }

  console.log('[LLM] Ollama not running — attempting to launch')
  // Node.js mein ollama serve launch karna OS-specific hai
  // Filhaal sirf warning
  return false
}

// ── Non-Streaming Call ─────────────────────────────────────────────────────
export interface LlmResponse {
  content: string
  tool_calls: any[]
}

export async function callLlm(
  messages: any[],
  tools: any[] | null = null,
  timeout = 120,
): Promise<LlmResponse> {
  const [url, model] = getLlmSettings()
  const provider = getLlmProvider()

  if (provider === 'openai') {
    const endpoint = `${url}/v1/chat/completions`
    const payload: any = {
      model, messages, stream: false, max_tokens: 150,
    }
    if (tools) {
      payload.tools = tools
      payload.tool_choice = 'auto'
    }
    try {
      const res = await axios.post(endpoint, payload, { timeout: timeout * 1000 })
      const choice = res.data.choices?.[0] || {}
      const msg = choice.message || {}
      const rawTc = msg.tool_calls || []
      const tcList = rawTc.map((t: any) => ({
        id: t.id || '',
        function: {
          name: t.function.name,
          arguments: typeof t.function.arguments === 'string'
            ? JSON.parse(t.function.arguments)
            : t.function.arguments || {},
        },
      }))
      return { content: (msg.content || '').trim(), tool_calls: tcList }
    } catch (e: any) {
      throw new Error(`OpenAI-compatible LLM call failed: ${e.message}`)
    }
  }

  // Ollama
  const endpoint = `${url}/api/chat`
  const payload: any = {
    model, messages, stream: false, keep_alive: -1,
    options: { num_predict: 150, num_gpu: 99 },
  }
  if (tools) payload.tools = tools

  try {
    const res = await axios.post(endpoint, payload, { timeout: timeout * 1000 })
    const msg = res.data.message || {}
    return {
      content: (msg.content || '').trim(),
      tool_calls: msg.tool_calls || [],
    }
  } catch (e: any) {
    if (e.code === 'ECONNREFUSED') {
      throw new Error(`Cannot connect to Ollama at ${url}. Make sure Ollama is running.`)
    }
    throw new Error(`Ollama call failed: ${e.message}`)
  }
}

// ── Text-Only Call ─────────────────────────────────────────────────────────
export async function callLlmText(
  prompt: string,
  system: string | null = null,
  model: string | null = null,
  timeout = 120,
): Promise<string> {
  const [url, defaultModel] = getLlmSettings()
  const endpoint = `${url}/api/chat`
  const m = model || defaultModel

  const messages: any[] = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })

  const payload = {
    model: m, messages, stream: false, keep_alive: -1,
    options: { num_predict: 600 },
  }

  try {
    const res = await axios.post(endpoint, payload, { timeout: timeout * 1000 })
    return (res.data.message?.content || '').trim()
  } catch (e: any) {
    throw new Error(`LLM text call failed: ${e.message}`)
  }
}

// ── Streaming Call (Ollama) ────────────────────────────────────────────────
export async function* callLlmStream(
  messages: any[],
  tools: any[] | null = null,
  timeout = 120,
): AsyncGenerator<{ type: string; text?: string; content?: string; tool_calls?: any[] }> {
  const [url, model] = getLlmSettings()
  const endpoint = `${url}/api/chat`

  const payload: any = {
    model, messages, stream: true, keep_alive: -1,
    options: { num_predict: 150, num_gpu: 99 },
  }
  if (tools) payload.tools = tools

  const res = await axios.post(endpoint, payload, {
    timeout: timeout * 1000,
    responseType: 'stream',
  })

  let buffer = ''
  let fullContent = ''
  const toolCalls: any[] = []

  // Simple sentence boundary regex
  const sentenceEnd = /(?<=[.!?])\s+|(?<=\n)\s*\n/

  for await (const chunk of res.data) {
    const lines = chunk.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      let parsed: any
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      const msg = parsed.message || {}
      const delta = msg.content || ''
      fullContent += delta
      buffer += delta

      // Yield complete sentences
      let m: RegExpMatchArray | null
      while ((m = buffer.match(sentenceEnd))) {
        const idx = m.index!
        const sentence = buffer.slice(0, idx + 1).trim()
        buffer = buffer.slice(idx + m[0].length)
        if (sentence) yield { type: 'sentence', text: sentence }
      }

      if (msg.tool_calls) toolCalls.push(...msg.tool_calls)

      if (parsed.done) {
        if (buffer.trim()) yield { type: 'sentence', text: buffer.trim() }
        yield { type: 'done', content: fullContent.trim(), tool_calls: toolCalls }
        return
      }
    }
  }
}

// ── Warmup ─────────────────────────────────────────────────────────────────
export async function warmupModel(systemPrompt: string | null = null): Promise<boolean> {
  const [url, model] = getLlmSettings()
  const provider = getLlmProvider()
  console.log(`[LLM] Warming up '${model}' (${provider})`)

  const messages: any[] = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
  messages.push({ role: 'user', content: 'hi' })

  try {
    if (provider === 'openai') {
      await axios.post(`${url}/v1/chat/completions`, {
        model, messages, stream: false, max_tokens: 1,
      }, { timeout: 180000 })
    } else {
      await axios.post(`${url}/api/chat`, {
        model, messages, stream: false, keep_alive: -1,
        options: { num_predict: 1, num_gpu: 99 },
      }, { timeout: 180000 })
    }
    console.log(`[LLM] '${model}' ready`)
    return true
  } catch (e: any) {
    console.log(`[LLM] Warmup failed (non-fatal): ${e.message}`)
    return false
  }
}
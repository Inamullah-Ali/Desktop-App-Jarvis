import { geminiJson, geminiText, FAST } from './gemini'
import { buildSystemPrompt } from './promptBuilder'
import { updateMemory, loadMemory } from '../memory/memoryManager'
import { ALL_TOOLS, executeTool } from '../actions'
import { getGeminiKey, getUserName } from './configManager'
import { collection, addDoc, doc, setDoc } from 'firebase/firestore' // ✅ setDoc import
import { db, auth } from './firebase'
import { notifyDesktopTask } from './pushNotifications'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface ChatReply {
  text: string
  memorySaved?: boolean
  toolsUsed?: string[]
}

class ChatSession {
  private history: ChatMessage[] = []
  private maxHistory = 40

  getHistory(): ChatMessage[] {
    return [...this.history]
  }

  clearHistory(): void {
    this.history = []
  }

  // ══════════════════════════════════════════════════════════════════════
  // ✅ FIRESTORE: Message save karein
  // ══════════════════════════════════════════════════════════════════════
  private async saveMessageToFirestore(role: 'user' | 'assistant', content: string) {
    try {
      const userId = auth.currentUser?.uid || 'unknown_user'
      
      await addDoc(collection(db, 'messages'), {
        userId: userId,
        role: role,
        content: content,
        timestamp: Date.now()
      })
      console.log(`[Firestore] ✅ Message saved (${role})`)
    } catch (e) {
      console.error('[Firestore] Message save failed:', e)
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ✅ GEMINI SE NATURAL ACKNOWLEDGMENT
  // ══════════════════════════════════════════════════════════════════════
  private async getNaturalAcknowledgment(
    toolName: string,
    userName: string,
    userMessage: string,
  ): Promise<string> {
    const name = userName || 'Ali'

    const toolContext: Record<string, string> = {
      open_app: 'app khol raha hai',
      get_weather: 'mausam dekh raha hai',
      get_news: 'news la raha hai',
      web_search: 'search kar raha hai',
      google_search: 'Google par search kar raha hai',
      set_reminder: 'reminder set kar raha hai',
      snooze_reminder: 'reminder snooze kar raha hai',
      list_reminders: 'reminders dekh raha hai',
      cancel_reminder: 'reminder hata raha hai',
      system_status: 'system check kar raha hai',
      system_monitor: 'system monitor kar raha hai',
      file_controller: 'file par kaam kar raha hai',
      search_files: 'files dhundh raha hai',
      set_volume: 'volume set kar raha hai',
      set_brightness: 'brightness set kar raha hai',
      toggle_dark_mode: 'dark mode change kar raha hai',
      get_time: 'time dekh raha hai',
      get_date: 'date dekh raha hai',
      undo: 'wapas kar raha hai',
    }

    const context = toolContext[toolName] || 'kaam kar raha hai'

    try {
      const prompt =
        `Ek chota sa natural acknowledgment banao (Roman Urdu ya user ki language mein). ` +
        `User ka naam "${name}" hai. ` +
        `User ne kaha: "${userMessage}". ` +
        `Tum abhi ${context} — is baat ka natural, warm, dost jaisa acknowledgment do. ` +
        `Sirf 1 short sentence. ` +
        `Misaal:\n` +
        `- "Theek hai ${name}, Chrome khol raha hoon..."\n` +
        `- "Bilkul ${name}, abhi dekhta hoon..."\n` +
        `- "Haan ${name}, ruko zara..."\n` +
        `- "Achha, Google par search kar raha hoon..."\n` +
        `Robotic mat bolo. "Processing" ya "Acknowledged" bilkul mat bolo. ` +
        `Sirf acknowledgment do — koi extra explanation nahi.`

      const ack = await geminiText(
        prompt,
        FAST,
        {
          systemInstruction:
            'Tum ek friendly assistant ho. Sirf ek chota natural acknowledgment do (1 sentence). ' +
            'Koi markdown, koi emoji, koi extra text nahi.',
        },
        10_000,
      )

      const cleaned = (ack || '').trim().replace(/^["']|["']$/g, '')
      if (cleaned && cleaned.length > 3 && cleaned.length < 200) {
        console.log(`[ChatSession] ✅ Gemini natural ack: "${cleaned}"`)
        return cleaned
      }
    } catch (e: any) {
      console.log(`[ChatSession] Natural ack failed: ${e?.message || String(e)}`)
    }

    const fallbacks: Record<string, string> = {
      open_app: `Theek hai ${name}, khol raha hoon...`,
      get_weather: `${name}, mausam dekh raha hai...`,
      get_news: `Ek second ${name}, news la raha hai...`,
      web_search: `Ruko ${name}, search kar raha hai...`,
      google_search: `Ruko ${name}, Google par search kar raha hai...`,
      set_reminder: `Theek hai ${name}, yaad dila dunga...`,
      system_status: `Ek second ${name}, check kar raha hai...`,
      default: `Theek hai ${name}, dekhta hoon...`,
    }
    return fallbacks[toolName] || fallbacks.default
  }

  // ══════════════════════════════════════════════════════════════════════
  // ✅ SEND
  // ══════════════════════════════════════════════════════════════════════
  async send(
    userMessage: string,
    onAcknowledgment?: (text: string) => void | Promise<void>,
  ): Promise<ChatReply> {
    const msg = (userMessage || '').trim()
    if (!msg) return { text: '' }

    this.history.push({
      role: 'user',
      content: msg,
      timestamp: Date.now(),
    })
    this.trimHistory()

    await this.saveMessageToFirestore('user', msg)

    const systemPrompt = buildSystemPrompt()
    const conversationContext = this.buildConversationContext()
    const userName = getUserName() || ''

    let replyText = ''
    const toolsUsed: string[] = []
    let ackText = ''

    try {
      const { GoogleGenAI } = await import('@google/genai')
      const key = getGeminiKey()
      if (!key) throw new Error('No Gemini API key')

      const client = new GoogleGenAI({ apiKey: key })

      const models = [
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-3.5-flash',
        'gemini-3.8-flash',
      ]

      const toolsConfig: any[] = [
        { functionDeclarations: ALL_TOOLS },
      ]

      const toolConfig = {
        functionCallingConfig: {
          mode: 'AUTO' as const,
        },
      }

      const workingContents: any[] = [...conversationContext]

      let response: any = null
      let lastError: any = null

      for (const model of models) {
        try {
          console.log(
            `[ChatSession] Trying ${model} with ${ALL_TOOLS.length} tools`,
          )
          response = await client.models.generateContent({
            model,
            contents: workingContents,
            config: {
              systemInstruction: systemPrompt,
              tools: toolsConfig,
              toolConfig,
            } as any,
          })
          break
        } catch (e: any) {
          lastError = e
          const errMsg = String(e?.message || e)
          console.log(`[ChatSession] ${model} failed: ${errMsg.slice(0, 120)}`)

          if (errMsg.includes('503') || errMsg.includes('UNAVAILABLE')) {
            console.log(`[ChatSession] ⏳ 503 high demand — 3s wait, retry...`)
            await new Promise((r) => setTimeout(r, 3000))
            try {
              response = await client.models.generateContent({
                model,
                contents: workingContents,
                config: {
                  systemInstruction: systemPrompt,
                  tools: toolsConfig,
                  toolConfig,
                } as any,
              })
              console.log(`[ChatSession] ✅ Retry successful (${model})`)
              break
            } catch (retryErr: any) {
              console.log(`[ChatSession] ${model} retry failed — next model`)
              continue
            }
          }

          if (
            errMsg.includes('429') ||
            errMsg.includes('RESOURCE_EXHAUSTED') ||
            errMsg.includes('404') ||
            errMsg.includes('NOT_FOUND')
          ) {
            continue
          }
          continue
        }
      }

      if (!response) throw lastError || new Error('All models failed')

      const MAX_TOOL_ROUNDS = 5
      let rounds = 0
      let ackSent = false

      while (rounds < MAX_TOOL_ROUNDS) {
        rounds++

        const candidate = response.candidates?.[0]
        const modelParts: any[] = candidate?.content?.parts || []

        const functionCallParts: any[] = []
        for (const part of modelParts) {
          if (part.functionCall) functionCallParts.push(part)
        }

        console.log(`[ChatSession] Round ${rounds}: ${functionCallParts.length} function calls`)

        if (rounds === 1 && functionCallParts.length > 0 && !ackSent) {
          const toolName = functionCallParts[0]?.functionCall?.name || ''
          const naturalAck = await this.getNaturalAcknowledgment(toolName, userName, msg)
          ackText = naturalAck
          console.log(`[ChatSession] 🔊 Natural ack: "${naturalAck}"`)
          await onAcknowledgment?.(naturalAck)
          ackSent = true
        }

        if (functionCallParts.length === 0) {
          replyText = (response.text || '').trim()
          break
        }

        const functionResponses: any[] = []
        for (const part of functionCallParts) {
          const call = part.functionCall
          const toolName = call.name
          const args = call.args || {}
          toolsUsed.push(toolName)
          console.log(`[ChatSession] Executing tool: ${toolName}`)
          const result = await executeTool(toolName, args)
          functionResponses.push({
            functionResponse: { name: toolName, response: { result } },
          })
        }

        workingContents.push({ role: 'model', parts: modelParts })
        workingContents.push({ role: 'user', parts: functionResponses })

        let followUpSuccess = false
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            response = await client.models.generateContent({
              model: models[0],
              contents: workingContents,
              config: {
                systemInstruction: systemPrompt,
                tools: toolsConfig,
                toolConfig,
              } as any,
            })
            followUpSuccess = true
            break
          } catch (e: any) {
            const errMsg = String(e?.message || e)
            console.error(`[ChatSession] Round ${rounds} follow-up failed (attempt ${attempt + 1}):`, errMsg.slice(0, 120))

            if (errMsg.includes('503') || errMsg.includes('UNAVAILABLE')) {
              if (attempt < 2) {
                console.log(`[ChatSession] ⏳ 503 — waiting ${(attempt + 1) * 3}s before retry...`)
                await new Promise((r) => setTimeout(r, (attempt + 1) * 3000))
                continue
              }
            }
            if (attempt === 2) throw e
          }
        }
        if (!followUpSuccess) {
          throw new Error('Follow-up call failed after 3 attempts')
        }
      }

      if (!replyText) replyText = (response?.text || '').trim()

      if (ackSent && ackText && replyText) {
        const ackNorm = ackText.toLowerCase().trim()
        const finalNorm = replyText.toLowerCase().trim()
        if (ackNorm === finalNorm) {
          replyText = ackText
        }
      }
    } catch (e: any) {
      console.error('[ChatSession] Gemini call failed:', e)
      return { text: `Error: ${e?.message || String(e)}`, toolsUsed }
    }

    if (!replyText) replyText = 'No reply from Gemini.'

    this.history.push({
      role: 'assistant',
      content: replyText,
      timestamp: Date.now(),
    })
    this.trimHistory()

    await this.saveMessageToFirestore('assistant', replyText)

    const memorySaved = await this.tryExtractMemory(msg, replyText)
    this.notifyTaskCompletion(toolsUsed)
    return { text: replyText, memorySaved, toolsUsed }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ✅ SEND STREAM
  // ══════════════════════════════════════════════════════════════════════
  async sendStream(
    userMessage: string,
    onChunk: (text: string, done: boolean) => void,
    onAcknowledgment?: (text: string) => void | Promise<void>,
  ): Promise<ChatReply> {
    const msg = (userMessage || '').trim()
    if (!msg) return { text: '' }

    this.history.push({
      role: 'user',
      content: msg,
      timestamp: Date.now(),
    })
    this.trimHistory()

    await this.saveMessageToFirestore('user', msg)

    const systemPrompt = buildSystemPrompt()
    const conversationContext = this.buildConversationContext()
    const userName = getUserName() || ''

    let fullReply = ''
    const toolsUsed: string[] = []
    let ackText = ''

    try {
      const { GoogleGenAI } = await import('@google/genai')
      const key = getGeminiKey()
      if (!key) throw new Error('No Gemini API key')

      const client = new GoogleGenAI({ apiKey: key })

      const models = [
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-3.5-flash',
        'gemini-3.8-flash',
      ]

      const toolsConfig: any[] = [
        { functionDeclarations: ALL_TOOLS },
      ]

      const toolConfig = {
        functionCallingConfig: { mode: 'AUTO' as const },
      }

      const workingContents: any[] = [...conversationContext]
      let ackSent = false
      let model: string = models[0]

      let response: any = null
      let lastError: any = null

      for (const m of models) {
        try {
          console.log(`[ChatSession-Stream] Trying ${m}`)
          response = await client.models.generateContent({
            model: m,
            contents: workingContents,
            config: {
              systemInstruction: systemPrompt,
              tools: toolsConfig,
              toolConfig,
            } as any,
          })
          model = m
          break
        } catch (e: any) {
          lastError = e
          continue
        }
      }

      if (!response) throw lastError || new Error('All models failed')

      const MAX_TOOL_ROUNDS = 5
      let rounds = 0

      while (rounds < MAX_TOOL_ROUNDS) {
        rounds++

        const candidate = response.candidates?.[0]
        const modelParts: any[] = candidate?.content?.parts || []

        const functionCallParts: any[] = []
        for (const part of modelParts) {
          if (part.functionCall) functionCallParts.push(part)
        }

        console.log(`[ChatSession-Stream] Round ${rounds}: ${functionCallParts.length} function calls`)

        if (rounds === 1 && functionCallParts.length > 0 && !ackSent) {
          const toolName = functionCallParts[0]?.functionCall?.name || ''
          const naturalAck = await this.getNaturalAcknowledgment(toolName, userName, msg)
          ackText = naturalAck
          console.log(`[ChatSession-Stream] 🔊 Ack: "${naturalAck}"`)
          await onAcknowledgment?.(naturalAck)
          ackSent = true
        }

        if (functionCallParts.length === 0) {
          const finalText = (response.text || '').trim()
          if (finalText) {
            const words = finalText.split(/(\s+)/)
            for (const w of words) {
              fullReply += w
              onChunk(w, false)
              await new Promise((r) => setTimeout(r, 30))
            }
            onChunk('', true)
          }
          break
        }

        const functionResponses: any[] = []
        for (const part of functionCallParts) {
          const call = part.functionCall
          const toolName = call.name
          const args = call.args || {}
          toolsUsed.push(toolName)
          console.log(`[ChatSession-Stream] Executing: ${toolName}`)
          const result = await executeTool(toolName, args)
          functionResponses.push({
            functionResponse: { name: toolName, response: { result } },
          })
        }

        workingContents.push({ role: 'model', parts: modelParts })
        workingContents.push({ role: 'user', parts: functionResponses })

        try {
          const stream = await client.models.generateContentStream({
            model,
            contents: workingContents,
            config: {
              systemInstruction: systemPrompt,
              tools: toolsConfig,
              toolConfig,
            } as any,
          })

          let roundText = ''
          for await (const chunk of stream) {
            const chunkText = chunk.text || ''
            if (chunkText) {
              roundText += chunkText
              fullReply += chunkText
              onChunk(chunkText, false)
            }
          }
          if (roundText) onChunk('', true)
        } catch (e: any) {
          console.error(`[ChatSession-Stream] Round ${rounds} stream failed:`, e)
          throw e
        }
      }

      if (!fullReply) fullReply = 'No reply from Gemini.'

    } catch (e: any) {
      console.error('[ChatSession-Stream] Error:', e)
      return {
        text: `Error: ${e?.message || String(e)}`,
        toolsUsed,
      }
    }

    this.history.push({
      role: 'assistant',
      content: fullReply,
      timestamp: Date.now(),
    })
    this.trimHistory()

    await this.saveMessageToFirestore('assistant', fullReply)

    this.notifyTaskCompletion(toolsUsed)
    return { text: fullReply, toolsUsed }
  }

  private notifyTaskCompletion(toolNames: string[]): void {
    void notifyDesktopTask(toolNames).catch((error: unknown) => {
      console.error('[Push] Could not send desktop task notification:', error)
    })
  }

  // ── Build conversation context ──────────────────────────────────────────
  private buildConversationContext(): any[] {
    const recent = this.history.slice(-10)
    const contents: any[] = []
    for (const m of recent) {
      contents.push({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      })
    }
    return contents
  }

  private trimHistory(): void {
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory)
    }
  }

  // ✅ BRAIN: AI se memory extract karna + Firestore Sync
  private async tryExtractMemory(
    userMsg: string,
    assistantReply: string,
  ): Promise<boolean> {
    try {
      if (userMsg.trim().length < 5) return false

      console.log('[Brain] 🧠 Extracting memory from conversation...')

      const memoryPrompt =
        `Tum ek AI ho jo user ki baaton se facts nikaal kar save karta hai. ` +
        `User ne kaha: "${userMsg}"\n` +
        `Assistant ne jawab diya: "${assistantReply}"\n\n` +
        `In dono baaton ko parh kar sirf woh facts (baatein) nikaalo jo user ke baare mein hain. ` +
        `Facts ko in categories mein daalo (agar mehfooz karne ke qabil hain):\n` +
        `- identity: (Naam, age, shehar, kaam, language)\n` +
        `- preferences: (Pasand, napasand - e.g. "mujhe chai pasand hai")\n` +
        `- projects: (Kaam ya projects jo user kar raha hai)\n` +
        `- relationships: (Dost, family members ke naam)\n` +
        `- wishes: (Khwahishaat, future plans)\n` +
        `- notes: (Koi bhi aam baat jo yaad rakhni chahiye)\n\n` +
        `Sirf JSON format mein jawab do, koi markdown ya extra text nahi. ` +
        `Format yeh hona chahiye:\n` +
        `{\n` +
        `  "identity": { "name": "Ali" },\n` +
        `  "preferences": { "favorite_drink": "chai" },\n` +
        `  "notes": { "today_weather": "Lahore mein 30 degree hai" }\n` +
        `}\n` +
        `Agar koi fact nahi mila to empty object {} return karo.`

      const extractedJson = await geminiJson(
        memoryPrompt,
        FAST,
        {
          systemInstruction: 'Tum ek aisa AI ho jo sirf valid JSON return karta hai. Koi markdown ya text nahi.',
        },
        10_000
      )

      if (!extractedJson || typeof extractedJson !== 'object') {
        return false
      }

      const hasFacts = Object.keys(extractedJson).some(
        (cat) => extractedJson[cat] && Object.keys(extractedJson[cat]).length > 0
      )

      if (hasFacts) {
        console.log(`[Brain] ✅ Saving facts to memory:`, extractedJson)
        
        // 1. Local memory update karein
        updateMemory(extractedJson)

        // 2. ✅ Firestore mein bhi save karein taake Mobile App parh sake
        try {
          const userId = auth.currentUser?.uid
          if (userId) {
            const fullMemory = loadMemory()
            await setDoc(doc(db, 'brains', userId), {
              memory: fullMemory,
              updatedAt: Date.now()
            }, { merge: true })
            console.log('[Brain] ✅ Synced to Firestore')
          }
        } catch (syncErr) {
          console.error('[Brain] Firestore sync failed:', syncErr)
        }

        return true
      }

      return false
    } catch (e) {
      console.error('[Brain] ❌ Memory extraction failed:', e)
      return false
    }
  }
}

export const chatSession = new ChatSession()
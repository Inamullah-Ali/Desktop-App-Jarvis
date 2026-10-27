import { useState, useEffect, useRef } from 'react'
import './ChatPanel.css'
import { QRCodeSVG } from 'qrcode.react'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '../../electron/core/firebase'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  citations?: { title: string; uri: string }[]
}

interface DownloadProgress {
  id: string
  state: 'downloading' | 'complete' | 'cancelled' | 'error'
  received: number
  total?: number
  percent?: number
  cancellable?: boolean
  error?: string
  path?: string
  totalMB?: string
  receivedMB?: string
  speedMB?: string | null
  type?: 'video' | 'audio' | 'file'
  timestamp?: number
}

// ══════════════════════════════════════════════════════════════════════════
// ✅ HELPERS
// ══════════════════════════════════════════════════════════════════════════
function isImageUrl(url: string): boolean {
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$|#)/i.test(url)) return true
  if (url.includes('encrypted-tbn') || url.includes('gstatic.com/images')) return true
  if (url.includes('pexels.com') || url.includes('unsplash.com') || url.includes('pixabay.com')) return true
  return false
}

function isGoogleRedirect(url: string): boolean {
  return url.includes('google.com/goto') || url.includes('google.com/url')
}

function renderContent(content: string) {
  const urlRegex = /(https?:\/\/[^\s\)\]]+)/g
  const parts: (string | { url: string; text?: string })[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g

  if (markdownLinkRegex.test(content)) {
    let mdMatch: RegExpExecArray | null
    const mdRegex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g
    let mdLastIndex = 0
    while ((mdMatch = mdRegex.exec(content)) !== null) {
      if (mdMatch.index > mdLastIndex) {
        parts.push(content.slice(mdLastIndex, mdMatch.index))
      }
      parts.push({ url: mdMatch[2], text: mdMatch[1] })
      mdLastIndex = mdMatch.index + mdMatch[0].length
    }
    if (mdLastIndex < content.length) {
      parts.push(content.slice(mdLastIndex))
    }
  } else {
    while ((match = urlRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index))
      }
      parts.push({ url: match[1] })
      lastIndex = match.index + match[1].length
    }
    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex))
    }
  }

  return parts.map((part, i) => {
    if (typeof part === 'string') {
      const boldParts = part.split(/(\*\*[^*]+\*\*)/g)
      return (
        <span key={i}>
          {boldParts.map((bp, bi) => {
            if (bp.startsWith('**') && bp.endsWith('**')) {
              return <strong key={bi}>{bp.slice(2, -2)}</strong>
            }
            return <span key={bi}>{bp}</span>
          })}
        </span>
      )
    }

    const url = part.url
    const displayText = part.text || url

    if (isImageUrl(url) && !isGoogleRedirect(url)) {
      return (
        <div key={i} className="chat-image-preview">
          <a href={url} target="_blank" rel="noopener noreferrer" className="chat-image-link">
            <img
              src={url}
              alt="Preview"
              referrerPolicy="no-referrer" 
              className="chat-image"
              onError={(e) => {
                const img = e.target as HTMLImageElement
                img.style.display = 'none'
                const parent = img.parentElement
                if (parent && !parent.querySelector('.img-error')) {
                  const err = document.createElement('div')
                  err.className = 'img-error'
                  err.style.cssText = 'color:#888;font-size:12px;padding:8px'
                  err.textContent = '⚠️ Preview load nahi hui — click karke dekhein'
                  parent.appendChild(err)
                }
              }}
            />
          </a>
          <div className="chat-image-actions">
            <a href={url} target="_blank" rel="noopener noreferrer" className="chat-image-open">
              🔗 Open
            </a>
          </div>
        </div>
      )
    }

    return (
      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="chat-link">
        {displayText}
      </a>
    )
  })
}

// ══════════════════════════════════════════════════════════════════════════
// ✅ MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════
export default function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [assistantName, setAssistantName] = useState('JARVIS')
  const [userName, setUserName] = useState('')
  const [lastTools, setLastTools] = useState<string[]>([])
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  
  const [downloadHistory, setDownloadHistory] = useState<DownloadProgress[]>([])
  const [activeDownloads, setActiveDownloads] = useState<DownloadProgress[]>([])
  
  // ✅ History Modal State
  const [showHistory, setShowHistory] = useState(false)

  // ✅ Pairing (QR Code) State
  const [showQR, setShowQR] = useState(false)
  const [pairingCode, setPairingCode] = useState('')

  const bottomRef = useRef<HTMLDivElement>(null)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const pendingDisplayAcknowledgment = useRef<{ id: string; message: ChatMessage } | null>(null)
  const lastAcknowledgment = useRef<ChatMessage | null>(null)

  useEffect(() => {
    window.jarvis.getAssistantName().then(setAssistantName)
    window.jarvis.getUserName().then(setUserName)
    window.jarvis.chatHistory().then(setMessages)
    window.jarvis.getTtsInTextChat().then(setTtsEnabled)

    // ✅ Load History on start
    window.jarvis.getDownloadHistory?.().then((history: any) => {
      if (history && history.length > 0) setDownloadHistory(history)
    })
  }, [])

  // ✅ Download Progress Listener
  useEffect(() => {
    const subscribeToDownloadProgress = window.jarvis.onDownloadProgress
    if (typeof subscribeToDownloadProgress !== 'function') return

    return subscribeToDownloadProgress((progress) => {
      if (progress.state === 'downloading') {
        setActiveDownloads((current) => {
          const exists = current.find((item) => item.id === progress.id)
          if (exists) return current.map((item) => item.id === progress.id ? progress : item)
          return [...current, progress]
        })
      } else {
        setActiveDownloads((current) => current.filter((item) => item.id !== progress.id))
        
        setDownloadHistory((current) => {
          const exists = current.some((item) => item.id === progress.id)
          let newHistory = []
          if (!exists) {
            newHistory = [progress, ...current].slice(0, 100)
          } else {
            newHistory = current.map((item) => item.id === progress.id ? progress : item)
          }
          // ✅ Save to disk
          window.jarvis.saveDownloadHistory?.(newHistory)
          return newHistory
        })
      }
    })
  }, [])

  useEffect(() => {
    const loadVoices = () => { voicesRef.current = window.speechSynthesis.getVoices() }
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices
    return () => { window.speechSynthesis.onvoiceschanged = null }
  }, [])

  useEffect(() => {
    if (!window.jarvis.onReminderFired) return
    const unsub = window.jarvis.onReminderFired((data) => {
      const reminderMsg: ChatMessage = { role: 'assistant', content: `⏰ REMINDER: ${data.text}`, timestamp: Date.now() }
      setMessages((prev) => [...prev, reminderMsg])
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!window.jarvis.onSystemAlert) return
    const unsub = window.jarvis.onSystemAlert((data) => {
      const alertMsg: ChatMessage = { role: 'assistant', content: `⚠️ ${data.message}`, timestamp: Date.now() }
      setMessages((prev) => [...prev, alertMsg])
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    return window.jarvis.onChatAcknowledgment(({ id, text, requiresPlayback }) => {
      if (requiresPlayback) return
      const message: ChatMessage = { role: 'assistant', content: text, timestamp: Date.now() }
      pendingDisplayAcknowledgment.current = { id, message }
      lastAcknowledgment.current = message
      setMessages((previous) => [...previous, message])
    })
  }, [])

  useEffect(() => {
    const pending = pendingDisplayAcknowledgment.current
    if (!pending) return
    pendingDisplayAcknowledgment.current = null
    window.jarvis.chatAcknowledgmentPlayed(pending.id)
  }, [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, activeDownloads])

  const detectLanguage = (text: string): 'ur' | 'en' => {
    const urduRegex = /[\u0600-\u06FF]/
    if (urduRegex.test(text)) return 'ur'
    const romanUrduWords = ['kya', 'kaise', 'kaisa', 'kaisi', 'haal', 'hai', 'hain', 'mujhe', 'tum', 'aap', 'mera', 'meri', 'tera', 'teri', 'uska', 'uski', 'nahi', 'haan', 'ji', 'bhai', 'yaar', 'acha', 'theek', 'salam', 'khuda', 'hafiz', 'shukriya', 'kro', 'karo', 'batao', 'bata', 'raha', 'rahi', 'kar']
    const lower = text.toLowerCase()
    const words = lower.split(/\s+/)
    const matches = words.filter((w) => romanUrduWords.includes(w)).length
    if (matches >= 2) return 'ur'
    return 'en'
  }

  const speakText = (text: string) => {
    if (!text.trim()) return
    if (!window.speechSynthesis) return
    setSpeaking(true)
    window.speechSynthesis.cancel()
    const lang = detectLanguage(text)
    const voices = voicesRef.current.length > 0 ? voicesRef.current : window.speechSynthesis.getVoices()
    let voice: SpeechSynthesisVoice | null = null
    if (lang === 'ur') {
      voice = voices.find((v) => v.lang.startsWith('ur')) || voices.find((v) => v.lang.startsWith('hi')) || voices.find((v) => v.lang === 'en-IN') || null
    }
    if (!voice) {
      voice = voices.find((v) => v.lang === 'en-US' || v.lang === 'en-GB' || v.lang.startsWith('en')) || voices[0] || null
    }
    const utterance = new SpeechSynthesisUtterance(text)
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang } 
    else { utterance.lang = lang === 'ur' ? 'ur-PK' : 'en-US' }
    utterance.rate = 1.0; utterance.pitch = 1.0; utterance.volume = 1.0
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utterance)
  }

  const toggleTts = async () => {
    const newValue = !ttsEnabled
    setTtsEnabled(newValue)
    await window.jarvis.saveTtsInTextChat(newValue)
  }

  // ✅ Generate Pairing Code & QR
// ✅ Generate QR with User UID
const handleConnectPhone = async () => {
  const userUid = auth.currentUser?.uid
  if (!userUid) return

  setPairingCode(userUid) // ✅ UID as QR value
  setShowQR(true)
}

  const send = async () => {
    const msg = input.trim()
    if (!msg || loading) return
    setInput('')
    setLastTools([])
    pendingDisplayAcknowledgment.current = null
    lastAcknowledgment.current = null
    const userMsg: ChatMessage = { role: 'user', content: msg, timestamp: Date.now() }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const reply = await window.jarvis.chatSend(msg)
      const history = await window.jarvis.chatHistory()
      const acknowledgment = lastAcknowledgment.current
      const finalMessage = history[history.length - 1]
      setMessages(
        acknowledgment && finalMessage?.role === 'assistant'
          ? [...history.slice(0, -1), acknowledgment, finalMessage]
          : history,
      )
      if (reply.toolsUsed && reply.toolsUsed.length > 0) setLastTools(reply.toolsUsed)
      if (ttsEnabled && reply.text) speakText(reply.text)
    } catch (e: any) {
      const errMsg: ChatMessage = { role: 'assistant', content: `Error: ${e?.message || String(e)}`, timestamp: Date.now() }
      setMessages((prev) => [...prev, errMsg])
    }
    setLoading(false)
  }

  const clear = async () => {
    await window.jarvis.chatClear()
    setMessages([])
    setDownloadHistory([])
    window.jarvis.saveDownloadHistory?.([]) // ✅ Clear history from disk too
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <section className="chat-panel" aria-label="Chat">
      <header className="chat-header">
        <h2 className="chat-title">💬 Chat — {assistantName}</h2>
        <div className="chat-header-actions">
          
          {/* ✅ CONNECT PHONE BUTTON */}
          <button
            onClick={handleConnectPhone}
            className="chat-button"
            title="Connect Phone via QR"
            style={{ background: '#28a745', borderColor: '#1e7e34', color: '#fff' }}
          >
            📱 Connect Phone
          </button>

          {/* HISTORY BUTTON */}
          <button
            onClick={() => setShowHistory(true)}
            className="chat-button"
            title="Download History"
            style={{ background: '#202d3e', borderColor: '#35445a' }}
          >
            📋 History
          </button>
          
          <button
            onClick={toggleTts}
            className={`chat-button chat-voice-button${ttsEnabled ? ' is-active' : ''}`}
            title={ttsEnabled ? 'Voice ON' : 'Voice OFF'}
            aria-pressed={ttsEnabled}
          >
            {ttsEnabled ? '🔊 Voice ON' : '🔇 Voice OFF'}
          </button>
          <button onClick={clear} className="chat-button chat-clear-button" disabled={messages.length === 0 || loading}>
            Clear
          </button>
        </div>
      </header>

      <div className="chat-messages" role="log" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && (
          <div className="chat-empty-state">
            <span className="chat-empty-icon" aria-hidden="true">✦</span>
            <p>Chat shuru karein{userName ? `, ${userName}` : ''}.</p>
            <span>Assistant aapki baatein yaad rakhega. Voice ON karne par replies bol kar bhi sunai jayengi.</span>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`chat-message ${m.role === 'user' ? 'is-user' : 'is-assistant'}`}>
            <div className="chat-message-content">{renderContent(m.content)}</div>
            {m.citations && m.citations.length > 0 && (
              <div className="chat-citations">
                <strong>Sources:</strong>
                <ul>
                  {m.citations.map((c, ci) => (
                    <li key={ci}><a href={c.uri} target="_blank" rel="noreferrer">{c.title || c.uri}</a></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="chat-message is-assistant chat-typing" aria-label={`${assistantName} is typing`}>
            <span /><span /><span />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ✅ DOWNLOADS UI: Sirf Active Downloads */}
      {activeDownloads.length > 0 && (
        <div className="chat-downloads" aria-live="polite">
          {activeDownloads.map((download) => (
            <div key={download.id} className="chat-download">
              <span className="chat-download-label">
                📥 Downloading: {download.percent ?? 0}% 
                <span style={{ fontSize: '11px', color: '#91a0b4', marginLeft: '8px' }}>
                  ({download.receivedMB || '0'} MB / {download.totalMB || '?'} MB)
                  {download.speedMB && ` | ⚡ ${download.speedMB} MB/s`}
                </span>
              </span>
              {download.percent !== undefined && <progress max={100} value={download.percent} />}
            </div>
          ))}
        </div>
      )}

      <form className="chat-composer" onSubmit={(e) => { e.preventDefault(); void send() }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message likhein… (Enter bhejein, Shift+Enter se new line)"
          className="chat-input"
          rows={1}
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()} className="chat-send-button">
          Send
        </button>
      </form>

      {lastTools.length > 0 && <div className="chat-meta">🔧 Tools: {lastTools.join(', ')}</div>}
      {speaking && <div className="chat-meta is-speaking" aria-live="polite">🔊 Speaking…</div>}

      {/* ✅ HISTORY DIALOG (MODAL) */}
      {showHistory && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: '#151e2b', border: '1px solid #26364b', borderRadius: 12,
            width: '90%', maxWidth: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 18px 48px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #26364b' }}>
              <h3 style={{ margin: 0, color: '#8bbcff' }}>📋 Download History</h3>
              <button
                onClick={() => setShowHistory(false)}
                style={{ background: 'transparent', border: 'none', color: '#f44336', fontSize: 20, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            
            <div style={{ padding: 20, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {downloadHistory.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#888', marginTop: 20 }}>Koi download history nahi hai.</div>
              ) : (
                downloadHistory.map((download) => {
                  let icon = '📄'
                  if (download.type === 'video') icon = '🎥'
                  else if (download.type === 'audio') icon = '🎵'
                  else if (download.path?.match(/\.(jpg|jpeg|png|webp|gif)/i)) icon = '🖼️'
                  else if (download.path?.endsWith('.pdf')) icon = '📕'

                  let dateStr = ''
                  if (download.timestamp) {
                    const d = new Date(download.timestamp)
                    dateStr = d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  }

                  return (
                    <div key={download.id} style={{ background: '#1a2533', padding: '10px 12px', borderRadius: 6, borderLeft: '3px solid #4caf50' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#4caf50', fontWeight: 'bold', fontSize: 14 }}>
                          {icon} {download.path || 'File'}
                        </span>
                        <span style={{ fontSize: 11, color: '#888' }}>{dateStr}</span>
                      </div>
                      {download.state === 'error' && (
                        <div style={{ color: '#f44336', fontSize: 12, marginTop: 4 }}>❌ Failed: {download.error}</div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ✅ QR CODE MODAL */}
      {showQR && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{ background: '#1e1e1e', padding: 30, borderRadius: 12, textAlign: 'center', border: '1px solid #333' }}>
            <h3 style={{ color: '#4a90d9', marginBottom: 10 }}>📱 Connect Phone</h3>
            <p style={{ color: '#aaa', fontSize: 13, marginBottom: 20 }}>Scan this QR code or enter the 6-digit code in the app.</p>
            
            <div style={{ background: '#fff', padding: 15, borderRadius: 8, display: 'inline-block' }}>
              <QRCodeSVG value={pairingCode} size={200} />
            </div>
            
            <p style={{ color: '#fff', marginTop: 20, fontSize: 28, fontWeight: 'bold', letterSpacing: 8 }}>
              {pairingCode}
            </p>
            
            <button 
              onClick={() => setShowQR(false)}
              style={{ marginTop: 20, padding: '10px 24px', background: '#c62828', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
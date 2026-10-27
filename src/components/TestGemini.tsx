import { useState, useEffect } from 'react'

export default function TestGemini() {
  const [apiKey, setApiKey] = useState('')
  const [configured, setConfigured] = useState(false)
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [assistantName, setAssistantName] = useState('JARVIS')
  const [userName, setUserName] = useState('')
  const [voice, setVoice] = useState('')
  const [voices, setVoices] = useState<string[]>([])

  // ✅ Naya: Command prefix
  const [commandPrefix, setCommandPrefix] = useState('Jarvis')

  // ── Load current config on mount ─────────────────────────────────────────
  useEffect(() => {
    window.jarvis.isConfigured().then(setConfigured)
    window.jarvis.getAssistantName().then(setAssistantName)
    window.jarvis.getUserName().then(setUserName)
    window.jarvis.getVoice().then(setVoice)
    window.jarvis.getVoices().then(setVoices)
    window.jarvis.getKey().then((k) => {
      if (k) setApiKey(k)
    })
    // ✅ Load command prefix
    window.jarvis.getCommandPrefix().then((p) => {
      if (p) setCommandPrefix(p)
    })
  }, [])

  // ── Save API key ─────────────────────────────────────────────────────────
  const saveKey = async () => {
    if (!apiKey.trim()) {
      setError('API key khali hai')
      return
    }
    await window.jarvis.saveKey(apiKey.trim())
    const ok = await window.jarvis.isConfigured()
    setConfigured(ok)
    setError('')
    if (ok) {
      setReply('✅ API key save ho gayi')
    }
  }

  // ── Test Gemini ──────────────────────────────────────────────────────────
  const testGemini = async () => {
    setLoading(true)
    setError('')
    setReply('')
    try {
      const res = await window.jarvis.geminiTest()
      if (res.ok) {
        setReply(res.reply || '(khali jawab)')
      } else {
        setError(res.error || 'Unknown error')
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    }
    setLoading(false)
  }

  // ── Save assistant config ────────────────────────────────────────────────
  const saveAssistantInfo = async () => {
    await window.jarvis.saveAssistant(assistantName, userName)
    setReply('✅ Assistant info save ho gayi')
  }

  // ── Save voice ───────────────────────────────────────────────────────────
  const saveVoiceChoice = async (v: string) => {
    setVoice(v)
    await window.jarvis.saveVoice(v)
    setReply(`✅ Voice "${v}" save ho gayi`)
  }

  // ✅ Save command prefix
  const saveCommandPrefix = async () => {
    const p = commandPrefix.trim()
    if (!p) {
      setError('Command prefix khali nahi ho sakta')
      return
    }
    await window.jarvis.saveCommandPrefix(p)
    setError('')
    setReply(`✅ Command prefix save: "${p}" — ab command "${p}, Chrome kholo" jaisi deni hongi`)
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  const box: React.CSSProperties = {
    padding: 20,
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 700,
    margin: '0 auto',
    color: '#e0e0e0',
  }
  const section: React.CSSProperties = {
    marginBottom: 24,
    padding: 16,
    background: '#1e1e1e',
    borderRadius: 8,
    border: '1px solid #333',
  }
  const input: React.CSSProperties = {
    width: '100%',
    padding: 10,
    fontSize: 14,
    background: '#2a2a2a',
    color: '#fff',
    border: '1px solid #444',
    borderRadius: 4,
    boxSizing: 'border-box',
  }
  const btn: React.CSSProperties = {
    marginTop: 10,
    padding: '10px 20px',
    fontSize: 14,
    background: '#4a90d9',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
  }
  const btnDisabled: React.CSSProperties = {
    ...btn,
    background: '#444',
    cursor: 'not-allowed',
  }
  const label: React.CSSProperties = {
    display: 'block',
    marginBottom: 4,
    fontSize: 13,
    color: '#aaa',
  }

  return (
    <div style={box}>
      <h1 style={{ color: '#4a90d9' }}>Phase 1 — {assistantName}</h1>
      <p style={{ color: '#888' }}>Mark-LV ka Gemini + LLM test</p>

      {/* ── 1. API Key ──────────────────────────────────────────────────── */}
      <div style={section}>
        <h3>1. Gemini API Key</h3>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Apni Gemini API key paste karein"
          style={input}
        />
        <button onClick={saveKey} style={btn}>
          Save Key
        </button>
        <p style={{ color: configured ? '#4caf50' : '#f44336', marginTop: 8 }}>
          {configured ? '✅ Configured' : '❌ Not configured'}
        </p>
      </div>

      {/* ── 2. Test Gemini ──────────────────────────────────────────────── */}
      <div style={section}>
        <h3>2. Gemini Test</h3>
        <button
          onClick={testGemini}
          disabled={loading || !configured}
          style={loading || !configured ? btnDisabled : btn}
        >
          {loading ? 'Testing…' : 'Test Gemini'}
        </button>
      </div>

      {/* ── 3. Assistant Info ───────────────────────────────────────────── */}
      <div style={section}>
        <h3>3. Assistant Info</h3>
        <label style={label}>Assistant Name</label>
        <input
          value={assistantName}
          onChange={(e) => setAssistantName(e.target.value)}
          style={input}
        />
        <label style={{ ...label, marginTop: 10 }}>
          Aapka Naam (User Name)
        </label>
        <input
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          style={input}
        />
        <button onClick={saveAssistantInfo} style={btn}>
          Save
        </button>
      </div>

      {/* ✅ 4. Command Prefix ──────────────────────────────────────────── */}
      <div style={section}>
        <h3>4. Custom Command Prefix</h3>
        <p style={{ fontSize: 13, color: '#888', marginTop: 0 }}>
          Ye word command se pehle bolna hoga. Default: <strong>"Jarvis"</strong>
          <br />
          Misaal: <em>"{commandPrefix || 'Jarvis'}, Chrome kholo"</em>
        </p>
        <input
          value={commandPrefix}
          onChange={(e) => setCommandPrefix(e.target.value)}
          placeholder="Jarvis"
          style={input}
        />
        <button onClick={saveCommandPrefix} style={btn}>
          Save Command Prefix
        </button>
        <div style={{
          marginTop: 8,
          padding: 8,
          background: '#1b2a3a',
          borderLeft: '3px solid #4a90d9',
          fontSize: 12,
          color: '#aaa',
        }}>
          <strong>Note:</strong> Wake word "Hey Jarvis" hamesha rahega (model-specific).
          Lekin command prefix aap badal sakte hain — jaise <strong>"Ali"</strong>.
        </div>
      </div>

      {/* ── 5. Voice ────────────────────────────────────────────────────── */}
      <div style={section}>
        <h3>5. Voice</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {voices.map((v) => (
            <button
              key={v}
              onClick={() => saveVoiceChoice(v)}
              style={{
                ...btn,
                marginTop: 0,
                background: v === voice ? '#4caf50' : '#333',
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* ── Result ──────────────────────────────────────────────────────── */}
      {reply && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: '#1b3a1b',
            border: '1px solid #4caf50',
            borderRadius: 4,
          }}
        >
          <strong>Jawab:</strong> {reply}
        </div>
      )}
      {error && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: '#3a1b1b',
            border: '1px solid #f44336',
            borderRadius: 4,
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  )
}
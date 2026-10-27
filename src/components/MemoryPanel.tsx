import { useState, useEffect } from 'react'

interface MemoryEntry {
  category: string
  key: string
  value: string
  updated: string
}

// ── User Profile Fields ────────────────────────────────────────────────────
const PROFILE_FIELDS = [
  { key: 'name', label: '👤 Aapka Naam', placeholder: 'Ali', category: 'identity' },
  { key: 'city', label: '🏙️ Shehar', placeholder: 'Pakpattan', category: 'identity' },
  { key: 'age', label: '🎂 Umar', placeholder: '25', category: 'identity' },
  { key: 'birthday', label: '📅 Birthday', placeholder: '2000-01-15', category: 'identity' },
  { key: 'job', label: '💼 Kaam', placeholder: 'Software Engineer', category: 'identity' },
  { key: 'school', label: '🎓 School/University', placeholder: 'Punjab University', category: 'identity' },
  { key: 'language', label: '🗣️ Aapki Zubaan', placeholder: 'Urdu', category: 'identity' },
  { key: 'nationality', label: '🌍 Nationality', placeholder: 'Pakistani', category: 'identity' },
]

// ── Other Quick Add ────────────────────────────────────────────────────────
const QUICK_ADD = [
  { label: '👨‍👩‍👧 Sister', category: 'relationships', key: 'sister' },
  { label: '👨‍👩‍👦 Brother', category: 'relationships', key: 'brother' },
  { label: '👫 Partner', category: 'relationships', key: 'partner' },
  { label: '🍕 Favorite Food', category: 'preferences', key: 'favorite_food' },
  { label: '🎨 Favorite Color', category: 'preferences', key: 'favorite_color' },
  { label: '🎵 Favorite Music', category: 'preferences', key: 'favorite_music' },
  { label: '🎮 Favorite Game', category: 'preferences', key: 'favorite_game' },
  { label: '🏗️ Current Project', category: 'projects', key: 'current_project' },
  { label: '🎯 Goal', category: 'wishes', key: 'goal' },
]

export default function MemoryPanel() {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [profileData, setProfileData] = useState<Record<string, string>>({})
  const [manualKey, setManualKey] = useState('')
  const [manualValue, setManualValue] = useState('')
  const [manualCategory, setManualCategory] = useState('notes')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResult, setSearchResult] = useState('')
  const [message, setMessage] = useState('')

  // ── Modal state ────────────────────────────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false)
  const [modalPreset, setModalPreset] = useState<typeof QUICK_ADD[0] | null>(null)
  const [modalValue, setModalValue] = useState('')

  const categories = ['identity', 'preferences', 'projects', 'relationships', 'wishes', 'notes']

  // ── Load entries + prefill profile ─────────────────────────────────────
  const refresh = async () => {
    const all = await window.jarvis.memoryAllEntries()
    setEntries(all)

    const profile: Record<string, string> = {}
    for (const entry of all) {
      if (entry.category === 'identity') {
        profile[entry.key] = entry.value
      }
    }
    setProfileData(profile)
  }

  useEffect(() => { refresh() }, [])

  // ── Save entire profile at once ────────────────────────────────────────
  const saveProfile = async () => {
    const filled = Object.entries(profileData).filter(
      ([_k, v]) => v && v.trim()
    )
    if (filled.length === 0) {
      setMessage('❌ Kam az kam ek field bharein')
      return
    }

    let saved = 0
    for (const [key, value] of filled) {
      try {
        const field = PROFILE_FIELDS.find((f) => f.key === key)
        const category = field?.category || 'identity'
        await window.jarvis.memoryRemember(key, value.trim(), category)
        saved++
      } catch (e) {
        console.error(`Failed to save ${key}:`, e)
      }
    }

    setMessage(`✅ ${saved} facts save ho gaye`)
    refresh()
  }

  const clearProfile = () => {
    setProfileData({})
    setMessage('🔄 Form khali kar diya')
  }

  // ── Quick Add: open modal ──────────────────────────────────────────────
  const openQuickAdd = (preset: typeof QUICK_ADD[0]) => {
    setModalPreset(preset)
    setModalValue('')
    setModalOpen(true)
  }

  // ── Quick Add: save from modal ─────────────────────────────────────────
  const saveQuickAdd = async () => {
    if (!modalPreset) return
    if (!modalValue.trim()) {
      setMessage('❌ Value likhein')
      return
    }

    try {
      const result = await window.jarvis.memoryRemember(
        modalPreset.key, modalValue.trim(), modalPreset.category
      )
      setMessage(`✅ ${result}`)
      setModalOpen(false)
      setModalPreset(null)
      setModalValue('')
      refresh()
    } catch (e: any) {
      setMessage(`❌ Error: ${e?.message || String(e)}`)
    }
  }

  const cancelModal = () => {
    setModalOpen(false)
    setModalPreset(null)
    setModalValue('')
  }

  // ── Manual add ─────────────────────────────────────────────────────────
  const addManual = async () => {
    if (!manualKey.trim() || !manualValue.trim()) {
      setMessage('❌ Key aur value dono zaroori hain')
      return
    }
    const result = await window.jarvis.memoryRemember(
      manualKey.trim(), manualValue.trim(), manualCategory
    )
    setMessage(`✅ ${result}`)
    setManualKey('')
    setManualValue('')
    refresh()
  }

  // ── Delete ─────────────────────────────────────────────────────────────
  const deleteEntry = async (key: string, category: string) => {
    const result = await window.jarvis.memoryForget(key, category)
    setMessage(`🗑️ ${result}`)
    refresh()
  }

  const search = async () => {
    const result = await window.jarvis.memorySearch(searchQuery)
    setSearchResult(result)
  }

  const grouped = entries.reduce((acc, e) => {
    if (!acc[e.category]) acc[e.category] = []
    acc[e.category].push(e)
    return acc
  }, {} as Record<string, MemoryEntry[]>)

  // ── Styles ─────────────────────────────────────────────────────────────
  const box: React.CSSProperties = {
    padding: 20, fontFamily: 'system-ui', maxWidth: 900, margin: '0 auto',
    color: '#e0e0e0',
  }
  const section: React.CSSProperties = {
    marginBottom: 24, padding: 16, background: '#1e1e1e',
    borderRadius: 8, border: '1px solid #333',
  }
  const grid: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
  }
  const label: React.CSSProperties = {
    display: 'block', fontSize: 13, color: '#aaa', marginBottom: 4,
  }
  const input: React.CSSProperties = {
    width: '100%', padding: 10, fontSize: 14, background: '#2a2a2a',
    color: '#fff', border: '1px solid #444', borderRadius: 4,
    boxSizing: 'border-box',
  }
  const btn: React.CSSProperties = {
    padding: '10px 20px', fontSize: 14, background: '#4a90d9',
    color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
    marginRight: 8,
  }
  const btnGreen: React.CSSProperties = { ...btn, background: '#4caf50' }
  const btnGray: React.CSSProperties = { ...btn, background: '#555' }
  const quickBtn: React.CSSProperties = {
    padding: '8px 12px', fontSize: 13, background: '#2a2a2a',
    color: '#e0e0e0', border: '1px solid #444', borderRadius: 4,
    cursor: 'pointer', marginRight: 8, marginBottom: 8,
  }

  // ── Modal overlay ──────────────────────────────────────────────────────
  const overlay: React.CSSProperties = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.7)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  }
  const modal: React.CSSProperties = {
    background: '#1e1e1e', padding: 24, borderRadius: 8,
    border: '1px solid #444', minWidth: 400, maxWidth: 500,
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
  }

  return (
    <div style={box}>
      <h1 style={{ color: '#4a90d9' }}>🧠 Memory Panel</h1>
      <p style={{ color: '#888' }}>JARVIS ne aap ke baare mein kya yaad rakha hai</p>

      {/* ═══ User Profile Form ═══ */}
      <div style={section}>
        <h3>👤 Aapki Jaankari (Profile)</h3>
        <p style={{ color: '#888', fontSize: 13, marginTop: 0 }}>
          Ek baar form bharein, assistant hamesha yaad rakhega
        </p>

        <div style={grid}>
          {PROFILE_FIELDS.map((field) => (
            <div key={field.key}>
              <label style={label}>{field.label}</label>
              <input
                placeholder={field.placeholder}
                value={profileData[field.key] || ''}
                onChange={(e) =>
                  setProfileData({ ...profileData, [field.key]: e.target.value })
                }
                style={input}
              />
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          <button onClick={saveProfile} style={btnGreen}>
            💾 Save Profile
          </button>
          <button onClick={clearProfile} style={btnGray}>
            🔄 Clear Form
          </button>
        </div>
      </div>

      {/* ═══ Quick Add ═══ */}
      <div style={section}>
        <h3>⚡ Quick Add (Aur Facts)</h3>
        <p style={{ color: '#888', fontSize: 13, marginTop: 0 }}>
          Relations, preferences, projects — ek click mein
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {QUICK_ADD.map((preset) => (
            <button
              key={preset.label}
              onClick={() => openQuickAdd(preset)}
              style={quickBtn}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#2a2a2a')}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ Manual Add ═══ */}
      <div style={section}>
        <h3>➕ Naya Fact Add Karein (Manual)</h3>
        <select
          value={manualCategory}
          onChange={(e) => setManualCategory(e.target.value)}
          style={{ ...input, marginBottom: 8 }}
        >
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          placeholder="Key (jaise: sister_name)"
          value={manualKey}
          onChange={(e) => setManualKey(e.target.value)}
          style={{ ...input, marginBottom: 8 }}
        />
        <input
          placeholder="Value (jaise: Ayşe)"
          value={manualValue}
          onChange={(e) => setManualValue(e.target.value)}
          style={{ ...input, marginBottom: 8 }}
        />
        <button onClick={addManual} style={btn}>Add</button>
      </div>

      {/* ═══ Search ═══ */}
      <div style={section}>
        <h3>🔍 Search</h3>
        <input
          placeholder="Keyword likhein..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ ...input, marginBottom: 8 }}
        />
        <button onClick={search} style={btn}>Search</button>
        {searchResult && (
          <pre style={{
            marginTop: 12, padding: 12, background: '#111',
            borderRadius: 4, whiteSpace: 'pre-wrap', fontSize: 13,
          }}>{searchResult}</pre>
        )}
      </div>

      {/* ═══ All Entries ═══ */}
      <div style={section}>
        <h3>📋 Saare Facts ({entries.length})</h3>
        {entries.length === 0 ? (
          <p style={{ color: '#888' }}>Abhi kuch bhi store nahi hua.</p>
        ) : (
          Object.entries(grouped).map(([cat, items]) => (
            <div key={cat} style={{ marginBottom: 16 }}>
              <h4 style={{
                color: '#4a90d9', marginBottom: 8, fontSize: 14,
                borderBottom: '1px solid #333', paddingBottom: 4,
              }}>
                {cat} ({items.length})
              </h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                    <th style={{ textAlign: 'left', padding: 6, color: '#888' }}>Key</th>
                    <th style={{ textAlign: 'left', padding: 6, color: '#888' }}>Value</th>
                    <th style={{ textAlign: 'left', padding: 6, color: '#888' }}>Updated</th>
                    <th style={{ padding: 6 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #2a2a2a' }}>
                      <td style={{ padding: 6 }}>{e.key}</td>
                      <td style={{ padding: 6, fontWeight: 'bold' }}>{e.value}</td>
                      <td style={{ padding: 6, color: '#888', fontSize: 11 }}>{e.updated}</td>
                      <td style={{ padding: 6 }}>
                        <button
                          onClick={() => deleteEntry(e.key, e.category)}
                          style={{
                            background: '#c62828', color: '#fff', border: 'none',
                            borderRadius: 3, padding: '4px 8px', cursor: 'pointer',
                            fontSize: 11,
                          }}
                        >✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </div>

      {/* ═══ Message ═══ */}
      {message && (
        <div style={{
          padding: 12, background: '#1b3a1b', border: '1px solid #4caf50',
          borderRadius: 4, marginTop: 12, position: 'sticky', bottom: 20,
        }}>{message}</div>
      )}

      {/* ═══ Custom Modal for Quick Add ═══ */}
      {modalOpen && modalPreset && (
        <div style={overlay} onClick={cancelModal}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, color: '#4a90d9' }}>
              {modalPreset.label}
            </h3>
            <p style={{ color: '#888', fontSize: 13 }}>
              Value likhein:
            </p>
            <input
              type="text"
              value={modalValue}
              onChange={(e) => setModalValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveQuickAdd()
                if (e.key === 'Escape') cancelModal()
              }}
              placeholder="Jaise: Ayşe"
              autoFocus
              style={{
                ...input, fontSize: 16, padding: 12, marginBottom: 16,
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={cancelModal} style={btnGray}>
                Cancel
              </button>
              <button onClick={saveQuickAdd} style={btnGreen}>
                💾 Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
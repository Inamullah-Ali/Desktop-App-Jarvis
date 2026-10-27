import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

// ── Paths ──────────────────────────────────────────────────────────────────
// ✅ BRAIN FOLDER: AppData/Roaming/jarvis/Brain mein save hoga
function getBrainDir(): string {
  return path.join(app.getPath('userData'), 'Brain')
}

const BRAIN_DIR = getBrainDir()
const MEMORY_PATH = path.join(BRAIN_DIR, 'long_term.json')

// ✅ First time folder create karein
if (!fs.existsSync(BRAIN_DIR)) {
  fs.mkdirSync(BRAIN_DIR, { recursive: true })
  console.log(`[Brain] ✅ Memory folder created at: ${BRAIN_DIR}`)
}

// ── Constants ──────────────────────────────────────────────────────────────
const MAX_VALUE_LENGTH = 380
const MEMORY_MAX_CHARS = 200_000
const PROMPT_CORE_CHARS = 900
const PROMPT_INDEX_CHARS = 420
const PROMPT_MAX_PER_CATEGORY = 6

const CATEGORIES = [
  'identity',
  'preferences',
  'projects',
  'relationships',
  'wishes',
  'notes',
] as const
type Category = typeof CATEGORIES[number]

const CATEGORY_LABELS: Record<string, string> = {
  preferences: 'Preferences',
  projects: 'Active projects / goals',
  relationships: 'People in their life',
  wishes: 'Wishes / plans',
  notes: 'Notes',
}

const IDENTITY_FIELDS = [
  'name', 'age', 'birthday', 'city', 'job',
  'language', 'school', 'nationality',
]

const _SESSION_MAX = 3

// ── Types ──────────────────────────────────────────────────────────────────
export interface MemoryEntry {
  value: string
  updated: string
}

export interface SessionEntry {
  date: string
  summary: string
  language?: string
}

export interface MemoryStore {
  identity: Record<string, MemoryEntry>
  preferences: Record<string, MemoryEntry>
  projects: Record<string, MemoryEntry>
  relationships: Record<string, MemoryEntry>
  wishes: Record<string, MemoryEntry>
  notes: Record<string, MemoryEntry>
  sessions?: SessionEntry[]
}

// ── Empty Memory ───────────────────────────────────────────────────────────
function emptyMemory(): MemoryStore {
  return {
    identity: {},
    preferences: {},
    projects: {},
    relationships: {},
    wishes: {},
    notes: {},
    sessions: [],
  }
}

// ── Load / Save ────────────────────────────────────────────────────────────
export function loadMemory(): MemoryStore {
  if (!fs.existsSync(MEMORY_PATH)) {
    return emptyMemory()
  }
  try {
    const raw = fs.readFileSync(MEMORY_PATH, 'utf-8')
    const data = JSON.parse(raw)
    if (typeof data === 'object' && data !== null) {
      const base = emptyMemory()
      for (const key of Object.keys(base)) {
        if (!(key in data)) {
          (data as any)[key] = (base as any)[key]
        }
      }
      return data as MemoryStore
    }
    return emptyMemory()
  } catch (e) {
    console.log(`[Memory] ⚠️ Load error: ${e}`)
    return emptyMemory()
  }
}

function saveMemory(memory: MemoryStore): void {
  if (!memory || typeof memory !== 'object') return
  const trimmed = trimToLimit(memory)
  if (!fs.existsSync(BRAIN_DIR)) {
    fs.mkdirSync(BRAIN_DIR, { recursive: true })
  }
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(trimmed, null, 2), 'utf-8')
}

// ── Trim Guard ─────────────────────────────────────────────────────────────
function allEntries(memory: MemoryStore): Array<[string, string, MemoryEntry]> {
  const entries: Array<[string, string, MemoryEntry]> = []
  for (const cat of Object.keys(memory)) {
    if (cat === 'sessions') continue
    const items = (memory as any)[cat]
    if (!items || typeof items !== 'object') continue
    for (const key of Object.keys(items)) {
      const entry = items[key]
      if (entry && typeof entry === 'object' && 'value' in entry) {
        entries.push([cat, key, entry])
      }
    }
  }
  return entries
}

function trimToLimit(memory: MemoryStore): MemoryStore {
  if (JSON.stringify(memory).length <= MEMORY_MAX_CHARS) return memory

  const entries = allEntries(memory)
  entries.sort((a, b) => (a[2].updated || '0000-00-00').localeCompare(b[2].updated || '0000-00-00'))

  const dropped: string[] = []
  for (const [cat, key] of entries) {
    if (JSON.stringify(memory).length <= MEMORY_MAX_CHARS) break
    delete (memory as any)[cat][key]
    dropped.push(`${cat}/${key}`)
    console.log(`[Memory] 🗑️  Trimmed ${cat}/${key}`)
  }
  if (dropped.length > 0) {
    console.log(`[Memory] Trimmed ${dropped.length} oldest entries`)
  }
  return memory
}

// ── Update (Recursive) ─────────────────────────────────────────────────────
function truncateValue(val: any): string {
  const s = String(val ?? '')
  if (s.length > MAX_VALUE_LENGTH) {
    return s.slice(0, MAX_VALUE_LENGTH).trimEnd() + '…'
  }
  return s
}

function recursiveUpdate(target: any, updates: any): boolean {
  let changed = false
  for (const key of Object.keys(updates)) {
    const value = updates[key]
    if (value === null || value === undefined) continue
    if (typeof value === 'string' && !value.trim()) continue

    if (typeof value === 'object' && !('value' in value)) {
      if (!(key in target) || typeof target[key] !== 'object') {
        target[key] = {}
        changed = true
      }
      if (recursiveUpdate(target[key], value)) changed = true
    } else {
      const newVal = truncateValue(
        typeof value === 'object' && 'value' in value ? value.value : value
      )
      const entry: MemoryEntry = {
        value: newVal,
        updated: new Date().toISOString().slice(0, 10),
      }
      const existing = target[key]
      if (!existing || typeof existing !== 'object' || existing.value !== newVal) {
        target[key] = entry
        changed = true
      }
    }
  }
  return changed
}

export function updateMemory(memoryUpdate: Record<string, any>): MemoryStore {
  if (!memoryUpdate || Object.keys(memoryUpdate).length === 0) {
    return loadMemory()
  }
  const memory = loadMemory()
  if (recursiveUpdate(memory, memoryUpdate)) {
    saveMemory(memory)
    console.log(`[Memory] 💾 Saved: ${Object.keys(memoryUpdate).join(', ')}`)
  }
  return memory
}

// ── Entry Value Helper ─────────────────────────────────────────────────────
function entryValue(entry: any): string {
  if (entry && typeof entry === 'object') {
    return String(entry.value ?? '').trim()
  }
  return String(entry ?? '').trim()
}

function prettyKey(key: string): string {
  return key.replace(/_/g, ' ').trim()
}

// ── Prompt Formatting ──────────────────────────────────────────────────────
export function formatMemoryForPrompt(memory: MemoryStore | null): string {
  if (!memory) return ''

  const coreLines: string[] = []

  // 1. Identity — always, in full
  const identity = memory.identity || {}
  for (const field of IDENTITY_FIELDS) {
    const val = entryValue(identity[field])
    if (!val) continue
    if (field === 'language') {
      coreLines.push(
        `Has spoken to you in: ${val} (an observation about the past — ` +
        `always answer in the language of their CURRENT message)`
      )
    } else {
      coreLines.push(`${field.charAt(0).toUpperCase() + field.slice(1)}: ${val}`)
    }
  }
  for (const key of Object.keys(identity)) {
    if (IDENTITY_FIELDS.includes(key)) continue
    const val = entryValue(identity[key])
    if (val) coreLines.push(`${prettyKey(key)}: ${val}`)
  }

  // 2. Everything else — most recently updated first
  const rest: Array<[string, string, string, string]> = []
  for (const cat of Object.keys(CATEGORY_LABELS)) {
    const items = (memory as any)[cat] || {}
    for (const key of Object.keys(items)) {
      const val = entryValue(items[key])
      if (!val) continue
      const updated = items[key]?.updated || '0000-00-00'
      rest.push([updated, cat, key, val])
    }
  }
  rest.sort((a, b) => b[0].localeCompare(a[0]))

  let used = coreLines.reduce((sum, l) => sum + l.length + 1, 0)
  const shown: Record<string, string[]> = {}
  const overflow: Record<string, string[]> = {}
  const perCatUsed: Record<string, number> = {}

  for (const [_updated, cat, key, val] of rest) {
    const line = `  - ${prettyKey(key)}: ${val}`
    if (
      (perCatUsed[cat] || 0) < PROMPT_MAX_PER_CATEGORY &&
      used + line.length + 1 <= PROMPT_CORE_CHARS
    ) {
      if (!shown[cat]) shown[cat] = []
      shown[cat].push(line)
      perCatUsed[cat] = (perCatUsed[cat] || 0) + 1
      used += line.length + 1
    } else {
      if (!overflow[cat]) overflow[cat] = []
      overflow[cat].push(prettyKey(key))
    }
  }

  // 3. Index of overflow — interleaved across categories
  const indexed: string[] = []
  const overflowCats = Object.keys(CATEGORY_LABELS).filter((c) => overflow[c]?.length)
  if (overflowCats.length > 0) {
    const cursor: Record<string, number> = {}
    for (const c of overflowCats) cursor[c] = 0
    let active = [...overflowCats]
    while (active.length > 0) {
      const next: string[] = []
      for (const cat of active) {
        const i = cursor[cat]
        if (i >= overflow[cat].length) continue
        indexed.push(overflow[cat][i])
        cursor[cat] = i + 1
        next.push(cat)
      }
      active = next
    }
  }

  for (const [cat, label] of Object.entries(CATEGORY_LABELS)) {
    if (shown[cat]?.length) {
      coreLines.push('')
      coreLines.push(`${label}:`)
      coreLines.push(...shown[cat])
    }
  }

  if (coreLines.length === 0 && indexed.length === 0) return ''

  const out: string[] = [
    '[WHAT YOU KNOW ABOUT THIS PERSON — use naturally, never recite like a list]',
    ...coreLines,
  ]

  if (indexed.length > 0) {
    let budget = PROMPT_INDEX_CHARS
    const names: string[] = []
    for (const n of indexed) {
      if (budget - n.length - 2 < 0) break
      names.push(n)
      budget -= n.length + 2
    }
    if (names.length > 0) {
      out.push('')
      out.push(
        '[ALSO REMEMBERED — values not shown here. Call recall_memory ' +
        'with a keyword to read any of these before saying you do not know]'
      )
      out.push(
        names.join(', ') +
        (indexed.length > names.length
          ? ` (+${indexed.length - names.length} more)`
          : '')
      )
    }
  }

  return out.join('\n') + '\n'
}

// ── Recall / Search ────────────────────────────────────────────────────────
function score(queryWords: string[], cat: string, key: string, value: string): number {
  const hayKey = prettyKey(key).toLowerCase()
  const hayVal = value.toLowerCase()
  let s = 0
  for (const w of queryWords) {
    if (!w) continue
    if (w === hayKey) s += 10
    else if (hayKey.includes(w)) s += 6
    if (hayVal.includes(w)) s += 3
    if (cat.includes(w)) s += 1
  }
  return s
}

export function searchMemory(query: string, limit: number = 8): string {
  const memory = loadMemory()
  const words = (query || '')
    .toLowerCase()
    .split(/[^\w]+/)
    .filter((w) => w.length > 1)

  const rows: Array<[number, string, string, string]> = []
  for (const cat of Object.keys(memory)) {
    if (cat === 'sessions') continue
    const items = (memory as any)[cat]
    if (!items || typeof items !== 'object') continue
    for (const key of Object.keys(items)) {
      const val = entryValue(items[key])
      if (!val) continue
      const s = words.length > 0 ? score(words, cat, key, val) : 1
      if (s > 0) rows.push([s, cat, key, val])
    }
  }

  if (rows.length === 0) {
    return query
      ? `Nothing stored about '${query}'.`
      : 'I have not stored anything about this person yet.'
  }

  rows.sort((a, b) => b[0] - a[0] || a[2].localeCompare(b[2]))
  const limited = rows.slice(0, Math.max(1, limit))
  const lines = limited.map(([_s, cat, key, val]) => `${cat}/${prettyKey(key)}: ${val}`)
  const head = query
    ? `Stored facts matching '${query}':`
    : 'Everything currently stored:'
  const more = rows.length > lines.length
    ? `\n(+${rows.length - lines.length} more — search with a narrower keyword)`
    : ''
  return head + '\n' + lines.join('\n') + more
}

// ── UI Helpers ─────────────────────────────────────────────────────────────
export interface UIEntry {
  category: string
  key: string
  value: string
  updated: string
}

export function allEntriesForUI(): UIEntry[] {
  const memory = loadMemory()
  const rows: UIEntry[] = []
  for (const cat of Object.keys(memory)) {
    if (cat === 'sessions') continue
    const items = (memory as any)[cat]
    if (!items || typeof items !== 'object') continue
    for (const key of Object.keys(items)) {
      const val = entryValue(items[key])
      if (!val) continue
      rows.push({
        category: cat,
        key,
        value: val,
        updated: items[key]?.updated || '',
      })
    }
  }
  rows.sort((a, b) => (b.updated || '0000-00-00').localeCompare(a.updated || '0000-00-00'))
  return rows
}

// ── Public Helpers ─────────────────────────────────────────────────────────
export function remember(
  key: string,
  value: string,
  category: string = 'notes',
): string {
  const valid = new Set(CATEGORIES)
  const cat = valid.has(category as Category) ? category : 'notes'
  updateMemory({ [cat]: { [key]: { value } } })
  return `Remembered: ${cat}/${key} = ${value}`
}

export function forget(key: string, category: string = 'notes'): string {
  const memory = loadMemory()
  const cat = (memory as any)[category] || {}
  if (key in cat) {
    delete cat[key]
    ;(memory as any)[category] = cat
    saveMemory(memory)
    return `Forgotten: ${category}/${key}`
  }
  return `Not found: ${category}/${key}`
}

// ── Session Memory ─────────────────────────────────────────────────────────
export function saveSessionSummary(summary: string, language: string = ''): void {
  const s = (summary || '').trim()
  if (!s) return

  const memory = loadMemory()
  let sessions = memory.sessions
  if (!Array.isArray(sessions)) sessions = []

  const entry: SessionEntry = {
    date: new Date().toISOString().slice(0, 10),
    summary: s.slice(0, 280),
  }
  if (language) entry.language = language

  sessions.push(entry)
  memory.sessions = sessions.slice(-_SESSION_MAX)

  if (!fs.existsSync(BRAIN_DIR)) fs.mkdirSync(BRAIN_DIR, { recursive: true })
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2), 'utf-8')
  console.log(`[Memory] 📝 Session saved (${entry.date}): ${s.slice(0, 60)}…`)
}

export function popLastSession(): SessionEntry | null {
  if (!fs.existsSync(MEMORY_PATH)) return null
  try {
    const raw = fs.readFileSync(MEMORY_PATH, 'utf-8')
    const memory = JSON.parse(raw)
    const sessions = memory.sessions
    if (!Array.isArray(sessions) || sessions.length === 0) return null
    const entry = sessions.pop()
    memory.sessions = sessions
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2), 'utf-8')
    return entry
  } catch (e) {
    console.log(`[Memory] ⚠️ popLastSession error: ${e}`)
    return null
  }
}

// ✅ Memory Backup (Export/Import)
export function exportMemoryBackup(): string {
  const memory = loadMemory()
  return JSON.stringify(memory, null, 2)
}

export function importMemoryBackup(jsonStr: string): boolean {
  try {
    const memory = JSON.parse(jsonStr)
    if (!fs.existsSync(BRAIN_DIR)) fs.mkdirSync(BRAIN_DIR, { recursive: true })
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2), 'utf-8')
    return true
  } catch (e) {
    return false
  }
}
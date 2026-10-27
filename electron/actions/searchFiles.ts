import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ── Safe roots: sirf user home ─────────────────────────────────────────────
const HOME = os.homedir()

// ── Skip folders (system, node_modules, etc.) ──────────────────────────────
const SKIP_FOLDERS = new Set([
  'AppData',
  'node_modules',
  '.git',
  '.cache',
  '.npm',
  '.vscode',
  'Windows',
  'ProgramData',
  '$Recycle.Bin',
  'System Volume Information',
  '__pycache__',
  '.next',
  'dist',
  'build',
  'dist-electron',
])

// ── Media type extension maps ──────────────────────────────────────────────
const MEDIA_EXTENSIONS: Record<string, Set<string>> = {
  video: new Set(['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp']),
  image: new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.heic', '.tiff', '.raw']),
  audio: new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.opus']),
  document: new Set(['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.odt', '.ods', '.odp']),
}

// ── Format size ────────────────────────────────────────────────────────────
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let b = bytes
  for (const u of units) {
    if (b < 1024) return `${b.toFixed(1)} ${u}`
    b /= 1024
  }
  return `${b.toFixed(1)} TB`
}

// ── Check if extension matches media type ──────────────────────────────────
function matchesMediaType(ext: string, mediaType: string): boolean {
  if (!mediaType || mediaType === 'any') return true
  const exts = MEDIA_EXTENSIONS[mediaType.toLowerCase()]
  if (!exts) return true
  return exts.has(ext.toLowerCase())
}

// ── Search result ──────────────────────────────────────────────────────────
interface SearchResult {
  path: string
  name: string
  size: number
  mtime: Date
  isDir: boolean
}

// ── Recursive search (iterative, safe) ─────────────────────────────────────
function searchRecursive(
  root: string,
  query: string,
  mediaType: string,
  minSizeMB: number,
  daysAgo: number,
  maxResults: number,
  maxDepth: number = 5,
): SearchResult[] {
  const results: SearchResult[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  const minSizeBytes = minSizeMB > 0 ? minSizeMB * 1024 * 1024 : 0
  const cutoffTime = daysAgo > 0 ? Date.now() - daysAgo * 24 * 60 * 60 * 1000 : 0
  const queryLower = query.toLowerCase().trim()

  let scannedDirs = 0
  const startTime = Date.now()
  const MAX_TIME_MS = 30_000   // 30 second timeout

  while (queue.length > 0 && results.length < maxResults) {
    // Timeout check
    if (Date.now() - startTime > MAX_TIME_MS) {
      console.log(`[searchFiles] Timeout after 30s, ${results.length} results`)
      break
    }

    const { dir, depth } = queue.shift()!
    if (depth > maxDepth) continue

    scannedDirs++

    let entries: string[]
    try {
      entries = fs.readdirSync(dir)
    } catch {
      continue   // Skip inaccessible dirs
    }

    for (const entry of entries) {
      if (results.length >= maxResults) break
      if (entry.startsWith('.')) continue   // Skip hidden
      if (SKIP_FOLDERS.has(entry)) continue

      const fullPath = path.join(dir, entry)
      let stat: fs.Stats
      try {
        stat = fs.statSync(fullPath)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        if (depth < maxDepth) {
          queue.push({ dir: fullPath, depth: depth + 1 })
        }
        continue
      }

      // ── File filters ─────────────────────────────────────────────────
      const ext = path.extname(entry)

      // Media type filter
      if (!matchesMediaType(ext, mediaType)) continue

      // Name query filter (if provided)
      if (queryLower && !entry.toLowerCase().includes(queryLower)) continue

      // Size filter
      if (minSizeBytes > 0 && stat.size < minSizeBytes) continue

      // Date filter
      if (cutoffTime > 0 && stat.mtimeMs < cutoffTime) continue

      results.push({
        path: fullPath,
        name: entry,
        size: stat.size,
        mtime: stat.mtime,
        isDir: false,
      })
    }
  }

  console.log(`[searchFiles] Scanned ${scannedDirs} dirs, found ${results.length} results`)
  return results
}

// ══════════════════════════════════════════════════════════════════════════
// TOOL DECLARATION
// ══════════════════════════════════════════════════════════════════════════
export const SEARCH_FILES_TOOL = {
  name: 'search_files',
  description:
    "Searches the user's entire home folder for files by name, media type, " +
    'size, or date. Use this whenever the user asks to find a file, media, ' +
    'video, photo, song, or document WITHOUT specifying the folder. ' +
    'Returns full file paths so the user can locate them. ' +
    'Examples: "find birthday videos", "search for report.pdf", ' +
    '"find large files", "recent photos".',
  parameters: {
    type: 'OBJECT',
    properties: {
      query: {
        type: 'STRING',
        description:
          'Filename or part of filename to search for (e.g. "birthday", ' +
          '"report", "IMG_2023"). Leave empty to search by type/size/date only.',
      },
      media_type: {
        type: 'STRING',
        description:
          "'video' | 'image' | 'audio' | 'document' | 'any'. " +
          'Use this when the user mentions a specific type of file.',
      },
      min_size_mb: {
        type: 'NUMBER',
        description: 'Minimum file size in MB. Use for "large files" queries.',
      },
      days_ago: {
        type: 'NUMBER',
        description: 'Files modified within the last N days. Use for "recent" queries.',
      },
      max_results: {
        type: 'NUMBER',
        description: 'Maximum number of results (default: 20, max: 100)',
      },
    },
    required: [],
  },
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER
// ══════════════════════════════════════════════════════════════════════════
export async function searchFiles(args: Record<string, any>): Promise<string> {
  const query = String(args?.query || '').trim()
  const mediaType = String(args?.media_type || 'any').toLowerCase().trim()
  const minSizeMB = Number(args?.min_size_mb || 0)
  const daysAgo = Number(args?.days_ago || 0)
  const maxResults = Math.min(100, Math.max(1, Number(args?.max_results || 20)))

  console.log(
    `[searchFiles] Query="${query}" type=${mediaType} ` +
    `minSize=${minSizeMB}MB daysAgo=${daysAgo} max=${maxResults}`,
  )

  const startTime = Date.now()

  const results = searchRecursive(
    HOME,
    query,
    mediaType,
    minSizeMB,
    daysAgo,
    maxResults,
    5,   // maxDepth
  )

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  if (results.length === 0) {
    const desc = [
      query && `"${query}"`,
      mediaType !== 'any' && mediaType,
      minSizeMB > 0 && `> ${minSizeMB}MB`,
      daysAgo > 0 && `last ${daysAgo} days`,
    ].filter(Boolean).join(', ')

    return `No files found matching: ${desc || 'criteria'}. (searched in ${elapsed}s)`
  }

  // Sort by modification time (newest first)
  results.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

  let out = `Found ${results.length} file(s) in ${elapsed}s:\n\n`
  results.forEach((r, i) => {
    const date = r.mtime.toISOString().slice(0, 10)
    out += `${i + 1}. 📄 ${r.name}\n`
    out += `   📏 ${formatSize(r.size)}  |  📅 ${date}\n`
    out += `   📁 ${r.path}\n\n`
  })

  return out
}
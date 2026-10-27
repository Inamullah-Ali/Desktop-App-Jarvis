import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { shell } from 'electron'
import { pushUndo } from '../core/undo'

const HOME = os.homedir()
const SAFE_ROOTS = [HOME]

function isSafePath(target: string): boolean {
  try {
    const resolved = path.resolve(target)
    return SAFE_ROOTS.some(
      (root) => resolved === root || resolved.startsWith(root + path.sep),
    )
  } catch {
    return false
  }
}

function getShortcuts(): Record<string, string> {
  return {
    desktop: path.join(HOME, 'Desktop'),
    downloads: path.join(HOME, 'Downloads'),
    documents: path.join(HOME, 'Documents'),
    pictures: path.join(HOME, 'Pictures'),
    music: path.join(HOME, 'Music'),
    videos: path.join(HOME, 'Videos'),
    home: HOME,
  }
}

function resolvePath(raw: string): string {
  const shortcuts = getShortcuts()
  const cleaned = (raw || '').trim().replace(/^["']|["']$/g, '')
  const lower = cleaned.toLowerCase()
  if (shortcuts[lower]) return shortcuts[lower]
  const parts = cleaned.replace(/\\/g, '/').split('/')
  const head = parts[0].toLowerCase()
  if (shortcuts[head]) {
    const rest = parts.slice(1).join(path.sep)
    return rest ? path.join(shortcuts[head], rest) : shortcuts[head]
  }
  return path.resolve(cleaned)
}

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let b = bytes
  for (const u of units) {
    if (b < 1024) return `${b.toFixed(1)} ${u}`
    b /= 1024
  }
  return `${b.toFixed(1)} TB`
}

function isProtectedDir(target: string): boolean {
  const shortcuts = getShortcuts()
  const resolved = path.resolve(target)
  return Object.values(shortcuts).some((p) => path.resolve(p) === resolved)
}

// ══════════════════════════════════════════════════════════════════════════
// ✅ OPEN FILE — Alag tool (fileController se alag)
// ══════════════════════════════════════════════════════════════════════════
export const OPEN_FILE_TOOL = {
  name: 'open_file',
  description:
    'Opens a file on the user\'s computer using the default application. ' +
    'Use this when the user says "open karo", "dikhao", "show me" for a ' +
    'downloaded file or any file. Provide the full file path (e.g. ' +
    '"C:\\Users\\Inam\\Downloads\\cat.jpg").',
  parameters: {
    type: 'OBJECT',
    properties: {
      path: {
        type: 'STRING',
        description: 'Full path to the file to open.',
      },
    },
    required: ['path'],
  },
}

export async function openFile(args: Record<string, any>): Promise<string> {
  const filePath = String(args?.path || '').trim()
  if (!filePath) return 'File path nahi diya.'

  const cleaned = filePath.replace(/^["']|["']$/g, '')
  let resolved = path.isAbsolute(cleaned) ? cleaned : resolvePath(cleaned)

  if (!fs.existsSync(resolved)) {
    // Downloads mein dhundho
    const downloadsDir = path.join(HOME, 'Downloads')
    const filename = path.basename(cleaned)
    const possiblePath = path.join(downloadsDir, filename)
    if (fs.existsSync(possiblePath)) {
      resolved = possiblePath
    } else {
      try {
        const files = fs.readdirSync(downloadsDir)
        const match = files.find((f) => f.toLowerCase().includes(filename.toLowerCase()))
        if (match) resolved = path.join(downloadsDir, match)
        else return `File nahi mili: ${cleaned}`
      } catch {
        return `File nahi mili: ${cleaned}`
      }
    }
  }

  try {
    const error = await shell.openPath(resolved)
    if (error) return `File open nahi ho saki: ${error}`
    console.log(`[openFile] ✅ Opened: ${resolved}`)
    return `✅ File open kar di: ${path.basename(resolved)}`
  } catch (e: any) {
    return `File open failed: ${e?.message || String(e)}`
  }
}

// ══════════════════════════════════════════════════════════════════════════
// FILE CONTROLLER TOOL
// ══════════════════════════════════════════════════════════════════════════
export const FILE_CONTROLLER_TOOL = {
  name: 'file_controller',
  description:
    'Manages files and folders on this computer. Use this when the user asks ' +
    'to list, read, write, create, delete, move, copy, rename, or find files. ' +
    'For OPENING files, use the open_file tool instead. ' +
    'Shortcuts available: desktop, downloads, documents, pictures, music, ' +
    'videos, home.',
  parameters: {
    type: 'OBJECT',
    properties: {
      action: {
        type: 'STRING',
        description:
          'list | read | write | create_file | create_folder | delete | ' +
          'move | copy | rename | find | info | disk_usage',
      },
      path: { type: 'STRING', description: "Path or shortcut: 'desktop', 'downloads', 'documents', 'home'" },
      name: { type: 'STRING', description: 'File or folder name' },
      destination: { type: 'STRING', description: 'Destination path for move/copy' },
      new_name: { type: 'STRING', description: 'New name for rename' },
      content: { type: 'STRING', description: 'Content for write/create_file' },
      extension: { type: 'STRING', description: 'File extension for find (e.g. .pdf)' },
      count: { type: 'NUMBER', description: 'Number of results' },
    },
    required: ['action'],
  },
}

export async function fileController(
  args: Record<string, any>,
): Promise<string> {
  const action = String(args?.action || '').toLowerCase().trim()
  const rawPath = String(args?.path || 'desktop')
  const name = String(args?.name || '')
  const destination = String(args?.destination || '')
  const newName = String(args?.new_name || '')
  const content = String(args?.content || '')
  const extension = String(args?.extension || '')
  const count = Math.min(50, Number(args?.count || 10))

  try {
    switch (action) {
      case 'list': return listFiles(rawPath)
      case 'read': return readFile(rawPath, name)
      case 'write': return writeFile(rawPath, name, content)
      case 'create_file': return createFile(rawPath, name, content)
      case 'create_folder': return createFolder(rawPath, name)
      case 'delete': return await deleteFile(rawPath, name)
      case 'move': return moveFile(rawPath, name, destination)
      case 'copy': return copyFile(rawPath, name, destination)
      case 'rename': return renameFile(rawPath, name, newName)
      case 'find': return findFiles(rawPath, name, extension, count)
      case 'info': return getFileInfo(rawPath, name)
      case 'disk_usage': return getDiskUsage(rawPath)
      default: return `Unknown action: '${action}'`
    }
  } catch (e: any) {
    return `File controller error (${action}): ${e?.message || String(e)}`
  }
}

// ══════════════════════════════════════════════════════════════════════════
// INTERNAL ACTIONS
// ══════════════════════════════════════════════════════════════════════════

function listFiles(rawPath: string): string {
  const target = resolvePath(rawPath)
  if (!isSafePath(target)) return `Access denied: ${target}`
  if (!fs.existsSync(target)) return `Path not found: ${target}`
  if (!fs.statSync(target).isDirectory()) return `Not a directory: ${target}`
  const items: string[] = []
  for (const entry of fs.readdirSync(target).sort()) {
    if (entry.startsWith('.')) continue
    const full = path.join(target, entry)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) items.push(`📁 ${entry}/`)
    else items.push(`📄 ${entry} (${formatSize(stat.size)})`)
  }
  if (items.length === 0) return `Directory is empty: ${path.basename(target)}/`
  return `Contents of ${path.basename(target)}/ (${items.length} items):\n` + items.join('\n')
}

function readFile(rawPath: string, name: string): string {
  const base = resolvePath(rawPath)
  const target = name ? path.join(base, name) : base
  if (!isSafePath(target)) return `Access denied: ${target}`
  if (!fs.existsSync(target)) return `File not found: ${target}`
  if (fs.statSync(target).isDirectory()) return `Not a file: ${target}`
  try {
    let content = fs.readFileSync(target, 'utf-8')
    const MAX = 4000
    if (content.length > MAX) content = content.slice(0, MAX) + `\n\n[Truncated — ${content.length} total chars]`
    return content
  } catch (e: any) { return `Could not read file: ${e?.message || String(e)}` }
}

function writeFile(rawPath: string, name: string, content: string): string {
  const base = resolvePath(rawPath)
  const target = name ? path.join(base, name) : base
  if (!isSafePath(target)) return `Access denied: ${target}`
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content, 'utf-8')
    return `Written to: ${path.basename(target)}`
  } catch (e: any) { return `Could not write file: ${e?.message || String(e)}` }
}

function createFile(rawPath: string, name: string, content: string): string {
  const base = resolvePath(rawPath)
  const target = name ? path.join(base, name) : base
  if (!isSafePath(target)) return `Access denied: ${target}`
  try {
    const existed = fs.existsSync(target)
    const previous = existed ? fs.readFileSync(target, 'utf-8') : null
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content, 'utf-8')
    if (existed && previous !== null) {
      pushUndo(`create_file "${path.basename(target)}"`, () => {
        fs.writeFileSync(target, previous, 'utf-8')
        return `Restored previous contents of "${path.basename(target)}".`
      })
    } else {
      pushUndo(`create_file "${path.basename(target)}"`, () => {
        if (fs.existsSync(target)) { fs.unlinkSync(target); return `Removed "${path.basename(target)}".` }
        return `Already gone.`
      })
    }
    return `File created: ${path.basename(target)}`
  } catch (e: any) { return `Could not create file: ${e?.message || String(e)}` }
}

function createFolder(rawPath: string, name: string): string {
  const base = resolvePath(rawPath)
  const target = name ? path.join(base, name) : base
  if (!isSafePath(target)) return `Access denied: ${target}`
  try {
    const already = fs.existsSync(target)
    fs.mkdirSync(target, { recursive: true })
    if (!already) {
      pushUndo(`create_folder "${path.basename(target)}"`, () => {
        if (!fs.existsSync(target)) return `Already gone.`
        const contents = fs.readdirSync(target)
        if (contents.length > 0) return `Not empty.`
        fs.rmdirSync(target)
        return `Removed folder.`
      })
    }
    return `Folder created: ${path.basename(target)}`
  } catch (e: any) { return `Could not create folder: ${e?.message || String(e)}` }
}

async function deleteFile(rawPath: string, name: string): Promise<string> {
  const base = resolvePath(rawPath)
  const target = name ? path.join(base, name) : base
  if (!isSafePath(target)) return `Access denied: ${target}`
  if (!fs.existsSync(target)) return `Not found: ${path.basename(target)}`
  if (isProtectedDir(target)) return `Protected directory.`
  try {
    await shell.trashItem(target)
    pushUndo(`delete "${path.basename(target)}"`, () => `Restore manually from Recycle Bin.`)
    return `Moved to Trash: ${path.basename(target)}`
  } catch (e: any) { return `Could not delete: ${e?.message || String(e)}` }
}

function moveFile(rawPath: string, name: string, destination: string): string {
  const base = resolvePath(rawPath)
  const src = name ? path.join(base, name) : base
  if (!fs.existsSync(src)) return `Source not found.`
  if (!destination) return 'No destination.'
  if (!isSafePath(src)) return `Access denied (source).`
  let dst = resolvePath(destination)
  if (!isSafePath(dst)) return `Access denied (destination).`
  if (fs.existsSync(dst) && fs.statSync(dst).isDirectory()) dst = path.join(dst, path.basename(src))
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    const originalSrc = src
    const finalDst = dst
    fs.renameSync(src, dst)
    pushUndo(`move "${path.basename(src)}"`, () => {
      if (!fs.existsSync(finalDst)) return `No longer there.`
      fs.mkdirSync(path.dirname(originalSrc), { recursive: true })
      fs.renameSync(finalDst, originalSrc)
      return `Moved back.`
    })
    return `Moved: ${path.basename(src)} → ${path.dirname(dst)}`
  } catch (e: any) { return `Could not move: ${e?.message || String(e)}` }
}

function copyFile(rawPath: string, name: string, destination: string): string {
  const base = resolvePath(rawPath)
  const src = name ? path.join(base, name) : base
  if (!fs.existsSync(src)) return `Source not found.`
  if (!destination) return 'No destination.'
  if (!isSafePath(src)) return `Access denied (source).`
  let dst = resolvePath(destination)
  if (!isSafePath(dst)) return `Access denied (destination).`
  if (fs.existsSync(dst) && fs.statSync(dst).isDirectory()) dst = path.join(dst, path.basename(src))
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.cpSync(src, dst, { recursive: true })
    const copyTarget = dst
    pushUndo(`copy "${path.basename(src)}"`, () => {
      if (!fs.existsSync(copyTarget)) return `Already gone.`
      if (fs.statSync(copyTarget).isDirectory()) fs.rmSync(copyTarget, { recursive: true })
      else fs.unlinkSync(copyTarget)
      return `Removed copy.`
    })
    return `Copied: ${path.basename(src)} → ${path.dirname(dst)}`
  } catch (e: any) { return `Could not copy: ${e?.message || String(e)}` }
}

function renameFile(rawPath: string, name: string, newName: string): string {
  const base = resolvePath(rawPath)
  const target = name ? path.join(base, name) : base
  if (!isSafePath(target)) return `Access denied.`
  if (!fs.existsSync(target)) return `Not found.`
  if (!newName) return 'No new name.'
  const newPath = path.join(path.dirname(target), newName)
  if (fs.existsSync(newPath)) return `A file named '${newName}' already exists.`
  try {
    const oldPath = target
    const newFullPath = newPath
    const oldName = path.basename(target)
    fs.renameSync(target, newPath)
    pushUndo(`rename "${oldName}" → "${newName}"`, () => {
      if (!fs.existsSync(newFullPath)) return `No longer there.`
      fs.renameSync(newFullPath, oldPath)
      return `Renamed back.`
    })
    return `Renamed: ${oldName} → ${newName}`
  } catch (e: any) { return `Could not rename: ${e?.message || String(e)}` }
}

function findFiles(rawPath: string, name: string, extension: string, maxResults: number): string {
  const searchPath = resolvePath(rawPath)
  if (!isSafePath(searchPath)) return `Access denied.`
  if (!fs.existsSync(searchPath)) return `Search path not found.`
  const results: string[] = []
  const queue: string[] = [searchPath]
  let dirCount = 0
  while (queue.length > 0 && results.length < maxResults) {
    const dir = queue.shift()!
    dirCount++
    if (dirCount > 500) break
    try {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry)
        const stat = fs.statSync(full)
        if (stat.isDirectory()) { queue.push(full); continue }
        if (extension && path.extname(entry).toLowerCase() !== extension.toLowerCase()) continue
        if (name && !entry.toLowerCase().includes(name.toLowerCase())) continue
        results.push(`📄 ${entry} (${formatSize(stat.size)}) — ${dir}`)
        if (results.length >= maxResults) break
      }
    } catch {}
  }
  if (results.length === 0) return `No files found.`
  return `Found ${results.length} file(s):\n${results.join('\n')}`
}

function getFileInfo(rawPath: string, name: string): string {
  const base = resolvePath(rawPath)
  const target = name ? path.join(base, name) : base
  if (!isSafePath(target)) return `Access denied.`
  if (!fs.existsSync(target)) return `Not found.`
  const stat = fs.statSync(target)
  const info = {
    Name: path.basename(target),
    Type: stat.isDirectory() ? 'Folder' : 'File',
    Size: formatSize(stat.size),
    Location: path.dirname(target),
    Created: stat.birthtime.toISOString(),
    Modified: stat.mtime.toISOString(),
    Extension: path.extname(target) || '—',
  }
  return Object.entries(info).map(([k, v]) => `  ${k}: ${v}`).join('\n')
}

function getDiskUsage(rawPath: string): string {
  const target = resolvePath(rawPath)
  if (!isSafePath(target)) return `Access denied.`
  try {
    const stat = (fs as any).statfsSync?.(target)
    if (!stat) return 'Disk usage not supported.'
    const total = stat.bsize * stat.blocks
    const free = stat.bsize * stat.bavail
    const used = total - free
    const pct = ((used / total) * 100).toFixed(1)
    return `Disk usage:\n  Total : ${formatSize(total)}\n  Used  : ${formatSize(used)} (${pct}%)\n  Free  : ${formatSize(free)}`
  } catch (e: any) { return `Could not get disk usage: ${e?.message || String(e)}` }
}
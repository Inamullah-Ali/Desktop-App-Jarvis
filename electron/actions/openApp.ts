import { spawn, exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { shell } from 'electron'
import os from 'node:os'

const execAsync = promisify(exec)

// ── URL Prefix ─────────────────────────────────────────────────────────────
const URL_PREFIX = '__URL__'

// ── UWP Cache (runtime detection) ──────────────────────────────────────────
// Pehli baar detect hone ke baad, yaad rakhein
const uwpCache: Map<string, string> = new Map()

// ── UWP Apps — package name patterns ───────────────────────────────────────
// Ye "fuzzy" patterns hain — actual PackageFamilyName runtime par dhundha jayega
const UWP_PATTERNS: Record<string, string[]> = {
  whatsapp: ['WhatsApp', 'WhatsAppDesktop', 'WhatsAppBeta'],
  spotify: ['Spotify', 'SpotifyMusic', 'SpotifyAB'],
  netflix: ['Netflix'],
  instagram: ['Instagram'],
  telegram: ['Telegram', 'TelegramDesktop'],
  discord: ['Discord'],
  // Yahan aur UWP apps add kar sakte hain
}

// ── App Aliases (Windows) ──────────────────────────────────────────────────
const APP_ALIASES: Record<string, string> = {
  // Browsers
  chrome: 'chrome',
  'google chrome': 'chrome',
  firefox: 'firefox',
  edge: 'msedge',
  brave: 'brave',
  opera: 'opera',

  // Communication
  whatsapp: '__UWP__whatsapp',
  telegram: '__UWP__telegram',
  discord: 'Discord',
  slack: 'Slack',
  zoom: 'Zoom',
  teams: 'msteams',
  skype: 'skype',
  signal: 'signal',

  // Media
  spotify: '__UWP__spotify',
  vlc: 'vlc',

  // Development
  vscode: 'code',
  'visual studio code': 'code',
  code: 'code',
  terminal: 'wt',
  cmd: 'cmd.exe',
  powershell: 'powershell.exe',
  postman: 'Postman',
  figma: 'Figma',
  blender: 'blender',

  // Office
  word: 'winword',
  excel: 'excel',
  powerpoint: 'powerpnt',
  libreoffice: 'soffice',
  notepad: 'notepad.exe',

  // System
  explorer: 'explorer.exe',
  'task manager': 'taskmgr.exe',
  settings: 'ms-settings:',
  calculator: 'calc.exe',
  paint: 'mspaint.exe',

  // Notes / Productivity
  notion: 'Notion',
  obsidian: 'Obsidian',
  capcut: 'CapCut',

  // Gaming
  steam: 'steam',
  epic: 'EpicGamesLauncher',
  'epic games': 'EpicGamesLauncher',

  // Social
  instagram: '__UWP__instagram',
  tiktok: 'TikTok',

  // ✅ Websites
  youtube: `${URL_PREFIX}https://youtube.com`,
  'youtube.com': `${URL_PREFIX}https://youtube.com`,
  google: `${URL_PREFIX}https://google.com`,
  gmail: `${URL_PREFIX}https://mail.google.com`,
  facebook: `${URL_PREFIX}https://facebook.com`,
  'whatsapp web': `${URL_PREFIX}https://web.whatsapp.com`,
  whatsapp_web: `${URL_PREFIX}https://web.whatsapp.com`,
  chatgpt: `${URL_PREFIX}https://chat.openai.com`,
  github: `${URL_PREFIX}https://github.com`,
  netflix: `${URL_PREFIX}https://netflix.com`,
  amazon: `${URL_PREFIX}https://amazon.com`,
  daraz: `${URL_PREFIX}https://daraz.pk`,
  wikipedia: `${URL_PREFIX}https://wikipedia.org`,
  reddit: `${URL_PREFIX}https://reddit.com`,
  linkedin: `${URL_PREFIX}https://linkedin.com`,
  'dawn news': `${URL_PREFIX}https://dawn.com`,
  'geo news': `${URL_PREFIX}https://geo.tv`,
  'bbc news': `${URL_PREFIX}https://bbc.com/news`,
}

// ── Tool Declaration ───────────────────────────────────────────────────────
export const OPEN_APP_TOOL = {
  name: 'open_app',
  description:
    'Opens any application OR website on the computer. Use this whenever ' +
    'the user asks to open, launch, or start any app, website, or program. ' +
    'For websites (YouTube, Gmail, Facebook, etc.) the URL will open in ' +
    'the default browser. For WhatsApp: if the app is installed, it opens ' +
    'the app; otherwise it opens WhatsApp Web. Always call this tool — ' +
    'never just say you opened it.',
  parameters: {
    type: 'OBJECT',
    properties: {
      app_name: {
        type: 'STRING',
        description:
          "Exact name of the application or website " +
          "(e.g. 'WhatsApp', 'Chrome', 'YouTube', 'Gmail', 'Spotify')",
      },
    },
    required: ['app_name'],
  },
}

// ── Dynamic UWP Detection ──────────────────────────────────────────────────
// PowerShell se PackageFamilyName dhundhein (runtime par)
async function findUWPApp(appKey: string): Promise<string | null> {
  // ✅ Cache check
  if (uwpCache.has(appKey)) {
    const cached = uwpCache.get(appKey)!
    console.log(`[open_app] 🎯 UWP cache hit: ${appKey} → ${cached}`)
    return cached
  }

  const patterns = UWP_PATTERNS[appKey]
  if (!patterns || patterns.length === 0) return null

  console.log(`[open_app] 🔍 Detecting UWP app: ${appKey}`)

  // ✅ PowerShell script — CMD quoting se bachne ke liye
  // Ye script package dhundhti hai aur PackageFamilyName return karti hai
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$patterns = @('${patterns.join("','")}')
foreach ($pattern in $patterns) {
  $pkg = Get-AppxPackage | Where-Object { 
    $_.Name -like "*$pattern*" -or $_.PackageFullName -like "*$pattern*" 
  } | Select-Object -First 1
  if ($pkg) {
    Write-Output $pkg.PackageFamilyName
    exit 0
  }
}
exit 1
  `.trim()

  // ✅ Base64 encode (UTF-16LE) — CMD quoting se bachne ke liye
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64')

  try {
    const { stdout } = await execAsync(
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
      { timeout: 10000 },
    )

    const packageFamilyName = stdout.trim()
    if (packageFamilyName) {
      console.log(`[open_app] ✅ Found UWP: ${appKey} → ${packageFamilyName}`)
      uwpCache.set(appKey, packageFamilyName)
      return packageFamilyName
    }
  } catch (e: any) {
    // PowerShell exit 1 ka matlab — app nahi mila
    console.log(`[open_app] UWP detection failed for ${appKey}: ${e?.message || String(e)}`)
  }

  console.log(`[open_app] ❌ UWP app not found: ${appKey}`)
  return null
}

// ── Launch UWP App ─────────────────────────────────────────────────────────
async function launchUWP(appKey: string): Promise<boolean> {
  const packageFamilyName = await findUWPApp(appKey)
  if (!packageFamilyName) return false

  // ✅ Full App ID: <PackageFamilyName>!App
  const appId = `${packageFamilyName}!App`
  console.log(`[open_app] Launching UWP: shell:AppsFolder\\${appId}`)

  return new Promise((resolve) => {
    try {
      const child = spawn('explorer.exe', [`shell:AppsFolder\\${appId}`], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })

      child.on('error', (err) => {
        console.log(`[open_app] UWP spawn error: ${err.message}`)
        resolve(false)
      })

      child.on('spawn', () => {
        console.log(`[open_app] ✅ UWP launched: ${appId}`)
        child.unref()
        setTimeout(() => resolve(true), 2000)
      })
    } catch (e: any) {
      console.log(`[open_app] UWP exception: ${e?.message || String(e)}`)
      resolve(false)
    }
  })
}

// ── Check: Kya WhatsApp installed hai? ─────────────────────────────────────
async function isUWPInstalled(appKey: string): Promise<boolean> {
  const found = await findUWPApp(appKey)
  return found !== null
}

// ── Normalize App Name ─────────────────────────────────────────────────────
function normalizeAppName(raw: string): string {
  const key = raw.toLowerCase().trim()

  if (APP_ALIASES[key]) return APP_ALIASES[key]

  for (const [alias, target] of Object.entries(APP_ALIASES)) {
    if (alias.includes(key) || key.includes(alias)) {
      return target
    }
  }

  if (key.startsWith('http://') || key.startsWith('https://')) {
    return `${URL_PREFIX}${key}`
  }

  if (/^[\w-]+\.[\w-]+/.test(key) && !key.includes(' ')) {
    return `${URL_PREFIX}https://${key}`
  }

  return raw
}

// ── Launch URL ─────────────────────────────────────────────────────────────
async function launchURL(url: string): Promise<boolean> {
  console.log(`[open_app] Opening URL: ${url}`)

  try {
    await shell.openExternal(url)
    await new Promise((r) => setTimeout(r, 1500))
    console.log(`[open_app] ✅ shell.openExternal success`)
    return true
  } catch (e: any) {
    console.log(`[open_app] shell.openExternal failed: ${e?.message || String(e)}`)
  }

  try {
    await new Promise<void>((resolve, reject) => {
      exec(`start "" "${url}"`, { shell: 'cmd.exe' }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    return true
  } catch (e: any) {
    console.log(`[open_app] start command failed: ${e?.message || String(e)}`)
  }

  return false
}

// ── Launch Traditional App ─────────────────────────────────────────────────
function launchWindows(appName: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn('cmd', ['/c', 'start', '', appName], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })

      child.on('error', (err) => {
        console.log(`[open_app] spawn error: ${err.message}`)
        resolve(false)
      })

      child.on('spawn', () => {
        console.log(`[open_app] Launched: ${appName}`)
        setTimeout(() => resolve(true), 1500)
      })

      child.unref()
    } catch (e: any) {
      console.log(`[open_app] Exception: ${e?.message || String(e)}`)
      resolve(false)
    }
  })
}

// ── Main Handler ───────────────────────────────────────────────────────────
export async function openApp(
  args: Record<string, any>,
): Promise<string> {
  const appName = String(args?.app_name || '').trim()

  if (!appName) {
    return 'No application name provided.'
  }

  const platform = os.platform()
  if (platform !== 'win32') {
    return `open_app currently supports Windows only. Detected: ${platform}`
  }

  const normalized = normalizeAppName(appName)
  console.log(`[open_app] Launching: '${appName}' → '${normalized}'`)

  // ✅ UWP app check — pattern
  if (normalized.startsWith('__UWP__')) {
    const uwpKey = normalized.replace('__UWP__', '')
    console.log(`[open_app] UWP app requested: ${uwpKey}`)

    const installed = await isUWPInstalled(uwpKey)

    if (installed) {
      const ok = await launchUWP(uwpKey)
      if (ok) return `Opened ${appName} app.`
    }

    // ✅ Fallback: WhatsApp Web
    if (uwpKey === 'whatsapp') {
      console.log('[open_app] WhatsApp not installed — opening WhatsApp Web')
      const webOk = await launchURL('https://web.whatsapp.com')
      if (webOk) return `Opened WhatsApp Web in browser.`
    }

    return `Could not open ${appName}.`
  }

  // ✅ URL hai? Browser mein kholo
  if (normalized.startsWith(URL_PREFIX)) {
    const url = normalized.replace(URL_PREFIX, '')
    const ok = await launchURL(url)
    if (ok) return `Opened ${appName} in browser.`
    return `Could not open ${appName}.`
  }

  // ✅ Traditional app
  const ok = await launchWindows(normalized)

  if (ok) return `Opened ${appName}.`

  if (normalized.toLowerCase() !== appName.toLowerCase()) {
    const ok2 = await launchWindows(appName)
    if (ok2) return `Opened ${appName}.`
  }

  return (
    `Could not confirm that ${appName} launched. ` +
    `It may still be loading, or it might not be installed.`
  )
}
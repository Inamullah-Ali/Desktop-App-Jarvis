import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const execAsync = promisify(exec)

// ── Helper: nircmd.exe ka path dhundhein ───────────────────────────────────
function getNircmdPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'electron', 'actions', 'bin', 'nircmd.exe'),
    path.join(process.cwd(), 'dist-electron', 'bin', 'nircmd.exe'),
    path.join(process.cwd(), 'bin', 'nircmd.exe'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

// ── Helper: PowerShell command ─────────────────────────────────────────────
async function runPowerShell(script: string, timeoutMs: number = 10000): Promise<string> {
  // ✅ Base64 encoding use karein — CMD/PowerShell escaping se bachein
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`
  
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs })
    const out = (stdout || '').trim()
    const err = (stderr || '').trim()
    if (err && !out) throw new Error(err)
    return out || err
  } catch (e: any) {
    throw new Error(e?.message || String(e))
  }
}

// ── Helper: CMD command ────────────────────────────────────────────────────
async function runCmd(command: string, timeoutMs: number = 10000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, { timeout: timeoutMs })
    return (stdout || '').trim() || (stderr || '').trim()
  } catch (e: any) {
    throw new Error(e?.message || String(e))
  }
}

// ══════════════════════════════════════════════════════════════════════════
// TOOL 1: set_volume
// ══════════════════════════════════════════════════════════════════════════
export const SET_VOLUME_TOOL = {
  name: 'set_volume',
  description:
    'Sets the system volume to a specific level (0-100). Use this when the ' +
    'user asks to change, set, increase or decrease the volume.',
  parameters: {
    type: 'OBJECT',
    properties: {
      level: { type: 'NUMBER', description: 'Volume level 0-100' },
    },
    required: ['level'],
  },
}

// Get current volume via nircmd or PowerShell
async function getCurrentVolume(): Promise<number | null> {
  const nircmd = getNircmdPath()
  if (nircmd) {
    try {
      // nircmd can't easily read volume; use PowerShell for reading
    } catch {}
  }

  // PowerShell AudioDeviceCmdlets (if installed)
  try {
    const out = await runPowerShell(
      `(Get-AudioDevice -PlaybackVolume) -replace '[^0-9]',''`,
      5000,
    )
    const v = parseInt(out, 10)
    if (!isNaN(v)) return v
  } catch {}
  return null
}

export async function setVolume(args: Record<string, any>): Promise<string> {
  if (os.platform() !== 'win32') {
    return 'Volume control currently supports Windows only.'
  }

  const level = Math.max(0, Math.min(100, Math.round(Number(args?.level ?? 50))))
  console.log(`[setVolume] Requested: ${level}%`)

  const nircmd = getNircmdPath()
  if (!nircmd) {
    return (
      `Cannot control volume: nircmd.exe not found. ` +
      `Download from nirsoft.net/utils/nircmd.html and place in ` +
      `electron/actions/bin/.`
    )
  }

  // nircmd: 0-65535 range
  const nircmdValue = Math.round((level / 100) * 65535)

  try {
    await execAsync(`"${nircmd}" setsysvolume ${nircmdValue}`, { timeout: 5000 })
    console.log(`[setVolume] nircmd executed with value ${nircmdValue}`)
  } catch (e: any) {
    return `Could not set volume: ${e?.message || String(e)}`
  }

  // Verify (nircmd doesn't easily report; just confirm no error)
  // Return honest message
  return `Volume set to ${level}%.`
}

// ══════════════════════════════════════════════════════════════════════════
// TOOL 2: set_brightness
// ══════════════════════════════════════════════════════════════════════════
export const SET_BRIGHTNESS_TOOL = {
  name: 'set_brightness',
  description:
    'Sets the screen brightness to a specific level (0-100). Use this when ' +
    'the user asks to change, set, increase or decrease the brightness.',
  parameters: {
    type: 'OBJECT',
    properties: {
      level: { type: 'NUMBER', description: 'Brightness level 0-100' },
    },
    required: ['level'],
  },
}

// Read current brightness via WMI
async function getCurrentBrightness(): Promise<number | null> {
  try {
    const out = await runPowerShell(
      `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness`,
      5000,
    )
    const v = parseInt(out, 10)
    if (!isNaN(v)) return v
  } catch {}
  return null
}

export async function setBrightness(args: Record<string, any>): Promise<string> {
  if (os.platform() !== 'win32') {
    return 'Brightness control currently supports Windows only.'
  }

  const level = Math.max(0, Math.min(100, Math.round(Number(args?.level ?? 50))))
  console.log(`[setBrightness] Requested: ${level}%`)

  // Read current
  const before = await getCurrentBrightness()
  console.log(`[setBrightness] Before: ${before ?? 'unknown'}%`)

  // nircmd method first (fastest)
  const nircmd = getNircmdPath()
  if (nircmd) {
    try {
      await execAsync(`"${nircmd}" setbrightness ${level}`, { timeout: 5000 })
      // Verify
      await new Promise((r) => setTimeout(r, 500))
      const after = await getCurrentBrightness()
      if (after !== null && Math.abs(after - level) <= 5) {
        return `Brightness set to ${level}%.`
      }
    } catch (e) {
      console.log(`[setBrightness] nircmd failed: ${e}`)
    }
  }

  // PowerShell WMI fallback
  try {
    const script = `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${level})`
    await runPowerShell(script, 8000)
    await new Promise((r) => setTimeout(r, 500))
    const after = await getCurrentBrightness()
    if (after !== null) {
      return `Brightness set to ${level}% (verified: ${after}%).`
    }
    return `Brightness set to ${level}%.`
  } catch (e: any) {
    return `Could not set brightness: ${e?.message || String(e)}`
  }
}

// ══════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════
// TOOL 5: toggle_dark_mode
// ══════════════════════════════════════════════════════════════════════════
export const TOGGLE_DARK_MODE_TOOL = {
  name: 'toggle_dark_mode',
  description:
    'Turns Windows dark mode on or off. Use this when the user asks to ' +
    'enable or disable dark mode / light mode.',
  parameters: {
    type: 'OBJECT',
    properties: {
      state: { type: 'STRING', description: "'on' for dark, 'off' for light" },
    },
    required: ['state'],
  },
}

export async function toggleDarkMode(args: Record<string, any>): Promise<string> {
  if (os.platform() !== 'win32') {
    return 'Dark mode control currently supports Windows only.'
  }

  const state = String(args?.state || '').toLowerCase().trim()
  if (state !== 'on' && state !== 'off') {
    return "Please specify 'on' or 'off'."
  }

  // 0 = dark, 1 = light
  const value = state === 'on' ? 0 : 1

  // Read CURRENT state first
  let before: number | null = null
  try {
    const readOut = await runPowerShell(
      `(Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" -Name "AppsUseLightTheme" -ErrorAction SilentlyContinue).AppsUseLightTheme`,
      5000,
    )
    before = parseInt(readOut, 10)
    if (isNaN(before)) before = null
    console.log(`[toggleDarkMode] Before: AppsUseLightTheme=${before}`)
  } catch (e) {
    console.log(`[toggleDarkMode] Read failed: ${e}`)
  }

  // Already in desired state?
  if (before !== null) {
    if (state === 'on' && before === 0) {
      return `Dark mode is already on.`
    }
    if (state === 'off' && before === 1) {
      return `Dark mode is already off.`
    }
  }

  // Set registry
  const script = `
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" -Name "AppsUseLightTheme" -Value ${value} -Type DWord -Force
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" -Name "SystemUsesLightTheme" -Value ${value} -Type DWord -Force
    Write-Output "SET:OK"
  `.trim()

  try {
    await runPowerShell(script, 8000)
  } catch (e: any) {
    return `Could not set dark mode: ${e?.message || String(e)}`
  }

  // Verify (read back)
  await new Promise((r) => setTimeout(r, 500))
  let after: number | null = null
  try {
    const readOut = await runPowerShell(
      `(Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" -Name "AppsUseLightTheme" -ErrorAction SilentlyContinue).AppsUseLightTheme`,
      5000,
    )
    after = parseInt(readOut, 10)
    if (isNaN(after)) after = null
    console.log(`[toggleDarkMode] After: AppsUseLightTheme=${after}`)
  } catch {}

  // Refresh explorer to apply visually (immediate effect)
  try {
    // This tells Windows to reload theme
    await runPowerShell(
      `Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 800; if (-not (Get-Process explorer -ErrorAction SilentlyContinue)) { Start-Process explorer }`,
      10000,
    )
  } catch (e) {
    console.log(`[toggleDarkMode] Explorer refresh failed: ${e}`)
  }

  // Verify
  if (after !== null) {
    if (state === 'on' && after === 0) {
      return `Dark mode turned on. You may need to sign out and back in for full effect.`
    }
    if (state === 'off' && after === 1) {
      return `Light mode turned on. You may need to sign out and back in for full effect.`
    }
  }

  return `Dark mode ${state} command sent. Sign out and back in to see the change.`
}
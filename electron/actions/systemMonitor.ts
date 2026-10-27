import si from 'systeminformation'
import { BrowserWindow, Notification } from 'electron'

// ── Configuration ──────────────────────────────────────────────────────────
const CHECK_INTERVAL_MS = 30_000      // 30 seconds
const CPU_THRESHOLD = 90              // 90%
const RAM_THRESHOLD = 90              // 90%
const COOLDOWN_MS = 5 * 60 * 1000     // 5 minutes between alerts

// ── Cooldown tracking ──────────────────────────────────────────────────────
const lastAlert: Record<string, number> = {
  cpu: 0,
  ram: 0,
}

// ── Alert sending ──────────────────────────────────────────────────────────
function sendAlert(type: 'cpu' | 'ram', value: number): void {
  const now = Date.now()
  if (now - lastAlert[type] < COOLDOWN_MS) {
    return   // Still in cooldown
  }
  lastAlert[type] = now

  const label = type === 'cpu' ? 'CPU' : 'RAM'
  const title = `⚠️ High ${label} Usage`
  const body = `${label} is at ${value.toFixed(1)}%. Consider closing some apps.`

  console.log(`[SystemMonitor] 🚨 ${title}: ${body}`)

  // 1. Windows notification
  try {
    if (Notification.isSupported()) {
      new Notification({
        title,
        body,
        urgency: 'critical',
      }).show()
    }
  } catch (e) {
    console.error('[SystemMonitor] Notification failed:', e)
  }

  // 2. UI message
  try {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('system:alert', {
        type,
        value,
        message: body,
      })
    }
  } catch (e) {
    console.error('[SystemMonitor] UI message failed:', e)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MONITOR LOOP
// ══════════════════════════════════════════════════════════════════════════
let monitorTimer: NodeJS.Timeout | null = null
let isRunning = false

async function checkSystem(): Promise<void> {
  try {
    const [cpu, mem] = await Promise.all([
      si.currentLoad(),
      si.mem(),
    ])

    const cpuPct = cpu.currentLoad
    const ramPct = (mem.used / mem.total) * 100

    if (cpuPct >= CPU_THRESHOLD) {
      sendAlert('cpu', cpuPct)
    }
    if (ramPct >= RAM_THRESHOLD) {
      sendAlert('ram', ramPct)
    }
  } catch (e) {
    console.error('[SystemMonitor] Check failed:', e)
  }
}

// ── Start / Stop ───────────────────────────────────────────────────────────
export function startSystemMonitor(): void {
  if (isRunning) {
    console.log('[SystemMonitor] Already running')
    return
  }
  isRunning = true
  console.log(
    `[SystemMonitor] ✅ Started (interval: ${CHECK_INTERVAL_MS / 1000}s, ` +
    `CPU > ${CPU_THRESHOLD}%, RAM > ${RAM_THRESHOLD}%)`,
  )
  monitorTimer = setInterval(checkSystem, CHECK_INTERVAL_MS)
  // Pehla check foran
  checkSystem()
}

export function stopSystemMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = null
  }
  isRunning = false
  console.log('[SystemMonitor] Stopped')
}

// ══════════════════════════════════════════════════════════════════════════
// TOOL DECLARATION — Status check on demand
// ══════════════════════════════════════════════════════════════════════════
export const SYSTEM_MONITOR_TOOL = {
  name: 'system_monitor',
  description:
    'Checks the current CPU and RAM usage and reports if anything is ' +
    'unusually high. Use when the user asks about system health, ' +
    'performance, or if the computer is running slowly.',
  parameters: {
    type: 'OBJECT',
    properties: {},
    required: [],
  },
}

export async function systemMonitorStatus(): Promise<string> {
  try {
    const [cpu, mem] = await Promise.all([
      si.currentLoad(),
      si.mem(),
    ])

    const cpuPct = cpu.currentLoad
    const ramPct = (mem.used / mem.total) * 100
    const ramUsed = (mem.used / 1024 / 1024 / 1024).toFixed(1)
    const ramTotal = (mem.total / 1024 / 1024 / 1024).toFixed(1)

    const cpuStatus = cpuPct > CPU_THRESHOLD ? '⚠️ HIGH' : '✅ OK'
    const ramStatus = ramPct > RAM_THRESHOLD ? '⚠️ HIGH' : '✅ OK'

    return (
      `System health:\n` +
      `  CPU: ${cpuPct.toFixed(1)}% ${cpuStatus}\n` +
      `  RAM: ${ramUsed} GB / ${ramTotal} GB (${ramPct.toFixed(1)}%) ${ramStatus}\n` +
      `  Thresholds: CPU ${CPU_THRESHOLD}%, RAM ${RAM_THRESHOLD}%\n` +
      `  Background monitoring: ${isRunning ? 'ACTIVE' : 'inactive'}`
    )
  } catch (e: any) {
    return `Could not read system health: ${e?.message || String(e)}`
  }
}
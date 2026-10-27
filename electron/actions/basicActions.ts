import os from 'node:os'
import si from 'systeminformation'

// ── Tool Declarations ──────────────────────────────────────────────────────
export const BASIC_TOOLS = [
  {
    name: 'get_time',
    description: 'Returns the current time on this computer.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'get_date',
    description: 'Returns the current date on this computer.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'system_status',
    description:
      'Returns real-time system metrics: CPU usage, RAM, uptime, platform.',
    parameters: { type: 'OBJECT', properties: {} },
  },
]

// ── Handlers ───────────────────────────────────────────────────────────────
export async function getTime(): Promise<string> {
  const now = new Date()
  return now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })
}

export async function getDate(): Promise<string> {
  const now = new Date()
  return now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export async function getSystemStatus(): Promise<string> {
  try {
    const [cpu, mem, time] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.time(),
    ])

    const cpuPct = cpu.currentLoad.toFixed(1)
    const ramUsed = (mem.used / 1024 / 1024 / 1024).toFixed(2)
    const ramTotal = (mem.total / 1024 / 1024 / 1024).toFixed(2)
    const ramPct = ((mem.used / mem.total) * 100).toFixed(1)
    
    // ✅ Actual boot time (Fast Startup ke bawajood)
    const bootTime = new Date(Date.now() - time.uptime * 1000)
    const bootStr = bootTime.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    
    const uptimeHrs = (time.uptime / 3600).toFixed(1)

    return (
      `Platform: ${os.type()} ${os.release()}\n` +
      `CPU: ${cpuPct}% (${os.cpus().length} cores)\n` +
      `RAM: ${ramUsed} GB / ${ramTotal} GB (${ramPct}%)\n` +
      `Boot time: ${bootStr}\n` +
      `Uptime: ${uptimeHrs} hours`
    )
  } catch (e: any) {
    return `Could not read system status: ${e?.message || String(e)}`
  }
}
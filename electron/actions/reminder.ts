import schedule from 'node-schedule'
import { BrowserWindow, Notification } from 'electron'
import { getUserName as getConfiguredUserName } from '../core/configManager'

// ── Active reminders (memory mein) ─────────────────────────────────────────
interface Reminder {
  id: string
  text: string
  fireAt: Date
  job: schedule.Job
  repeat?: string          // 'daily' | 'weekly' | 'monthly' | 'weekdays' | undefined
  originalText?: string    // snooze ke liye original text
}

const activeReminders = new Map<string, Reminder>()

// ══════════════════════════════════════════════════════════════════════════
// ✅ NATURAL REMINDER MESSAGES — Random natural options
// ══════════════════════════════════════════════════════════════════════════
function getUserName(): string {
  return getConfiguredUserName() || 'Ali'
}

function getNaturalReminderMessage(reminderText: string): string {
  const name = getUserName()

  const templates = [
    `${name}, ${reminderText} — yaad aa gaya?`,
    `Oy ${name}, ${reminderText} ka waqt ho gaya!`,
    `${name}, ${reminderText} — abhi karna hai.`,
    `Bhai ${name}, ${reminderText} — dekh lo.`,
    `${name}, yaad dilana tha: ${reminderText}`,
    `${name}, ${reminderText} — time ho gaya.`,
    `Chalo ${name}, ${reminderText} — abhi shuru karo.`,
    `${name}, ek reminder: ${reminderText}`,
  ]

  return templates[Math.floor(Math.random() * templates.length)]
}

// ── Helper: Windows Notification + UI message + TTS ────────────────────────
function fireReminder(reminder: Reminder): void {
  console.log(`[Reminder] 🔔 FIRING: ${reminder.text}`)

  // 1. Windows notification
  try {
    if (Notification.isSupported()) {
      new Notification({
        title: '⏰ Yaad Dilao',
        body: reminder.text,
        urgency: 'critical',
      }).show()
    }
  } catch (e) {
    console.error('[Reminder] Notification failed:', e)
  }

  // 2. UI + Natural TTS
  try {
    const windows = BrowserWindow.getAllWindows()
    const naturalMsg = getNaturalReminderMessage(reminder.text)

    for (const win of windows) {
      win.webContents.send('reminder:fired', {
        id: reminder.id,
        text: reminder.text,
      })

      // ✅ Natural TTS event
      win.webContents.send('reminder:speak', {
        text: naturalMsg,
      })
    }
  } catch (e) {
    console.error('[Reminder] UI message failed:', e)
  }

  // 3. Recurring hai? To active rakhein, warna remove karein
  if (!reminder.repeat) {
    activeReminders.delete(reminder.id)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// TOOL DECLARATIONS
// ══════════════════════════════════════════════════════════════════════════
export const SET_REMINDER_TOOL = {
  name: 'set_reminder',
  description:
    'Sets a reminder for the user. Use this when the user says things like ' +
    '"remind me in 5 minutes", "remind me at 3 PM", "yaad dilao 10 minute baad", ' +
    '"har roz 9 baje yaad dilao", "har Monday". ' +
    'Supports relative time (in X minutes/hours), absolute time (at 3 PM), ' +
    'and recurring (daily, weekly, monthly, weekdays).',
  parameters: {
    type: 'OBJECT',
    properties: {
      text: {
        type: 'STRING',
        description: 'What to remind the user about (e.g. "call mother", "drink water")',
      },
      minutes_from_now: {
        type: 'NUMBER',
        description: 'Minutes from now to fire the reminder',
      },
      hours_from_now: {
        type: 'NUMBER',
        description: 'Hours from now to fire the reminder',
      },
      at_time: {
        type: 'STRING',
        description:
          'Absolute time in HH:MM format (24-hour), e.g. "15:30" for 3:30 PM.',
      },
      repeat: {
        type: 'STRING',
        description:
          "'daily' | 'weekly' | 'monthly' | 'weekdays'. " +
          'Use for recurring reminders. Leave empty for one-time.',
      },
    },
    required: ['text'],
  },
}

export const SNOOZE_REMINDER_TOOL = {
  name: 'snooze_reminder',
  description:
    'Snoozes the most recent reminder for N minutes. Use when the user says ' +
    '"5 minute baad dobara yaad dilao", "snooze", "baad me yaad dilao".',
  parameters: {
    type: 'OBJECT',
    properties: {
      minutes: {
        type: 'NUMBER',
        description: 'How many minutes to snooze (default: 5)',
      },
    },
    required: [],
  },
}

export const LIST_REMINDERS_TOOL = {
  name: 'list_reminders',
  description:
    'Lists all active reminders. Use when the user asks "mere saare reminders dikhao", ' +
    '"what reminders do I have", "reminders list".',
  parameters: {
    type: 'OBJECT',
    properties: {},
    required: [],
  },
}

export const CANCEL_REMINDER_TOOL = {
  name: 'cancel_reminder',
  description:
    'Cancels a reminder by ID. Use when the user says "reminder hatao", ' +
    '"cancel my reminder". Get the ID from list_reminders first.',
  parameters: {
    type: 'OBJECT',
    properties: {
      id: {
        type: 'STRING',
        description: 'Reminder ID (from list_reminders)',
      },
    },
    required: ['id'],
  },
}

// ── Helper: Absolute time parse ────────────────────────────────────────────
function parseAtTime(atTime: string): Date | null {
  try {
    const match = atTime.trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!match) return null
    const hours = parseInt(match[1], 10)
    const minutes = parseInt(match[2], 10)
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null

    const now = new Date()
    const target = new Date()
    target.setHours(hours, minutes, 0, 0)
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1)
    }
    return target
  } catch {
    return null
  }
}

// ── Helper: Recurring rule parse ───────────────────────────────────────────
function parseRecurringRule(repeat: string): schedule.RecurrenceRule | null {
  const r = repeat.toLowerCase().trim()
  try {
    const rule = new schedule.RecurrenceRule()
    if (r === 'daily') return rule
    if (r === 'weekly') {
      rule.dayOfWeek = new Date().getDay()
      return rule
    }
    if (r === 'monthly') {
      rule.date = new Date().getDate()
      return rule
    }
    if (r === 'weekdays') {
      rule.dayOfWeek = [1, 2, 3, 4, 5]
      return rule
    }
    return null
  } catch {
    return null
  }
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER: set_reminder
// ══════════════════════════════════════════════════════════════════════════
export async function setReminder(args: Record<string, any>): Promise<string> {
  const text = String(args?.text || '').trim()
  if (!text) return 'Kuch batana tha yaad dilane ke liye?'

  const minutesFromNow = args?.minutes_from_now ? Number(args.minutes_from_now) : 0
  const hoursFromNow = args?.hours_from_now ? Number(args.hours_from_now) : 0
  const atTime = String(args?.at_time || '').trim()
  const repeat = String(args?.repeat || '').toLowerCase().trim()

  // ── Fire time calculate karein ─────────────────────────────────────────
  let fireAt: Date

  if (atTime) {
    const parsed = parseAtTime(atTime)
    if (!parsed) return `Time format samajh nahi aaya: "${atTime}". HH:MM (24-hour) mein batao.`
    fireAt = parsed
  } else if (minutesFromNow > 0 || hoursFromNow > 0) {
    const ms = (minutesFromNow * 60 + hoursFromNow * 3600) * 1000
    fireAt = new Date(Date.now() + ms)
  } else {
    return 'Time batao — kitne minute baad ya kis waqt yaad dilana hai?'
  }

  // ── Create reminder ────────────────────────────────────────────────────
  const id = `rem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  let job: schedule.Job

  if (repeat) {
    const rule = parseRecurringRule(repeat)
    if (!rule) return `"${repeat}" samajh nahi aaya. daily, weekly, monthly, ya weekdays use karo.`

    rule.hour = fireAt.getHours()
    rule.minute = fireAt.getMinutes()

    job = schedule.scheduleJob(rule, () => {
      fireReminder({
        id, text, fireAt, job,
        repeat,
        originalText: text,
      })
    })
  } else {
    job = schedule.scheduleJob(fireAt, () => {
      fireReminder({ id, text, fireAt, job })
    })
  }

  if (!job) {
    return `Reminder set nahi ho saka. Time guzar gaya shayad.`
  }

  activeReminders.set(id, {
    id, text, fireAt, job,
    repeat: repeat || undefined,
    originalText: text,
  })

  // ── Natural Reply ──────────────────────────────────────────────────────
  const now = new Date()
  const diffMs = fireAt.getTime() - now.getTime()
  const diffMin = Math.round(diffMs / 60000)

  const timeStr = fireAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })

  let when = ''
  if (repeat) {
    when = ` (${repeat})`
  } else if (diffMin < 1) {
    when = ' (ek minute se bhi kam mein)'
  } else if (diffMin < 60) {
    when = ` (${diffMin} minute baad)`
  } else {
    const h = Math.floor(diffMin / 60)
    const m = diffMin % 60
    when = ` (${h} ghante${m > 0 ? ` ${m} minute` : ''} baad)`
  }

  console.log(`[setReminder] ✅ Set: "${text}" at ${timeStr}${when}`)

  const repeatMsg = repeat ? ` — ${repeat} repeat hoga.` : ''
  return `Theek hai, "${text}" ka reminder set kar diya${when}${repeatMsg}`
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER: snooze_reminder
// ══════════════════════════════════════════════════════════════════════════
export async function snoozeReminder(args: Record<string, any>): Promise<string> {
  const minutes = args?.minutes ? Number(args.minutes) : 5
  const snoozeMs = minutes * 60 * 1000

  if (activeReminders.size === 0) {
    return 'Koi reminder nahi hai snooze karne ke liye.'
  }

  const reminders = Array.from(activeReminders.values())
  const last = reminders[reminders.length - 1]

  try {
    last.job.cancel()
  } catch {}

  const newFireAt = new Date(Date.now() + snoozeMs)
  const newId = `rem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const newJob = schedule.scheduleJob(newFireAt, () => {
    fireReminder({
      id: newId,
      text: last.text,
      fireAt: newFireAt,
      job: newJob,
      originalText: last.originalText,
    })
  })

  if (!newJob) {
    return `Snooze nahi ho saka.`
  }

  activeReminders.delete(last.id)
  activeReminders.set(newId, {
    id: newId,
    text: last.text,
    fireAt: newFireAt,
    job: newJob,
    originalText: last.originalText,
  })

  const timeStr = newFireAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  })

  console.log(`[snoozeReminder] ✅ Snoozed: "${last.text}" for ${minutes} min`)
  return `Theek hai, "${last.text}" ko ${minutes} minute ke liye snooze kar diya. ${timeStr} pe dobara yaad dila dunga.`
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER: list_reminders
// ══════════════════════════════════════════════════════════════════════════
export async function listReminders(): Promise<string> {
  if (activeReminders.size === 0) {
    return 'Abhi koi reminder set nahi hai.'
  }

  const reminders = Array.from(activeReminders.values())
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())

  let out = `Ye hain aapke reminders (${reminders.length}):\n\n`
  reminders.forEach((r, i) => {
    const timeStr = r.fireAt.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
    out += `${i + 1}. "${r.text}"\n`
    out += `   ⏰ ${timeStr}`
    if (r.repeat) out += ` (${r.repeat} repeat)`
    out += `\n   🆔 ${r.id}\n\n`
  })

  return out.trim()
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER: cancel_reminder
// ══════════════════════════════════════════════════════════════════════════
export async function cancelReminder(args: Record<string, any>): Promise<string> {
  const id = String(args?.id || '').trim()
  if (!id) return 'Reminder ka ID batao — list_reminders se le lo.'

  const reminder = activeReminders.get(id)
  if (!reminder) {
    return `Is ID ka koi reminder nahi mila: ${id}`
  }

  try {
    reminder.job.cancel()
  } catch {}

  activeReminders.delete(id)

  console.log(`[cancelReminder] ✅ Cancelled: "${reminder.text}"`)
  return `Theek hai, "${reminder.text}" ka reminder hata diya.`
}
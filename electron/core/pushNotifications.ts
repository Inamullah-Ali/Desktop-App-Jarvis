import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentReference,
} from 'firebase/firestore'
import { db } from './firebase'

export interface DesktopDownloadProgress {
  id: string
  state: 'downloading' | 'complete' | 'cancelled' | 'error'
  received: number
  total?: number
  percent?: number
  path?: string
  title?: string
  type?: string
  error?: string
  [key: string]: unknown
}

interface TrackedDownload {
  ref: DocumentReference
  lastPercent: number
  lastReceived: number
  lastState: DesktopDownloadProgress['state']
  initialized: boolean
  queue: Promise<void>
}

let activeUserId: string | null = null
const trackedDownloads = new Map<string, TrackedDownload>()

export function setActiveNotificationUser(userId: string | null): void {
  if (activeUserId === userId) return
  activeUserId = userId
  trackedDownloads.clear()
}

export async function sendTestPushNotification(): Promise<string> {
  const userId = activeUserId
  if (!userId) {
    throw new Error('Log in to the desktop app before testing push notifications.')
  }

  const userSnapshot = await getDoc(doc(db, 'users', userId))
  const userData = userSnapshot.data()
  if (userData?.notificationsEnabled === false) {
    throw new Error('Push notifications are switched off in the mobile app.')
  }
  if (typeof userData?.expoPushToken !== 'string' || !userData.expoPushToken) {
    throw new Error('No mobile push token is registered. Open the mobile app and allow notifications first.')
  }

  const title = 'Jarvis push test'
  const body = 'Test notification from your desktop. If you can see this on your lock screen, push notifications are working.'
  const notificationRef = await addDoc(collection(db, 'users', userId, 'notifications'), {
    title,
    body,
    type: 'push_test',
    read: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await sendPushNotification(userId, notificationRef.id, title, body, 'push_test')
  return 'Expo accepted the test push. Delivery to the phone can take a few seconds.'
}

export async function notifyDesktopDeviceStatus(
  userId: string,
  status: 'online' | 'offline',
): Promise<void> {
  const title = status === 'online' ? 'Laptop online' : 'Laptop offline'
  const body = status === 'online'
    ? 'Your Jarvis desktop is online and ready.'
    : 'Your Jarvis desktop has gone offline.'
  const notificationRef = await addDoc(collection(db, 'users', userId, 'notifications'), {
    title,
    body,
    type: 'device_status',
    deviceStatus: status,
    read: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await sendPushNotification(userId, notificationRef.id, title, body, 'device_status')
}

export async function notifyDesktopTask(toolNames: string[]): Promise<void> {
  const userId = activeUserId
  if (!userId || toolNames.length === 0) return

  const labels: Record<string, string> = {
    open_app: 'App action',
    set_volume: 'Volume change',
    set_brightness: 'Brightness change',
    toggle_dark_mode: 'Display setting change',
    file_controller: 'File operation',
    open_file: 'File opened',
    search_files: 'File search',
    google_search: 'Web search',
    web_search: 'Web search',
    youtube_search: 'Video search',
    shopping_search: 'Shopping search',
    set_reminder: 'Reminder set',
    snooze_reminder: 'Reminder updated',
    cancel_reminder: 'Reminder cancelled',
    system_status: 'System check',
    system_monitor: 'System check',
    undo: 'Undo operation',
  }
  const activities = [...new Set(toolNames
    .filter((name) => Object.prototype.hasOwnProperty.call(labels, name))
    .map((name) => labels[name]))]
  if (activities.length === 0) return

  const title = 'Desktop activity'
  const body = `Jarvis ran: ${activities.join(', ')}.`
  const notificationRef = await addDoc(collection(db, 'users', userId, 'notifications'), {
    title,
    body,
    type: 'desktop_task',
    read: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await sendPushNotification(userId, notificationRef.id, title, body, 'desktop_task')
}

export function notifyDesktopDownload(event: DesktopDownloadProgress): Promise<void> {
  const userId = activeUserId
  if (!userId) return Promise.resolve()

  const percent = typeof event.percent === 'number' && Number.isFinite(event.percent)
    ? Math.min(100, Math.max(0, Math.round(event.percent ?? 0)))
    : null
  const received = Number.isFinite(event.received) ? Math.max(0, event.received) : 0
  let tracked = trackedDownloads.get(event.id)
  const isNew = !tracked

  if (!tracked) {
    tracked = {
      ref: doc(collection(db, 'users', userId, 'notifications')),
      lastPercent: -5,
      lastReceived: 0,
      lastState: event.state,
      initialized: false,
      queue: Promise.resolve(),
    }
    trackedDownloads.set(event.id, tracked)
  }

  const isTerminal = event.state !== 'downloading'
  const shouldUpdate = isNew
    || isTerminal
    || event.state !== tracked.lastState
    || (percent !== null && percent >= tracked.lastPercent + 5)
    || (percent === null && received >= tracked.lastReceived + 1024 * 1024)

  if (!shouldUpdate) return Promise.resolve()

  if (percent !== null) tracked.lastPercent = percent
  tracked.lastReceived = received
  tracked.lastState = event.state
  const record = tracked
  const notificationId = record.ref.id
  const name = String(event.path || event.title || 'Desktop download')
  const title = event.state === 'complete'
    ? 'Download complete'
    : event.state === 'error'
      ? 'Download failed'
      : event.state === 'cancelled'
        ? 'Download cancelled'
        : 'Download in progress'
  const body = event.state === 'complete'
    ? `${name} finished downloading.`
    : event.state === 'error'
      ? `${name} could not be downloaded${event.error ? `: ${event.error}` : '.'}`
      : event.state === 'cancelled'
      ? `${name} was cancelled.`
      : percent === null
        ? `${name} is downloading (${formatBytes(received)} received).`
        : `${name} is downloading (${percent}%).`
  const notification = {
    title,
    body,
    type: 'download',
    downloadId: event.id,
    downloadState: event.state,
    progress: percent,
    received,
    total: event.total ?? null,
    fileName: name,
    updatedAt: serverTimestamp(),
  }
  const shouldSendPush = isNew || isTerminal

  const operation = record.queue.then(async () => {
    if (activeUserId !== userId) return

    if (record.initialized) {
      await updateDoc(record.ref, notification)
    } else {
      await setDoc(record.ref, {
        ...notification,
        read: false,
        createdAt: serverTimestamp(),
      })
      record.initialized = true
    }

    if (shouldSendPush) {
      await sendPushNotification(userId, notificationId, title, body)
    }
  })
  record.queue = operation.catch((error: unknown) => {
    console.error(`[Push] Could not sync download notification ${event.id}:`, error)
  })
  return operation
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let size = bytes / 1024
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`
}

async function sendPushNotification(
  userId: string,
  notificationId: string,
  title: string,
  body: string,
  type = 'download',
): Promise<void> {
  const notificationRef = doc(db, 'users', userId, 'notifications', notificationId)
  const userSnapshot = await getDoc(doc(db, 'users', userId))
  const userData = userSnapshot.data()
  if (userData?.notificationsEnabled === false) {
    await updateDoc(notificationRef, { pushStatus: 'disabled', pushError: null })
    return
  }

  const token = userData?.expoPushToken
  if (typeof token !== 'string' || !token) {
    await updateDoc(notificationRef, {
      pushStatus: 'missing_token',
      pushError: 'This phone has not registered an Expo push token. Open the app and allow notifications.',
    })
    console.error(`[Push] No Expo push token registered for user ${userId}`)
    return
  }

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token,
        title,
        body,
        sound: 'default',
        channelId: 'default',
        data: { notificationId, type },
        priority: 'high',
      }),
    })
    if (!response.ok) {
      throw new Error(`Expo push service returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
    }

    const result = await response.json() as {
      data?: { status?: string; message?: string; id?: string; details?: { error?: string } }
        | Array<{ status?: string; message?: string; id?: string; details?: { error?: string } }>
    }
    const ticket = Array.isArray(result.data) ? result.data[0] : result.data
    if (ticket?.status === 'error') {
      const message = [ticket.details?.error, ticket.message].filter(Boolean).join(': ')
        || 'Expo rejected the push notification'
      await updateDoc(notificationRef, { pushStatus: 'error', pushError: message })
      throw new Error(message)
    }
    if (ticket?.status !== 'ok') {
      throw new Error('Expo returned an unexpected push response')
    }

    await updateDoc(notificationRef, {
      pushStatus: 'accepted',
      pushError: null,
      pushTicketId: ticket.id || null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[Push] Could not deliver ${type} notification ${notificationId}:`, message)
    await updateDoc(notificationRef, { pushStatus: 'error', pushError: message })
    throw error
  }
}

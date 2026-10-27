import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const historyFile = path.join(app.getPath('userData'), 'download_history.json')

export function saveDownloadHistory(history: any[]) {
  try {
    // Sirf last 100 downloads save karein taake file bari na ho
    const recent = history.slice(0, 100)
    fs.writeFileSync(historyFile, JSON.stringify(recent, null, 2), 'utf-8')
  } catch (e) {
    console.error('[DownloadHistory] Save failed:', e)
  }
}

export function loadDownloadHistory(): any[] {
  try {
    if (fs.existsSync(historyFile)) {
      const data = fs.readFileSync(historyFile, 'utf-8')
      return JSON.parse(data)
    }
  } catch (e) {
    console.error('[DownloadHistory] Load failed:', e)
  }
  return []
}
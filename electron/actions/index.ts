import { BASIC_TOOLS, getTime, getDate, getSystemStatus } from './basicActions'
import { OPEN_APP_TOOL, openApp } from './openApp'
import { SET_VOLUME_TOOL, setVolume, SET_BRIGHTNESS_TOOL, setBrightness, TOGGLE_DARK_MODE_TOOL, toggleDarkMode } from './systemControl'
import { FILE_CONTROLLER_TOOL, fileController, OPEN_FILE_TOOL, openFile } from './fileController'
import { GET_WEATHER_TOOL, getWeather } from './weather'
import {
  GET_NEWS_TOOL, getNews,
  GOOGLE_SEARCH_TOOL, googleSearch,
  IMAGE_SEARCH_TOOL, imageSearch,
  YOUTUBE_SEARCH_TOOL, youtubeSearch,
  DOWNLOAD_MEDIA_TOOL, downloadMedia,
  DOWNLOAD_FILE_TOOL, downloadFile,
  WEB_SEARCH_TOOL, webSearch
} from './newsSearch'
import { SET_REMINDER_TOOL, setReminder, SNOOZE_REMINDER_TOOL, snoozeReminder, LIST_REMINDERS_TOOL, listReminders, CANCEL_REMINDER_TOOL, cancelReminder } from './reminder'
import { SYSTEM_MONITOR_TOOL, systemMonitorStatus } from './systemMonitor'
import { SEARCH_FILES_TOOL, searchFiles } from './searchFiles'
import { undoLast, undoHistory } from '../core/undo'
import { SHOPPING_SEARCH_TOOL, shoppingSearch } from './newsSearch'

const UNDO_TOOL = {
  name: 'undo',
  description: 'Reverses the last file operation.',
  parameters: { type: 'OBJECT', properties: { action: { type: 'STRING' } }, required: [] },
}

export const ALL_TOOLS = [
  ...BASIC_TOOLS, OPEN_APP_TOOL, SET_VOLUME_TOOL, SET_BRIGHTNESS_TOOL, TOGGLE_DARK_MODE_TOOL,
  FILE_CONTROLLER_TOOL, OPEN_FILE_TOOL, GET_WEATHER_TOOL, GET_NEWS_TOOL, GOOGLE_SEARCH_TOOL,
  IMAGE_SEARCH_TOOL, YOUTUBE_SEARCH_TOOL, DOWNLOAD_MEDIA_TOOL, DOWNLOAD_FILE_TOOL, WEB_SEARCH_TOOL,
  SET_REMINDER_TOOL, SNOOZE_REMINDER_TOOL, LIST_REMINDERS_TOOL, CANCEL_REMINDER_TOOL,
  SYSTEM_MONITOR_TOOL, SEARCH_FILES_TOOL, UNDO_TOOL,SHOPPING_SEARCH_TOOL,
]

export const TOOL_HANDLERS: Record<string, (args: Record<string, any>) => Promise<string>> = {
  get_time: () => getTime(),
  get_date: () => getDate(),
  system_status: () => getSystemStatus(),
  open_app: (args) => openApp(args),
  set_volume: (args) => setVolume(args),
  set_brightness: (args) => setBrightness(args),
  toggle_dark_mode: (args) => toggleDarkMode(args),
  file_controller: (args) => fileController(args),
  open_file: (args) => openFile(args),
  get_weather: (args) => getWeather(args),
  get_news: (args) => getNews(args),
  google_search: (args) => googleSearch(args),
  image_search: (args) => imageSearch(args),
  youtube_search: (args) => youtubeSearch(args),
  download_media: (args) => downloadMedia(args),
  download_file: (args) => downloadFile(args),
  web_search: (args) => webSearch(args),
  set_reminder: (args) => setReminder(args),
  snooze_reminder: (args) => snoozeReminder(args),
  list_reminders: () => listReminders(),
  cancel_reminder: (args) => cancelReminder(args),
  shopping_search: (args) => shoppingSearch(args),
  system_monitor: () => systemMonitorStatus(),
  search_files: (args) => searchFiles(args),
  undo: async (args) => {
    const action = String(args?.action || 'undo').toLowerCase().trim()
    if (action === 'list') {
      const items = undoHistory()
      return items.length > 0 ? `Undo list:\n${items.join('\n')}` : 'List empty.'
    }
    return await undoLast()
  },
}

export async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  const handler = TOOL_HANDLERS[name]
  if (!handler) return `Unknown tool: ${name}`
  try {
    const result = await handler(args)
    return result
  } catch (e: any) { return `Tool '${name}' failed: ${e?.message || String(e)}` }
}
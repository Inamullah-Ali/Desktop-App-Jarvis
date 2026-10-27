import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { notifyDesktopDownload, type DesktopDownloadProgress } from '../core/pushNotifications'

function emitDownloadProgress(event: DesktopDownloadProgress): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('download:progress', event)
  })
  void notifyDesktopDownload(event).catch((error: unknown) => {
    console.error('[Push] Could not send download notification:', error)
  })
}

// ══════════════════════════════════════════════════════════════════════════
// ✅ DOWNLOAD QUEUE SYSTEM (Max 5 Concurrent)
// ══════════════════════════════════════════════════════════════════════════
const downloadQueue: Array<{ id: string, url: string, audioOnly: boolean, title: string }> = []
let activeDownloadsCount = 0
const MAX_CONCURRENT_DOWNLOADS = 5

async function processDownloadQueue() {
  if (activeDownloadsCount >= MAX_CONCURRENT_DOWNLOADS || downloadQueue.length === 0) return

  const item = downloadQueue.shift()
  if (!item) return

  activeDownloadsCount++
  console.log(`[Queue] Starting: ${item.title} (Active: ${activeDownloadsCount}, Left: ${downloadQueue.length})`)

  try {
    await executeDownload(item.id, item.url, item.audioOnly, item.title)
  } catch (e) {
    console.error(`[Queue] Failed: ${item.title}`, e)
  } finally {
    activeDownloadsCount--
    // ✅ Jaise hi ek download khatam, agla shuru karo
    processDownloadQueue()
  }
}

// ── Helper: HTTP GET ───────────────────────────────────────────────────────
function httpGet(url: string, timeoutMs: number = 10000, extraHeaders: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,ur;q=0.8',
      ...extraHeaders,
    }
    const req = lib.get(url, { timeout: timeoutMs, headers }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString()
        res.resume()
        httpGet(redirectUrl, timeoutMs, extraHeaders).then(resolve).catch(reject)
        return
      }
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve(data))
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
    req.on('error', (e) => reject(e))
  })
}

function decodeHtmlEntities(str: string): string {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10))).replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

// ══════════════════════════════════════════════════════════════════════════
// TOOL 1: get_news
// ══════════════════════════════════════════════════════════════════════════
export const GET_NEWS_TOOL = {
  name: 'get_news',
  description: 'Gets live news headlines from Google News.',
  parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, count: { type: 'NUMBER' } }, required: [] },
}

export async function getNews(args: Record<string, any>): Promise<string> {
  const query = String(args?.query || '').trim()
  const count = Math.min(20, Math.max(1, Number(args?.count || 8)))
  const url = query ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-PK&gl=PK&ceid=PK:en` : `https://news.google.com/rss?hl=en-PK&gl=PK&ceid=PK:en`
  try {
    const xml = await httpGet(url, 12000)
    const items: any[] = []
    const itemRegex = /<item>([\s\S]*?)<\/item>/g
    let match
    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1]
      const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/)
      if (titleMatch) {
        let title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()
        items.push({ title: decodeHtmlEntities(title) })
      }
    }
    if (items.length === 0) return `No news found for "${query || 'top stories'}".`
    const selected = items.slice(0, count)
    let out = query ? `Latest news for "${query}" (${selected.length}):\n` : `Top news headlines (${selected.length}):\n`
    selected.forEach((item, i) => { out += `\n${i + 1}. ${item.title}` })
    return out
  } catch (e: any) { return `Could not fetch news: ${e?.message || String(e)}` }
}

// ══════════════════════════════════════════════════════════════════════════
// CDP CONNECTION
// ══════════════════════════════════════════════════════════════════════════
const CDP_ENDPOINT = 'http://localhost:9222'
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
].filter(Boolean)

function findBrowserPath(): string | null {
  for (const p of CHROME_PATHS) if (p && fs.existsSync(p)) return p
  return null
}

function isChromeDebugRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:9222/json/version', { timeout: 2000 }, (res) => { res.resume(); resolve(res.statusCode === 200) })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

async function launchChromeWithDebug(): Promise<void> {
  const browserPath = findBrowserPath()
  if (!browserPath) throw new Error('Chrome install nahi mila.')
  const debugProfileDir = path.join(process.env.LOCALAPPDATA || process.env.TEMP || '', 'JarvisCDPProfile')
  if (!fs.existsSync(debugProfileDir)) fs.mkdirSync(debugProfileDir, { recursive: true })

  const { spawn } = await import('node:child_process')
  const child = spawn(browserPath, ['--remote-debugging-port=9222', '--remote-allow-origins=*', '--user-data-dir=' + debugProfileDir, '--no-first-run'], { detached: true, stdio: 'ignore' })
  child.unref()

  const maxWait = 20000
  const startTime = Date.now()
  while (Date.now() - startTime < maxWait) {
    await new Promise((r) => setTimeout(r, 500))
    if (await isChromeDebugRunning()) return
  }
  throw new Error('Chrome start nahi ho raha.')
}

async function connectToExistingChrome(): Promise<any> {
  const { chromium } = await import('playwright')
  if (!(await isChromeDebugRunning())) await launchChromeWithDebug()
  return await chromium.connectOverCDP(CDP_ENDPOINT, { timeout: 15000 })
}

// ══════════════════════════════════════════════════════════════════════════
// TOOL 2: google_search
// ══════════════════════════════════════════════════════════════════════════
export const GOOGLE_SEARCH_TOOL = {
  name: 'google_search',
  description: 'Searches Google and returns web results.',
  parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, count: { type: 'NUMBER' } }, required: ['query'] },
}

export async function googleSearch(args: Record<string, any>): Promise<string> {
  const query = String(args?.query || '').trim()
  const count = Math.min(15, Math.max(1, Number(args?.count || 8)))
  let browser: any = null
  try {
    browser = await connectToExistingChrome()
    const context = browser.contexts()[0] || await browser.newContext()
    const page = await context.newPage()
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=pk&num=${count + 5}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    try { await page.waitForSelector('#search, #rso, #main', { timeout: 10000 }) } catch { }
    await page.waitForTimeout(2000)

    const results = await page.evaluate((max: number) => {
      const items: any[] = []
      document.querySelectorAll('#search h3, #rso h3, #main h3').forEach((h3: any) => {
        if (items.length >= max) return
        const title = h3.textContent?.trim() || ''
        let url = h3.closest('a')?.href || ''
        if (!url) {
          let parent = h3.parentElement
          for (let i = 0; i < 6 && parent; i++) {
            const link = parent.querySelector('a[href^="http"]')
            if (link && !link.href.includes('google.com/')) { url = link.href; break }
            parent = parent.parentElement
          }
        }
        if (!url || items.some((i) => i.url === url)) return
        items.push({ title, url })
      })
      return items
    }, count)
    await page.close()
    return `Results for "${query}":\n` + results.map((r, i) => `\n${i + 1}. ${r.title}\n   🔗 ${r.url}`).join('')
  } catch (e: any) { return `Search failed: ${e.message}` }
  finally { if (browser) try { await browser.close() } catch { } }
}

// ══════════════════════════════════════════════════════════════════════════
// ✅ TOOL 3: image_search
// ══════════════════════════════════════════════════════════════════════════
export const IMAGE_SEARCH_TOOL = {
  name: 'image_search',
  description: 'Searches Bing Images and returns FULL-RESOLUTION image URLs.',
  parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, count: { type: 'NUMBER' }, download: { type: 'BOOLEAN' }, filename: { type: 'STRING' } }, required: ['query'] },
}

export async function imageSearch(args: Record<string, any>): Promise<string> {
  const query = String(args?.query || '').trim()
  const count = Math.min(15, Math.max(1, Number(args?.count || 8)))
  const shouldDownload = Boolean(args?.download)
  const filename = String(args?.filename || '').trim()

  let browser: any = null
  try {
    browser = await connectToExistingChrome()
    const context = browser.contexts()[0] || await browser.newContext()
    const page = await context.newPage()

    await page.goto(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3000)

    const images = await page.evaluate((max: number) => {
      const items: Array<{ url: string }> = []
      const seen = new Set<string>()
      const anchors = Array.from(document.querySelectorAll('a.iusc')) as HTMLAnchorElement[]
      for (const a of anchors) {
        if (items.length >= max) break
        const mAttr = a.getAttribute('m')
        if (!mAttr) continue
        try {
          const data = JSON.parse(mAttr)
          const url = data.murl
          if (url && url.startsWith('http') && !seen.has(url)) {
            seen.add(url)
            items.push({ url })
          }
        } catch (e) { }
      }
      return items
    }, count)

    if (images.length === 0) { await page.close(); return `No images found.` }

    if (shouldDownload) {
      const targetUrl = images[0].url
      const downloadsDir = path.join(process.env.USERPROFILE || '', 'Downloads')
      let finalFilename = filename || `image_${Date.now()}.jpg`
      if (!finalFilename.includes('.')) finalFilename += '.jpg'

      try {
        const result = await page.evaluate(async (fileUrl: string) => {
          const res = await fetch(fileUrl, { headers: { 'Referer': 'https://www.bing.com/' } })
          if (!res.ok) return { ok: false, status: res.status }
          const blob = await res.blob()
          const reader = new FileReader()
          return await new Promise<any>((resolve) => {
            reader.onload = () => resolve({ ok: true, data: (reader.result as string).split(',')[1], type: blob.type })
            reader.readAsDataURL(blob)
          })
        }, targetUrl)

        if (result.ok && result.data) {
          const savePath = path.join(downloadsDir, finalFilename)
          fs.writeFileSync(savePath, Buffer.from(result.data, 'base64'))
          await page.close()
          emitDownloadProgress({
            id: `img_${Date.now()}`,
            state: 'complete',
            received: 100,
            total: 100,
            percent: 100,
            cancellable: false,
            path: finalFilename,
            title: 'Image download',
            type: 'file',
            timestamp: Date.now(),
          })
          return `✅ Image download ho gayi!\n📁 Save ki gayi: ${savePath}\n📄 Naam: ${finalFilename}\n🔗 Source: ${targetUrl}`
        }
      } catch (err) { }
      await page.close()
      return `Image mili lekin download fail ho gaya.`
    }

    await page.close()
    return `Image results for "${query}":\n` + images.map((img, i) => `\n${i + 1}. ${img.url}`).join('')
  } catch (e: any) { return `Image search failed: ${e.message}` }
  finally { if (browser) try { await browser.close() } catch { } }
}

// ... (aapke imports aur baqi code waisay hi rahenge)

// ══════════════════════════════════════════════════════════════════════════
// ✅ TOOL 4: youtube_search — Play Video & Playlist Support
// ══════════════════════════════════════════════════════════════════════════
export const YOUTUBE_SEARCH_TOOL = {
  name: 'youtube_search',
  description: 'Searches YouTube. If playVideo is true, it will play the first video in browser. If download is true, it will download.',
  parameters: {
    type: 'OBJECT',
    properties: {
      query: { type: 'STRING' },
      count: { type: 'NUMBER' },
      download: { type: 'BOOLEAN' },
      audioOnly: { type: 'BOOLEAN' },
      isPlaylist: { type: 'BOOLEAN' },
      playVideo: { type: 'BOOLEAN', description: 'Set to true if user wants to play the video immediately.' }
    },
    required: ['query']
  },
}

export async function youtubeSearch(args: Record<string, any>): Promise<string> {
  const query = String(args?.query || '').trim()
  const count = Math.min(15, Math.max(1, Number(args?.count || 8)))
  const shouldDownload = Boolean(args?.download)
  const audioOnly = Boolean(args?.audioOnly)
  const isPlaylist = Boolean(args?.isPlaylist)
  const playVideo = Boolean(args?.playVideo) // ✅ Naya

  let browser: any = null
  try {
    browser = await connectToExistingChrome()
    const context = browser.contexts()[0] || await browser.newContext()
    const page = await context.newPage()

    await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3000)

    const videos = await page.evaluate((max: number) => {
      const items: any[] = []
      const elements = document.querySelectorAll('ytd-video-renderer')
      for (const el of Array.from(elements)) {
        if (items.length >= max) break
        const titleEl = el.querySelector('#video-title')
        const linkEl = el.querySelector('a#thumbnail')
        if (titleEl && linkEl) {
          const title = titleEl.textContent?.trim() || ''
          const href = (linkEl as HTMLAnchorElement).href || ''
          if (title && href) items.push({ title, url: href })
        }
      }
      return items
    }, count)

    await page.close()

    if (videos.length === 0) return `YouTube par "${query}" ke liye koi video nahi mili.`

    // ✅ PLAY VIDEO LOGIC (Naya)
    if (playVideo) {
      const firstVideo = videos[0]
      let targetUrl = firstVideo.url
      if (targetUrl.includes('&')) targetUrl = targetUrl.split('&')[0]
      
      console.log(`[youtubeSearch] Playing video: ${targetUrl}`)
      
      // Browser mein video khol dein
      const playPage = await context.newPage()
      await playPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      
      // ✅ ZABARDAST FIX: Play button par click karein taake video chale
      try {
        await playPage.waitForTimeout(2000) // Page load hone dein
        
        // YouTube ka play button dhundhein
        const playButton = await playPage.$('button.ytp-large-play-button, .ytp-play-button')
        if (playButton) {
          await playButton.click()
          console.log('[youtubeSearch] ✅ Play button clicked')
        } else {
          // Agar button na mile to keyboard se 'k' dabayein (YouTube play/pause hotkey)
          await playPage.keyboard.press('k')
          console.log('[youtubeSearch] ✅ Pressed "k" to play')
        }
      } catch (e) {
        console.log('[youtubeSearch] ⚠️ Could not auto-play:', e)
      }
      
      return `✅ Video chala diya: ${firstVideo.title}\n🔗 ${targetUrl}\n\n(Video browser mein play ho raha hai. Koi aur tool call nahi karna.)`
    }

    // ✅ DOWNLOAD LOGIC
    if (shouldDownload) {
      let targetUrl = videos[0].url
      const targetTitle = videos[0].title
      
      if (targetUrl.includes('&')) targetUrl = targetUrl.split('&')[0]

      if (isPlaylist) {
        const downloadResult = await downloadMedia({ url: targetUrl, audioOnly, isPlaylist: true })
        return `✅ Playlist download request queue mein add ho gayi hai.\n${downloadResult}`
      }

      const downloadResult = await downloadMedia({ url: targetUrl, audioOnly })
      return `✅ Video download shuru ho gayi: ${targetTitle}\n${downloadResult}\n\n(Ab tumhe koi aur tool call nahi karna.)`
    }

    return `YouTube results for "${query}":\n` + videos.map((vid, i) => `\n${i + 1}. ${vid.title}\n   🔗 ${vid.url}`).join('')

  } catch (e: any) {
    return `YouTube search failed: ${e.message}`
  } finally {
    if (browser) try { await browser.close() } catch { }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ✅ TOOL 5: download_media
// ══════════════════════════════════════════════════════════════════════════
export const DOWNLOAD_MEDIA_TOOL = {
  name: 'download_media',
  description: 'Downloads video/audio from YouTube, Instagram, etc. using yt-dlp.',
  parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' } }, required: ['url'] },
}

export async function downloadMedia(args: Record<string, any>): Promise<string> {
  const url = String(args?.url || '').trim()
  const audioOnly = Boolean(args?.audioOnly)
  const isPlaylist = Boolean(args?.isPlaylist)
  
  if (!url) return 'No URL provided.'

  const downloadId = `dl_${Date.now()}`
  
  // ✅ Queue mein add karein
  downloadQueue.push({ id: downloadId, url, audioOnly, title: isPlaylist ? 'Playlist' : 'Video' })
  processDownloadQueue()
  
  return `✅ Download request queue mein add ho gayi hai. File Downloads folder mein save hogi.`
}

// ✅ Internal function jo asal download karta hai
async function executeDownload(downloadId: string, url: string, audioOnly: boolean, title: string): Promise<void> {
  const downloadsDir = path.join(process.env.USERPROFILE || '', 'Downloads')
  const projectDir = process.cwd()
  const ytdlpPath = path.join(projectDir, 'yt-dlp.exe')
  const denoPath = path.join(projectDir, 'deno.exe')
  const ffmpegPath = path.join(projectDir, 'ffmpeg.exe')

  try {
    console.log(`[executeDownload] Downloading: ${url}`)
    
    emitDownloadProgress({
      id: downloadId,
      state: 'downloading',
      received: 0,
      total: 100,
      percent: 0,
      cancellable: false,
      title,
      type: audioOnly ? 'audio' : 'video',
    })

    const { YtDlp } = await import('@abdullah2993/ytdlp-nodejs')
    const ytdlp = new YtDlp({ binaryPath: ytdlpPath, ffmpegPath: ffmpegPath })

    const format = audioOnly ? 'ba/b' : 'bv*+ba/b'

    const output = await ytdlp.downloadAsync(url, {
      // ✅ ZABARDAST FIX: Har file ka naam unique banayein
      output: path.join(downloadsDir, '%(title)s_[%(id)s]_%(epoch)s.%(ext)s'),
      format: format,
      extraArgs: [
        '--js-runtimes', `deno:${denoPath}`,
        '--extractor-args', 'youtube:player_client=tv,mweb,web',
        '--newline',
        '--progress',
        '--progress-template', '{"percent":%(progress._percent_str)s,"speed":%(progress.speed)s,"total":%(progress.total_bytes)s,"downloaded":%(progress.downloaded_bytes)s}',
        
        // ✅ AUDIO FIX: -x lazmi hai, aur force-overwrites bhi
        ...(audioOnly ? [
          '-x', 
          '--audio-format', 'mp3', 
          '--audio-quality', '0',
          '--force-overwrites'
        ] : []),
      ],
      onProgress: (progress: any) => {
        try {
          let data: any = {};
          if (typeof progress === 'string') {
            try { data = JSON.parse(progress); } catch { data = {}; }
          } else {
            data = progress || {};
          }

          const totalBytes = Number(data.total) || Number(data.total_bytes) || 0;
          const receivedBytes = Number(data.downloaded) || Number(data.downloaded_bytes) || 0;
          const speedBytes = Number(data.speed) || 0;

          let percent = 0;
          if (totalBytes > 0 && receivedBytes > 0) {
            percent = (receivedBytes / totalBytes) * 100;
          }

          const totalMB = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(1) : '?'
          const receivedMB = receivedBytes > 0 ? (receivedBytes / 1024 / 1024).toFixed(1) : '0.0'
          const speedMB = speedBytes > 0 ? (speedBytes / 1024 / 1024).toFixed(2) : null

          if (percent === 0 && !speedMB) return;

          emitDownloadProgress({
            id: downloadId,
            state: 'downloading',
            received: receivedBytes,
            total: totalBytes,
            percent: Math.round(percent),
            cancellable: false,
            totalMB,
            receivedMB,
            speedMB,
            title,
            type: audioOnly ? 'audio' : 'video',
          })
        } catch (error) {
          console.error('[executeDownload] Could not process download progress:', error)
        }
      },
    })

    const fileName = output ? path.basename(output) : 'File'
    
    emitDownloadProgress({
      id: downloadId,
      state: 'complete',
      received: 100,
      total: 100,
      percent: 100,
      cancellable: false,
      path: fileName,
      title,
      type: audioOnly ? 'audio' : 'video',
      timestamp: Date.now(),
    })

  } catch (e: any) {
    console.error('[executeDownload] Error:', e)
    emitDownloadProgress({
      id: downloadId,
      state: 'error',
      received: 0,
      total: 0,
      error: e.message?.slice(0, 100),
      title,
      type: audioOnly ? 'audio' : 'video',
    })
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ✅ TOOL 6: download_file
// ══════════════════════════════════════════════════════════════════════════
export const DOWNLOAD_FILE_TOOL = {
  name: 'download_file',
  description: 'Downloads a direct image/file URL. Optionally provide a custom filename.',
  parameters: { type: 'OBJECT', properties: { url: { type: 'STRING' }, filename: { type: 'STRING' } }, required: ['url'] },
}

export async function downloadFile(args: Record<string, any>): Promise<string> {
  const url = String(args?.url || '').trim()
  if (!url) return 'No URL provided.'
  
  let customFilename = String(args?.filename || '').trim()
  if (customFilename && !customFilename.includes('.')) customFilename += '.jpg'

  const downloadsDir = path.join(process.env.USERPROFILE || '', 'Downloads')
  let browser: any = null
  let downloadId: string | null = null
  
  try {
    browser = await connectToExistingChrome()
    const context = browser.contexts()[0] || await browser.newContext({ acceptDownloads: true })
    const page = await context.newPage()
    
    const isDirectImage = /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(url)
    let finalImageUrl = url

    if (!isDirectImage) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { })
      const foundImg = await page.evaluate(() => {
        const ogImg = document.querySelector('meta[property="og:image"]')
        if (ogImg && ogImg.getAttribute('content')) return ogImg.getAttribute('content')
        const imgs = Array.from(document.querySelectorAll('img')).map(img => img.src).filter(src => src.startsWith('http'))
        return imgs.length > 0 ? imgs[0] : null
      })
      if (foundImg) finalImageUrl = foundImg
    }

    const currentDownloadId = `file_${Date.now()}`
    downloadId = currentDownloadId
    const title = customFilename || 'File download'
    emitDownloadProgress({
      id: downloadId,
      state: 'downloading',
      received: 0,
      percent: 0,
      cancellable: false,
      title,
      type: 'file',
    })
    let lastReportedPercent = -5
    let lastReportedBytes = 0
    await page.exposeFunction('__jarvisReportDownloadProgress', (received: number, total: number) => {
      const percent = total > 0 ? Math.round((received / total) * 100) : undefined
      if (percent !== undefined && percent < lastReportedPercent + 5 && percent < 100) return
      if (percent === undefined && received - lastReportedBytes < 1024 * 1024) return
      if (percent !== undefined) lastReportedPercent = percent
      lastReportedBytes = received
      emitDownloadProgress({
        id: currentDownloadId,
        state: 'downloading',
        received,
        total,
        percent,
        cancellable: false,
        title,
        type: 'file',
      })
    })

    const result = await page.evaluate(async (fileUrl: string) => {
      const res = await fetch(fileUrl, { headers: { 'Referer': 'https://www.google.com/', 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) return { ok: false, status: res.status }
      const total = Number(res.headers.get('content-length')) || 0
      const chunks: BlobPart[] = []
      const stream = res.body?.getReader()
      if (stream) {
        let received = 0
        let done = false
        while (!done) {
          const chunk = await stream.read()
          done = chunk.done
          const value = chunk.value
          if (done || !value) continue
          chunks.push(value)
          received += value.byteLength
          await (window as Window & {
            __jarvisReportDownloadProgress: (received: number, total: number) => Promise<void>
          }).__jarvisReportDownloadProgress(received, total)
        }
      } else {
        chunks.push(await res.blob())
      }
      const blob = new Blob(chunks, { type: res.headers.get('content-type') || '' })
      const reader = new FileReader()
      return await new Promise<{ ok: boolean; status?: number; data?: string; type?: string }>((resolve) => {
        reader.onload = () => resolve({ ok: true, data: (reader.result as string).split(',')[1], type: blob.type })
        reader.readAsDataURL(blob)
      })
    }, finalImageUrl)
    
    if (result.ok && result.data) {
      const ext = result.type?.split('/')[1] || 'jpg'
      const finalFilename = customFilename || `image_${Date.now()}.${ext}`
      const savePath = path.join(downloadsDir, finalFilename)
      fs.writeFileSync(savePath, Buffer.from(result.data, 'base64'))
      await page.close()

      emitDownloadProgress({
        id: currentDownloadId,
        state: 'complete',
        received: 100,
        total: 100,
        percent: 100,
        cancellable: false,
        path: finalFilename,
        title: 'Image download',
        type: 'file',
        timestamp: Date.now(),
      })

      return `✅ File download ho gayi!\n📁 Save ki gayi: ${savePath}\n📄 Naam: ${finalFilename}`
    }
    await page.close()
    emitDownloadProgress({
      id: downloadId,
      state: 'error',
      received: 0,
      error: `HTTP ${result.status}`,
      title,
      type: 'file',
    })
    return `Failed: Status ${result.status}`
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[downloadFile] Download failed:', error)
    if (downloadId) {
      emitDownloadProgress({
        id: downloadId,
        state: 'error',
        received: 0,
        error: message,
        title: customFilename || 'File download',
        type: 'file',
      })
    }
    return `Download failed: ${message}`
  }
  finally { if (browser) try { await browser.close() } catch { } }
}

// ══════════════════════════════════════════════════════════════════════════
// TOOL 7: web_search
// ══════════════════════════════════════════════════════════════════════════
export const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description: 'For definitions and facts.',
  parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] },
}

export async function webSearch(args: Record<string, any>): Promise<string> {
  return googleSearch({ query: args?.query, count: 8 })
}

// ══════════════════════════════════════════════════════════════════════════
// ✅ TOOL 8: shopping_search — Daraz.pk (Playwright Scraping)
// ══════════════════════════════════════════════════════════════════════════
export const SHOPPING_SEARCH_TOOL = {
  name: 'shopping_search',
  description: 'Searches Daraz.pk for products and returns title, price, and link.',
  parameters: {
    type: 'OBJECT',
    properties: {
      query: { type: 'STRING', description: 'Product search query (e.g. "wireless mouse")' },
      count: { type: 'NUMBER', description: 'Number of products to return (default: 5, max: 10)' },
    },
    required: ['query'],
  },
}

export async function shoppingSearch(args: Record<string, any>): Promise<string> {
  const query = String(args?.query || '').trim()
  if (!query) return 'No search query provided.'
  const count = Math.min(10, Math.max(1, Number(args?.count || 5)))

  // ✅ Rate Limit: 1.5 second delay taake Daraz block na kare
  await new Promise(r => setTimeout(r, 1500))

  let browser: any = null
  try {
    browser = await connectToExistingChrome()
    const context = browser.contexts()[0] || await browser.newContext()
    const page = await context.newPage()

    console.log(`[shoppingSearch] Opening Daraz for: ${query}`)
    // Daraz search page open karein
    await page.goto(`https://www.daraz.pk/catalog/?q=${encodeURIComponent(query)}`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    })
    await page.waitForTimeout(4000) // Wait for products to load

    // ✅ Daraz ke naye layout se products scrape karein
    const products = await page.evaluate((max: number) => {
      const items: any[] = []
      
      // Daraz ke product cards ke selectors
      const cards = document.querySelectorAll('div[data-qa-locator="product-item"]')
      
      for (const card of Array.from(cards)) {
        if (items.length >= max) break
        const titleEl = card.querySelector('div[class*="title"], a[class*="title"], [class*="name"]')
        const priceEl = card.querySelector('span[class*="price"], [class*="price"]')
        const linkEl = card.querySelector('a[href*="/products/"]')
        
        if (titleEl && priceEl) {
          items.push({
            title: titleEl.textContent?.trim() || 'Unknown',
            price: priceEl.textContent?.trim() || 'N/A',
            link: (linkEl as HTMLAnchorElement)?.href || ''
          })
        }
      }
      return items
    }, count)

    await page.close()

    if (products.length > 0) {
      let out = `Products found on Daraz for "${query}":\n`
      products.forEach((p: any, i: number) => {
        out += `\n${i + 1}. ${p.title}`
        out += `\n   💰 Price: ${p.price}`
        if (p.link) out += `\n   🔗 Link: ${p.link}`
      })
      return out
    }

    return `Daraz par "${query}" ke liye koi product nahi mila.`

  } catch (e: any) {
    console.error('[shoppingSearch] Error:', e)
    return `Shopping search failed: ${e.message}`
  } finally {
    if (browser) try { await browser.close() } catch { }
  }
}
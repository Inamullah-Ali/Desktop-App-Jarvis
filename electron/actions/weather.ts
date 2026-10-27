import https from 'node:https'
import http from 'node:http'
import { loadMemory } from '../memory/memoryManager'

// ── Helper: HTTP GET ───────────────────────────────────────────────────────
function httpGet(url: string, timeoutMs: number = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve(data))
    })
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })
    req.on('error', (e) => reject(e))
  })
}

// ══════════════════════════════════════════════════════════════════════════
// TOOL: get_weather
// ══════════════════════════════════════════════════════════════════════════
export const GET_WEATHER_TOOL = {
  name: 'get_weather',
  description:
    "Gets the current weather for a city, or the user's own location. " +
    'Priority: (1) If user names a city, use it. ' +
    '(2) If memory has identity/city saved, use that. ' +
    '(3) Otherwise, auto-detect from IP. ' +
    'Use this whenever the user asks about weather, temperature, rain, or conditions.',
  parameters: {
    type: 'OBJECT',
    properties: {
      city: {
        type: 'STRING',
        description:
          'City name (e.g. "Pakpattan", "Lahore", "London"). ' +
          'Leave empty to use saved city from memory, or auto-detect.',
      },
      format: {
        type: 'STRING',
        description:
          "'short' for one-line summary (default), 'full' for detailed report.",
      },
    },
    required: [],
  },
}

// ── Handler ────────────────────────────────────────────────────────────────
export async function getWeather(args: Record<string, any>): Promise<string> {
  let city = String(args?.city || '').trim()
  const format = String(args?.format || 'short').toLowerCase().trim()
  let usedMemory = false

  // ✅ Priority 1: User ne city di
  // ✅ Priority 2: Memory se city uthayein
  if (!city) {
    try {
      const memory = loadMemory()
      const savedCity = memory.identity?.city?.value
      if (savedCity && typeof savedCity === 'string' && savedCity.trim()) {
        city = savedCity.trim()
        usedMemory = true
        console.log(`[getWeather] Using saved city from memory: ${city}`)
      }
    } catch (e) {
      console.log(`[getWeather] Memory read failed: ${e}`)
    }
  }

  // ✅ Priority 3: IP-based auto-detect (agar koi city nahi)
  const location = city ? encodeURIComponent(city) : ''
  if (!city) {
    console.log(`[getWeather] No city given — using IP-based auto-detect`)
  }

  try {
    if (format === 'full') {
      const url = `https://wttr.in/${location}?format=j1`
      console.log(`[getWeather] Fetching: ${url}`)

      const raw = await httpGet(url, 12000)
      const data = JSON.parse(raw)

      const current = data.current_condition?.[0]
      const area = data.nearest_area?.[0]
      const cityName = area?.areaName?.[0]?.value || city || 'your location'
      const country = area?.country?.[0]?.value || ''

      if (!current) {
        return `Could not read weather data for ${cityName}.`
      }

      const tempC = current.temp_C
      const feelsLike = current.FeelsLikeC
      const humidity = current.humidity
      const desc = current.weatherDesc?.[0]?.value || ''
      const windKmph = current.windspeedKmph
      const windDir = current.winddir16Point
      const pressure = current.pressure
      const visibility = current.visibility
      const uvIndex = current.uvIndex

      const today = data.weather?.[0]
      const maxC = today?.maxtempC || '—'
      const minC = today?.mintempC || '—'

      let out = `Weather in ${cityName}${country ? ', ' + country : ''}:\n`
      out += `  Condition:   ${desc}\n`
      out += `  Temperature: ${tempC}°C (feels like ${feelsLike}°C)\n`
      out += `  Today:       High ${maxC}°C / Low ${minC}°C\n`
      out += `  Humidity:    ${humidity}%\n`
      out += `  Wind:        ${windKmph} km/h ${windDir}\n`
      out += `  Pressure:    ${pressure} hPa\n`
      out += `  Visibility:  ${visibility} km\n`
      out += `  UV Index:    ${uvIndex}\n`

      if (usedMemory) {
        out += `\n(Used saved city "${city}" from memory)\n`
      }

      return out
    } else {
      const url = `https://wttr.in/${location}?format=%l:+%c+%t+(feels+like+%f),+humidity+%h,+wind+%w`
      console.log(`[getWeather] Fetching: ${url}`)

      const text = (await httpGet(url, 10000)).trim()
      if (!text) return 'Could not fetch weather data.'

      return usedMemory ? `${text}\n(Used saved city "${city}")` : text
    }
  } catch (e: any) {
    console.error('[getWeather] Error:', e)
    return `Could not fetch weather: ${e?.message || String(e)}`
  }
}
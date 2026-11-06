import { create } from 'zustand'
import { fetchOpenMeteoHourly } from '../api/openMeteo'
import { resampleTo15min } from '../lib/resample'
import { syntheticHourly } from '../lib/synthetic'
import type { HourlyWeather, WeatherSample, WeatherSource } from './types'

const CACHE_KEY = 'solar-twin:weather:v1'
const CACHE_TTL = 30 * 60_000

interface WeatherState {
  status: 'idle' | 'loading' | 'ready'
  source: WeatherSource | null
  samples: WeatherSample[]
  fetchedAt: number | null
  error: string | null
  load: (lat: number, lon: number, timeZone: string, opts?: { force?: boolean }) => Promise<void>
}

function readCache(): { at: number; hourly: HourlyWeather } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Date.now() - parsed.at < CACHE_TTL ? parsed : null
  } catch {
    return null
  }
}

function writeCache(hourly: HourlyWeather) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), hourly }))
  } catch {
    /* armazenamento indisponível: segue sem cache */
  }
}

let inflight: AbortController | null = null

export const useWeatherStore = create<WeatherState>((set) => ({
  status: 'idle',
  source: null,
  samples: [],
  fetchedAt: null,
  error: null,

  async load(lat, lon, timeZone, { force = false } = {}) {
    const cached = force ? null : readCache()
    if (cached) {
      set({ status: 'ready', source: 'cache', samples: resampleTo15min(cached.hourly, lat, lon), fetchedAt: cached.at, error: null })
      return
    }

    inflight?.abort()
    inflight = new AbortController()
    set({ status: 'loading', error: null })

    try {
      const hourly = await fetchOpenMeteoHourly(lat, lon, { signal: inflight.signal })
      writeCache(hourly)
      set({ status: 'ready', source: 'open-meteo', samples: resampleTo15min(hourly, lat, lon), fetchedAt: Date.now() })
    } catch (e) {
      if (inflight.signal.aborted) return
      // Degradação graciosa: o painel continua funcional com clima sintético
      const hourly = syntheticHourly(lat, lon, timeZone)
      set({
        status: 'ready',
        source: 'synthetic',
        samples: resampleTo15min(hourly, lat, lon),
        fetchedAt: Date.now(),
        error: e instanceof Error ? e.message : String(e),
      })
    }
  },
}))

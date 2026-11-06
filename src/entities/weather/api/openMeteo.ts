import { http } from '@/shared/api/http'
import type { HourlyWeather } from '../model/types'

const HOURLY_VARS = [
  'temperature_2m',
  'cloud_cover',
  'shortwave_radiation',
  'direct_normal_irradiance',
  'diffuse_radiation',
  'wind_speed_10m',
  'precipitation',
] as const

type OpenMeteoHourly = { time: number[] } & Record<(typeof HOURLY_VARS)[number], (number | null)[]>

interface OpenMeteoResponse {
  latitude: number
  longitude: number
  elevation: number
  hourly: OpenMeteoHourly
}

/**
 * Open-Meteo Forecast API (modelos + satélite). `past_days` traz o histórico recente
 * para comparar previsão física × geração medida ao longo da semana.
 * Docs: https://open-meteo.com/en/docs
 */
export async function fetchOpenMeteoHourly(
  latitude: number,
  longitude: number,
  { pastDays = 7, forecastDays = 2, signal }: { pastDays?: number; forecastDays?: number; signal?: AbortSignal } = {},
): Promise<HourlyWeather> {
  const { data } = await http.get<OpenMeteoResponse>('https://api.open-meteo.com/v1/forecast', {
    params: {
      latitude,
      longitude,
      hourly: HOURLY_VARS.join(','),
      timeformat: 'unixtime',
      timezone: 'America/Sao_Paulo',
      wind_speed_unit: 'ms',
      past_days: pastDays,
      forecast_days: forecastDays,
    },
    signal,
  })

  const h = data.hourly
  if (!h?.time?.length) throw new Error('Open-Meteo: resposta sem série horária')
  const num = (arr: (number | null)[], i: number) => arr[i] ?? 0

  return {
    t: h.time.map((s) => s * 1000),
    ghi: h.time.map((_, i) => num(h.shortwave_radiation, i)),
    dni: h.time.map((_, i) => num(h.direct_normal_irradiance, i)),
    dhi: h.time.map((_, i) => num(h.diffuse_radiation, i)),
    tempC: h.time.map((_, i) => num(h.temperature_2m, i)),
    cloudCover: h.time.map((_, i) => num(h.cloud_cover, i)),
    windMs: h.time.map((_, i) => num(h.wind_speed_10m, i)),
    precipMm: h.time.map((_, i) => num(h.precipitation, i)),
  }
}

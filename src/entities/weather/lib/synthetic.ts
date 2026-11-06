import { clearSkyGhi, erbsDecomposition, extraterrestrialIrradiance, sunPosition } from '@/shared/lib/solar'
import { DAY, HOUR, seededRandom, startOfLocalDay } from '@/shared/lib/time'
import type { HourlyWeather } from '../model/types'

/**
 * Clima sintético determinístico (fallback offline / limite de requisições da API).
 * Céu claro de Haurwitz atenuado pela nebulosidade (Kasten–Czeplak) e ciclo térmico
 * diário típico de novembro na Zona da Mata mineira.
 */
export function syntheticHourly(
  latitude: number,
  longitude: number,
  timeZone: string,
  { pastDays = 7, forecastDays = 2, now = Date.now() } = {},
): HourlyWeather {
  const start = startOfLocalDay(now, timeZone) - pastDays * DAY
  const hours = (pastDays + forecastDays) * 24
  const out: HourlyWeather = { t: [], ghi: [], dni: [], dhi: [], tempC: [], cloudCover: [], windMs: [], precipMm: [] }

  for (let h = 1; h <= hours; h++) {
    const t = start + h * HOUR
    const dayIdx = Math.floor((t - start - 1) / DAY)
    const dayRand = seededRandom(Math.floor((start + dayIdx * DAY) / DAY))
    const dayCloudiness = 0.15 + 0.6 * dayRand() // nebulosidade média do dia
    const afternoonStorm = dayRand() > 0.55 // pancada de chuva de verão à tarde
    const hourRand = seededRandom(Math.floor(t / HOUR))
    const localH = ((t - start) / HOUR) % 24

    let cloud = dayCloudiness + (hourRand() - 0.5) * 0.35
    if (afternoonStorm && localH >= 14 && localH <= 18) cloud += 0.4
    cloud = Math.max(0, Math.min(1, cloud))

    const mid = new Date(t - HOUR / 2)
    const sun = sunPosition(mid, latitude, longitude)
    const ghi = clearSkyGhi(sun.zenith) * (1 - 0.75 * cloud ** 3.4)
    const comps = erbsDecomposition(ghi, sun.zenith, extraterrestrialIrradiance(mid))

    const diurnal = Math.sin(((localH - 9) / 24) * 2 * Math.PI)
    out.t.push(t)
    out.ghi.push(ghi)
    out.dni.push(comps.dni)
    out.dhi.push(comps.dhi)
    out.tempC.push(22 + 5.5 * diurnal - 3 * cloud)
    out.cloudCover.push(cloud * 100)
    out.windMs.push(1 + 2.2 * hourRand())
    out.precipMm.push(afternoonStorm && localH >= 15 && localH <= 17 ? 2 + 6 * hourRand() : 0)
  }
  return out
}

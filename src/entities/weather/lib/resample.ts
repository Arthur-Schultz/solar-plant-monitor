import { clearSkyGhi, sunPosition } from '@/shared/lib/solar'
import { HOUR, MINUTE } from '@/shared/lib/time'
import type { HourlyWeather, WeatherSample } from '../model/types'

const STEP = 15 * MINUTE

/**
 * Converte a série horária (médias da hora anterior) em amostras instantâneas de 15 min.
 *
 * Interpolar GHI diretamente achata o nascer/pôr do sol e cria energia antes do Sol nascer.
 * Por isso interpolamos o ÍNDICE DE CÉU CLARO (GHI / GHI_céu_claro) e a fração difusa, e
 * reaplicamos sobre o céu claro do instante — a curva em sino fica fisicamente coerente.
 */
export function resampleTo15min(h: HourlyWeather, latitude: number, longitude: number): WeatherSample[] {
  if (h.t.length < 2) return []

  // Centro de cada intervalo horário
  const centers = h.t.map((t) => t - HOUR / 2)
  const clearIdx = centers.map((t, i) => {
    const cs = clearSkyGhi(sunPosition(new Date(t), latitude, longitude).zenith)
    return cs > 20 ? Math.min(1.25, h.ghi[i] / cs) : NaN
  })
  const diffuseFrac = h.ghi.map((g, i) => (g > 5 ? Math.min(1, h.dhi[i] / g) : NaN))

  const fillNaN = (arr: number[], fallback: number) => {
    // Propaga o vizinho válido mais próximo para as bordas do dia
    const out = [...arr]
    let last = fallback
    for (let i = 0; i < out.length; i++) {
      if (Number.isNaN(out[i])) out[i] = last
      else last = out[i]
    }
    return out
  }
  const kc = fillNaN(clearIdx, 0.7)
  const kd = fillNaN(diffuseFrac, 0.3)

  const lerpAt = (arr: number[], t: number) => {
    const x = (t - centers[0]) / HOUR
    const i = Math.max(0, Math.min(arr.length - 2, Math.floor(x)))
    const f = Math.max(0, Math.min(1, x - i))
    return arr[i] * (1 - f) + arr[i + 1] * f
  }

  const samples: WeatherSample[] = []
  const first = Math.ceil(h.t[0] / STEP) * STEP
  const last = h.t[h.t.length - 1]
  for (let t = first; t <= last; t += STEP) {
    const sun = sunPosition(new Date(t), latitude, longitude)
    const cs = clearSkyGhi(sun.zenith)
    const ghi = Math.max(0, cs * lerpAt(kc, t))
    const dhi = ghi * Math.max(0, Math.min(1, lerpAt(kd, t)))
    const cosZ = Math.cos((sun.zenith * Math.PI) / 180)
    const dni = cosZ > 0.05 ? Math.max(0, (ghi - dhi) / cosZ) : 0
    const hourIdx = Math.max(0, Math.min(h.t.length - 1, Math.ceil((t - h.t[0]) / HOUR)))

    samples.push({
      t,
      ghi,
      dni: Math.min(dni, 1100),
      dhi,
      tempC: lerpAt(h.tempC, t),
      cloudCover: lerpAt(h.cloudCover, t),
      windMs: lerpAt(h.windMs, t),
      precipMm: h.precipMm[hourIdx] / 4,
    })
  }
  return samples
}

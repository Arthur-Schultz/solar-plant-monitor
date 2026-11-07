import { computeExpected, type ExpectedSample, type PlantConfig } from '@/entities/plant'
import {
  DEFAULT_SIMULATION,
  faultMagnitude,
  SimulatedTelemetrySource,
  type InverterEvent,
  type SimulationOptions,
  type TelemetrySample,
} from '@/entities/telemetry'
import type { WeatherSample } from '@/entities/weather'
import { DAY, startOfLocalDay } from '@/shared/lib/time'

export interface RainInfo {
  /** Chuva observada por dia local (mm): Open-Meteo até agora + eventos simulados */
  byDay: Map<number, number>
  /** Chuva prevista daqui para frente, por dia (mm) */
  forecast: { day: number; mm: number }[]
  /** Intensidade de chuva no instante atual (mm/h) */
  nowMmPerHour: number
}

export interface PipelineResult {
  expected: ExpectedSample[]
  measured: TelemetrySample[]
  events: InverterEvent[]
  rain: RainInfo
}

export function rainInfo(weather: WeatherSample[], timeZone: string, now: number, simulation: SimulationOptions): RainInfo {
  const byDay = new Map<number, number>()
  const future = new Map<number, number>()
  for (const s of weather) {
    const d = startOfLocalDay(s.t, timeZone)
    const target = s.t <= now ? byDay : future
    target.set(d, (target.get(d) ?? 0) + s.precipMm)
  }
  const today = startOfLocalDay(now, timeZone)
  let manualNow = 0
  for (const f of simulation.faults.filter((x) => x.kind === 'heavy-rain')) {
    const day = today - f.sinceDaysAgo * DAY
    const mm = faultMagnitude('heavy-rain', f.severity).value
    byDay.set(day, (byDay.get(day) ?? 0) + mm)
    if (f.sinceDaysAgo === 0) manualNow = Math.max(manualNow, mm / 3)
  }
  const current = weather.reduce<WeatherSample | null>((best, s) => (Math.abs(s.t - now) < Math.abs((best?.t ?? Infinity) - now) ? s : best), null)
  return {
    byDay,
    forecast: [...future.entries()].sort(([a], [b]) => a - b).map(([day, mm]) => ({ day, mm })),
    nowMmPerHour: Math.max(manualNow, (current?.precipMm ?? 0) * 4),
  }
}

/**
 * Pipeline completo: clima → modelo físico (usina limpa) → fonte de telemetria.
 * Em produção, a segunda etapa trocaria SimulatedTelemetrySource por um coletor real.
 */
export async function runPipeline(
  plant: PlantConfig,
  weather: WeatherSample[],
  tiltDeg: number,
  now: number,
  simulation: SimulationOptions = DEFAULT_SIMULATION,
): Promise<PipelineResult> {
  const today = startOfLocalDay(now, plant.timezone)
  const window = weather.filter((w) => w.t >= today - 7 * DAY && w.t < today + DAY)
  const expected = computeExpected(plant, window, { tiltDeg })

  const rain = rainInfo(weather.filter((w) => w.t >= today - 7 * DAY && w.t < today + 2 * DAY), plant.timezone, now, simulation)
  const source = new SimulatedTelemetrySource(plant, expected, { ...simulation, rainByDay: rain.byDay }, now)
  const from = today - 7 * DAY
  const [measured, events] = await Promise.all([source.getSeries(from, now), source.getEvents(from, now)])
  return { expected, measured, events, rain }
}

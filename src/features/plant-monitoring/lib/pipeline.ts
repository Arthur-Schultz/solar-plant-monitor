import { computeExpected, type ExpectedSample, type PlantConfig } from '@/entities/plant'
import { SimulatedTelemetrySource, type InverterEvent, type SimulationScenario, type TelemetrySample, DEMO_SCENARIO } from '@/entities/telemetry'
import type { WeatherSample } from '@/entities/weather'
import { DAY, startOfLocalDay } from '@/shared/lib/time'

export interface PipelineResult {
  expected: ExpectedSample[]
  measured: TelemetrySample[]
  events: InverterEvent[]
}

export function dailyRain(samples: WeatherSample[], timeZone: string): Map<number, number> {
  const rain = new Map<number, number>()
  for (const s of samples) {
    const d = startOfLocalDay(s.t, timeZone)
    rain.set(d, (rain.get(d) ?? 0) + s.precipMm)
  }
  return rain
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
  scenario: SimulationScenario = DEMO_SCENARIO,
): Promise<PipelineResult> {
  const today = startOfLocalDay(now, plant.timezone)
  const window = weather.filter((w) => w.t >= today - 7 * DAY && w.t < today + DAY)
  const expected = computeExpected(plant, window, { tiltDeg })

  const source = new SimulatedTelemetrySource(plant, expected, dailyRain(window, plant.timezone), scenario, now)
  const from = today - 7 * DAY
  const [measured, events] = await Promise.all([source.getSeries(from, now), source.getEvents(from, now)])
  return { expected, measured, events }
}

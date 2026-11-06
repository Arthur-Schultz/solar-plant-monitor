import { acPower, type InverterSpec } from '@/shared/lib/solar'
import { DAY, HOUR, MINUTE, seededRandom, startOfLocalDay } from '@/shared/lib/time'
import type { InverterEvent, TelemetrySample, TelemetrySource } from '../model/types'

/** Referência física por instante (tipagem estrutural, vinda do modelo da usina). */
export interface ReferencePoint {
  t: number
  cellC: number
  ambientC: number
  strings: { stringId: string; dcW: number }[]
}

export interface SimulatedPlantShape {
  timezone: string
  strings: { id: string; inverterId: string; modules: number }[]
  inverters: (InverterSpec & { id: string })[]
}

/**
 * Cenário de demonstração — falhas reais e comuns em usinas rurais, injetadas de propósito
 * para que os diagnósticos tenham o que encontrar. Os diagnósticos NÃO leem estes valores:
 * eles inferem tudo a partir da telemetria, como fariam com uma usina real.
 */
export interface SimulationScenario {
  /** Dias desde a última limpeza (relativo a hoje) */
  daysSinceCleaning: number
  /** Acúmulo de sujeira por dia seco (fração) — estrada de terra + curral próximos */
  soilingRatePerDay: number
  /** Chuva diária (mm) que lava parte da sujeira, e a fração removida */
  rainWashMm: number
  rainWashFraction: number
  /** String degradada, perda relativa e há quantos dias começou */
  degradedString: { id: string; loss: number; sinceDaysAgo: number } | null
  /** Desarme de inversor (ex.: sobretensão na rede rural) */
  inverterTrip: { inverterId: string; daysAgo: number; startHourLocal: number; durationMin: number } | null
  /** Ruído de medição (desvio padrão relativo) */
  noise: number
}

export const DEMO_SCENARIO: SimulationScenario = {
  daysSinceCleaning: 34,
  soilingRatePerDay: 0.0036,
  rainWashMm: 12,
  rainWashFraction: 0.35,
  degradedString: { id: 'B3', loss: 0.13, sinceDaysAgo: 4 },
  inverterTrip: { inverterId: 'INV-B', daysAgo: 3, startHourLocal: 13.25, durationMin: 105 },
  noise: 0.012,
}

const VMP_PER_MODULE = 34.6 // V @ STC
const BETA_VMP = -0.0029 // 1/°C

export class SimulatedTelemetrySource implements TelemetrySource {
  readonly kind = 'simulated' as const
  private readonly samples: TelemetrySample[]
  private readonly events: InverterEvent[]

  private readonly plant: SimulatedPlantShape
  private readonly scenario: SimulationScenario
  private readonly now: number

  constructor(
    plant: SimulatedPlantShape,
    reference: ReferencePoint[],
    dailyRainMm: Map<number, number>,
    scenario: SimulationScenario = DEMO_SCENARIO,
    now: number = Date.now(),
  ) {
    this.plant = plant
    this.scenario = scenario
    this.now = now
    this.events = this.buildEvents()
    this.samples = this.simulate(reference, dailyRainMm)
  }

  async getSeries(from: number, to: number) {
    return this.samples.filter((s) => s.t >= from && s.t <= to)
  }

  async getEvents(from: number, to: number) {
    return this.events.filter((e) => e.t >= from && e.t <= to)
  }

  /** Sujeira acumulada no instante t, considerando chuvas que lavam os módulos. */
  private soilingAt(t: number, dailyRainMm: Map<number, number>): number {
    const tz = this.plant.timezone
    const today = startOfLocalDay(this.now, tz)
    const cleanedAt = today - this.scenario.daysSinceCleaning * DAY
    if (t < cleanedAt) return 0
    let soiling = 0
    for (let d = cleanedAt; d <= startOfLocalDay(t, tz); d += DAY) {
      soiling += this.scenario.soilingRatePerDay
      const rain = dailyRainMm.get(d) ?? 0
      if (rain >= this.scenario.rainWashMm) soiling *= 1 - this.scenario.rainWashFraction
    }
    return Math.min(0.25, soiling)
  }

  private tripWindow(): [number, number] | null {
    const trip = this.scenario.inverterTrip
    if (!trip) return null
    const start = startOfLocalDay(this.now, this.plant.timezone) - trip.daysAgo * DAY + trip.startHourLocal * HOUR
    return [start, start + trip.durationMin * MINUTE]
  }

  private buildEvents(): InverterEvent[] {
    const win = this.tripWindow()
    const trip = this.scenario.inverterTrip
    if (!win || !trip) return []
    return [
      { t: win[0], inverterId: trip.inverterId, code: 'F-021', severity: 'critical', messageKey: 'events.gridOvervoltage', durationMin: trip.durationMin },
      { t: win[1], inverterId: trip.inverterId, code: 'I-001', severity: 'info', messageKey: 'events.autoReconnect' },
    ]
  }

  private simulate(reference: ReferencePoint[], dailyRainMm: Map<number, number>): TelemetrySample[] {
    const tz = this.plant.timezone
    const trip = this.tripWindow()
    const deg = this.scenario.degradedString
    const degSince = deg ? startOfLocalDay(this.now, tz) - deg.sinceDaysAgo * DAY + 10 * HOUR : Infinity

    return reference
      .filter((r) => r.t <= this.now)
      .map((r) => {
        const rand = seededRandom(Math.floor(r.t / MINUTE))
        const gauss = () => (rand() + rand() + rand() - 1.5) * 0.8 // ~N(0, 0.5)
        const soiling = this.soilingAt(r.t, dailyRainMm)

        const strings: TelemetrySample['strings'] = {}
        for (const ref of r.strings) {
          const cfg = this.plant.strings.find((s) => s.id === ref.stringId)!
          let p = ref.dcW * (1 - soiling)
          if (deg && ref.stringId === deg.id && r.t >= degSince) p *= 1 - deg.loss
          p = Math.max(0, p * (1 + gauss() * this.scenario.noise * 2))
          const tripped = trip && cfg.inverterId === this.scenario.inverterTrip!.inverterId && r.t >= trip[0] && r.t < trip[1]
          if (tripped) p = 0
          const v = p > 1 ? cfg.modules * VMP_PER_MODULE * (1 + BETA_VMP * (r.cellC - 25)) : 0
          strings[ref.stringId] = { dcW: p, voltageV: v, currentA: v > 0 ? p / v : 0 }
        }

        const inverters: TelemetrySample['inverters'] = {}
        for (const inv of this.plant.inverters) {
          const dcW = this.plant.strings
            .filter((s) => s.inverterId === inv.id)
            .reduce((a, s) => a + (strings[s.id]?.dcW ?? 0), 0)
          const tripped = !!trip && inv.id === this.scenario.inverterTrip!.inverterId && r.t >= trip[0] && r.t < trip[1]
          const { acW } = acPower(dcW, inv)
          inverters[inv.id] = {
            status: tripped ? 'fault' : acW > 50 ? 'producing' : 'standby',
            acW: tripped ? 0 : acW,
            dcW,
            heatsinkC: r.ambientC + 4 + (acW / inv.pacMaxW) * 22,
          }
        }
        return { t: r.t, strings, inverters }
      })
  }
}

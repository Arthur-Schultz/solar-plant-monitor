import { acPower, type InverterSpec } from '@/shared/lib/solar'
import { DAY, HOUR as HOUR_MS, MINUTE, localHour, seededRandom, startOfLocalDay } from '@/shared/lib/time'
import { DEMO_FAULTS, faultMagnitude, rainWashFraction, type FaultInjection } from '../model/faults'
import type { InverterEvent, TelemetrySample, TelemetrySource } from '../model/types'

/** Referência física por instante (tipagem estrutural, vinda do modelo da usina). */
export interface ReferencePoint {
  t: number
  cellC: number
  ambientC: number
  sunElevation: number
  strings: { stringId: string; dcW: number }[]
}

export interface SimulatedPlantShape {
  timezone: string
  strings: { id: string; inverterId: string; modules: number }[]
  inverters: (InverterSpec & { id: string })[]
}

export interface SimulationOptions {
  faults: FaultInjection[]
  /** Ruído de medição (desvio padrão relativo) */
  noise: number
  /** Chuva observada por dia local (mm) — lava parte da sujeira por volta das 15h */
  rainByDay?: Map<number, number>
}

export const DEFAULT_SIMULATION: SimulationOptions = { faults: DEMO_FAULTS, noise: 0.012 }

const VMP_PER_MODULE = 34.6 // V @ STC
const BETA_VMP = -0.0029 // 1/°C
const TRIP_DURATION = 30 * MINUTE
const TRIP_COOLDOWN = 45 * MINUTE

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * Gera telemetria a partir do modelo físico + falhas injetadas. Cada falha reproduz a
 * ASSINATURA real do problema no campo, não só uma porcentagem fixa:
 * sombra de vegetação só de manhã/tarde, conector frouxo intermitente, sobretensão
 * desarmando no pico, PID afetando o inversor inteiro, string curta com tensão menor...
 */
export class SimulatedTelemetrySource implements TelemetrySource {
  readonly kind = 'simulated' as const
  private readonly samples: TelemetrySample[]
  private readonly events: InverterEvent[] = []
  private readonly plant: SimulatedPlantShape
  private readonly options: SimulationOptions
  private readonly now: number
  private readonly today: number

  constructor(
    plant: SimulatedPlantShape,
    reference: ReferencePoint[],
    options: SimulationOptions = DEFAULT_SIMULATION,
    now: number = Date.now(),
  ) {
    this.plant = plant
    this.options = options
    this.now = now
    this.today = startOfLocalDay(now, plant.timezone)
    this.samples = this.simulate(reference)
  }

  async getSeries(from: number, to: number) {
    return this.samples.filter((s) => s.t >= from && s.t <= to)
  }

  async getEvents(from: number, to: number) {
    return this.events.filter((e) => e.t >= from && e.t <= to)
  }

  private start(f: FaultInjection) {
    return this.today - f.sinceDaysAgo * DAY
  }

  private active(f: FaultInjection, t: number) {
    return t >= this.start(f)
  }

  private rainOn(day: number) {
    return this.options.rainByDay?.get(day) ?? 0
  }

  /** Produto dos fatores de lavagem das chuvas entre `from` e `t` (lavagem às 15h). */
  private washProduct(from: number, t: number, strength = 1): number {
    let k = 1
    for (let d = startOfLocalDay(from, this.plant.timezone); d <= t; d += DAY) {
      const washT = d + 15 * HOUR_MS
      if (washT >= from && washT <= t) k *= 1 - strength * rainWashFraction(this.rainOn(d))
    }
    return k
  }

  /**
   * Sujeira acumulada (%): cresce a uma taxa constante (calibrada para atingir a intensidade
   * escolhida hoje se não chover) e cada chuva lava uma fração do que estava acumulado.
   */
  private soilingLevel(f: FaultInjection, maxPct: number, t: number): number {
    const start = this.start(f)
    const rate = maxPct / Math.max(DAY, this.now - start)
    let level = 0
    let cursor = start
    for (let d = startOfLocalDay(start, this.plant.timezone); d <= t; d += DAY) {
      const washT = d + 15 * HOUR_MS
      if (washT > cursor && washT <= t && this.rainOn(d) >= 5) {
        level += rate * (washT - cursor)
        level *= 1 - rainWashFraction(this.rainOn(d))
        cursor = washT
      }
    }
    return level + rate * Math.max(0, t - cursor)
  }

  /** Fator multiplicativo de uma falha sobre a potência CC de uma string (1 = sem efeito). */
  private stringFactor(f: FaultInjection, stringId: string, inverterId: string, r: ReferencePoint, rand: () => number, refMaxW: number, refW: number): number {
    if (!this.active(f, r.t)) return 1
    const onString = f.target === stringId
    const onInverter = f.target === inverterId
    const m = faultMagnitude(f.kind, f.severity).value
    switch (f.kind) {
      case 'soiling-uniform':
        return 1 - this.soilingLevel(f, m, r.t) / 100
      case 'aging':
        return 1 - (0.02 + 0.005 * (m - 1)) // LID no 1º ano + 0,5 %/ano
      case 'soiling-localized':
        // Fezes de pássaro grudam: a chuva lava só metade do que lavaria de poeira
        return onString ? 1 - (m / 100) * this.washProduct(this.start(f), r.t, 0.5) : 1
      case 'hotspot':
        return onString ? 1 - m / 100 : 1
      case 'vegetation-shading':
        // Capim/arbusto à frente da mesa: só sombreia com Sol baixo (manhã e fim de tarde)
        return onString ? 1 - 0.75 * (1 - smoothstep(m * 0.6, m, r.sunElevation)) : 1
      case 'object-shading': {
        // Árvore/poste a oeste: sombra no meio da tarde
        if (!onString) return 1
        const h = localHour(r.t, this.plant.timezone)
        const w = smoothstep(13.5, 14.25, h) * (1 - smoothstep(15.5, 16.25, h))
        return 1 - (m / 100) * w
      }
      case 'loose-connector': {
        // Contato ruim: perda resistiva + quedas intermitentes, piores com corrente alta
        if (!onString) return 1
        const load = refMaxW > 0 ? refW / refMaxW : 0
        return rand() < (m / 100) * load ? 0 : 0.97
      }
      case 'open-string':
        return onString ? 0 : 1
      case 'pid': {
        // PID evolui ao longo dos dias e atinge todas as strings do inversor
        if (!onInverter) return 1
        const span = Math.max(DAY, this.now - this.start(f))
        return 1 - (m / 100) * (0.5 + 0.5 * Math.min(1, (r.t - this.start(f)) / span))
      }
      case 'string-short': {
        // String montada com módulos a menos
        if (!onString) return 1
        const cfg = this.plant.strings.find((s) => s.id === stringId)!
        return (cfg.modules - m) / cfg.modules
      }
      default:
        return 1
    }
  }

  private simulate(reference: ReferencePoint[]): TelemetrySample[] {
    const { faults, noise } = this.options
    const tz = this.plant.timezone
    const refMax = new Map<string, number>()
    for (const r of reference) for (const s of r.strings) refMax.set(s.stringId, Math.max(refMax.get(s.stringId) ?? 0, s.dcW))

    const tripUntil = new Map<string, number>()
    const cooldownUntil = new Map<string, number>()
    const deratingLogged = new Set<string>()
    const offlineLogged = new Set<string>()

    return reference
      .filter((r) => r.t <= this.now)
      .map((r) => {
        const rand = seededRandom(Math.floor(r.t / MINUTE))
        const gauss = () => (rand() + rand() + rand() - 1.5) * 0.8

        const strings: TelemetrySample['strings'] = {}
        for (const ref of r.strings) {
          const cfg = this.plant.strings.find((s) => s.id === ref.stringId)!
          let factor = 1
          const sRand = seededRandom(Math.floor(r.t / MINUTE) * 31 + cfg.id.charCodeAt(0) * 7 + cfg.id.charCodeAt(1))
          for (const f of faults) factor *= this.stringFactor(f, cfg.id, cfg.inverterId, r, sRand, refMax.get(cfg.id) ?? 0, ref.dcW)
          const p = Math.max(0, ref.dcW * factor * (1 + gauss() * noise * 2))

          let modules = cfg.modules
          const short = faults.find((f) => f.kind === 'string-short' && f.target === cfg.id && this.active(f, r.t))
          if (short) modules -= faultMagnitude('string-short', short.severity).value
          const pidOnInv = faults.find((f) => f.kind === 'pid' && f.target === cfg.inverterId && this.active(f, r.t))
          const vScale = pidOnInv ? 0.97 : 1
          const v = p > 1 ? modules * VMP_PER_MODULE * (1 + BETA_VMP * (r.cellC - 25)) * vScale : 0
          strings[cfg.id] = { dcW: p, voltageV: v, currentA: v > 0 ? p / v : 0 }
        }

        const inverters: TelemetrySample['inverters'] = {}
        for (const inv of this.plant.inverters) {
          const dcW = this.plant.strings.filter((s) => s.inverterId === inv.id).reduce((a, s) => a + (strings[s.id]?.dcW ?? 0), 0)
          let { acW } = acPower(dcW, inv)
          let status: TelemetrySample['inverters'][string]['status'] = acW > 50 ? 'producing' : 'standby'
          const heatsinkC = r.ambientC + 4 + (acW / inv.pacMaxW) * 22

          const offline = faults.find((f) => f.kind === 'inverter-offline' && f.target === inv.id && this.active(f, r.t))
          if (offline) {
            if (!offlineLogged.has(inv.id)) {
              offlineLogged.add(inv.id)
              this.events.push({ t: Math.max(this.start(offline), r.t), inverterId: inv.id, code: 'F-099', severity: 'critical', messageKey: 'events.offline' })
            }
            inverters[inv.id] = { status: 'offline', acW: 0, dcW: 0, heatsinkC: r.ambientC }
            for (const s of this.plant.strings.filter((x) => x.inverterId === inv.id)) strings[s.id] = { dcW: 0, voltageV: strings[s.id].voltageV, currentA: 0 }
            continue
          }

          const derating = faults.find((f) => f.kind === 'inverter-derating' && f.target === inv.id && this.active(f, r.t))
          if (derating) {
            const cap = (faultMagnitude('inverter-derating', derating.severity).value / 100) * inv.pacMaxW
            if (acW > cap) {
              acW = cap
              const dayKey = `${inv.id}-${startOfLocalDay(r.t, tz)}`
              if (!deratingLogged.has(dayKey)) {
                deratingLogged.add(dayKey)
                this.events.push({ t: r.t, inverterId: inv.id, code: 'W-110', severity: 'warning', messageKey: 'events.derating' })
              }
            }
          }

          const grid = faults.find((f) => f.kind === 'grid-overvoltage' && f.target === inv.id && this.active(f, r.t))
          const until = tripUntil.get(inv.id) ?? 0
          if (r.t < until) {
            acW = 0
            status = 'fault'
          } else if (grid && r.t >= (cooldownUntil.get(inv.id) ?? 0)) {
            const threshold = (faultMagnitude('grid-overvoltage', grid.severity).value / 100) * inv.pacMaxW
            if (acW > threshold) {
              tripUntil.set(inv.id, r.t + TRIP_DURATION)
              cooldownUntil.set(inv.id, r.t + TRIP_DURATION + TRIP_COOLDOWN)
              this.events.push({ t: r.t, inverterId: inv.id, code: 'F-021', severity: 'critical', messageKey: 'events.gridOvervoltage', durationMin: TRIP_DURATION / MINUTE })
              this.events.push({ t: r.t + TRIP_DURATION, inverterId: inv.id, code: 'I-001', severity: 'info', messageKey: 'events.autoReconnect' })
              acW = 0
              status = 'fault'
            }
          }

          if (status === 'fault') {
            // Inversor desconectado: as strings ficam em circuito aberto (tensão sem corrente)
            for (const s of this.plant.strings.filter((x) => x.inverterId === inv.id)) strings[s.id] = { dcW: 0, voltageV: strings[s.id].voltageV, currentA: 0 }
          }

          inverters[inv.id] = {
            status,
            acW,
            dcW: status === 'fault' ? 0 : dcW,
            heatsinkC: derating ? heatsinkC + 12 : heatsinkC,
          }
        }
        return { t: r.t, strings, inverters }
      })
  }
}

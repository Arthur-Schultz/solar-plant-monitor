import { effectiveValuePerKwh, type ExpectedSample, type PlantConfig } from '@/entities/plant'
import type { InverterEvent, TelemetrySample } from '@/entities/telemetry'
import { DAY, HOUR, MINUTE, localHour, startOfLocalDay } from '@/shared/lib/time'
import type {
  DailyPerformance,
  Diagnostic,
  InverterCause,
  InverterHealth,
  Severity,
  StringCause,
  StringHealth,
} from '../model/types'

const STEP_H = 0.25 // amostras de 15 min → 0,25 h

export const median = (xs: number[]) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Quantil por interpolação linear (q entre 0 e 1). */
export const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const pos = (s.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

function pair(expected: ExpectedSample[], measured: TelemetrySample[]) {
  const byT = new Map(measured.map((m) => [m.t, m]))
  return expected
    .map((e) => ({ e, m: byT.get(e.t) }))
    .filter((p): p is { e: ExpectedSample; m: TelemetrySample } => !!p.m)
}

const producing = (m: TelemetrySample, inverterId: string) => m.inverters[inverterId]?.status === 'producing'

/**
 * Desempenho diário. A razão "limpa" usa intervalos com POA > 400 W/m², só strings cujo
 * inversor está operando, e o QUANTIL 75 % entre strings: a sujeira atinge todos os módulos,
 * enquanto defeitos atingem uma string ou um inversor — o quantil alto ignora esses casos.
 */
export function dailyPerformance(
  plant: PlantConfig,
  expected: ExpectedSample[],
  measured: TelemetrySample[],
): DailyPerformance[] {
  const dcKwp = plant.strings.reduce((a, s) => a + s.modules * plant.module.pmaxW, 0) / 1000
  const invOf = new Map(plant.strings.map((s) => [s.id, s.inverterId]))
  const days = new Map<number, { exp: number; meas: number; poa: number; num: number; den: number }>()

  for (const { e, m } of pair(expected, measured)) {
    const day = startOfLocalDay(e.t, plant.timezone)
    const d = days.get(day) ?? { exp: 0, meas: 0, poa: 0, num: 0, den: 0 }
    const measAc = Object.values(m.inverters).reduce((a, i) => a + i.acW, 0)
    d.exp += (e.acW / 1000) * STEP_H
    d.meas += (measAc / 1000) * STEP_H
    d.poa += (e.poa / 1000) * STEP_H

    if (e.poa > 400) {
      const ratios = e.strings
        .filter((s) => s.dcW > 50 && producing(m, invOf.get(s.stringId)!))
        .map((s) => (m.strings[s.stringId]?.dcW ?? 0) / s.dcW)
      if (ratios.length >= 3) {
        const totalExp = e.strings.reduce((a, s) => a + s.dcW, 0)
        d.num += quantile(ratios, 0.75) * totalExp
        d.den += totalExp
      }
    }
    days.set(day, d)
  }

  return [...days.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, d]) => ({
      day,
      expectedKwh: d.exp,
      measuredKwh: d.meas,
      poaKwhM2: d.poa,
      performanceRatio: d.poa > 0 ? d.meas / dcKwp / d.poa : 0,
      cleanRatio: d.den > 5_000 ? d.num / d.den : null,
    }))
}

/** Regressão linear simples — tendência da perda por sujeira (%/dia). */
export function linearSlope(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  return den ? num / den : 0
}

export interface SoilingAssessment {
  lossPct: number
  trendPctPerDay: number
  /** Perda uniforme sem tendência de piora: mais compatível com degradação do que sujeira */
  stable: boolean
  lostKwhPerDay: number
  lostRsPerDay: number
  cleaningPaybackDays: number
  severity: Severity
}

export function assessSoiling(plant: PlantConfig, daily: DailyPerformance[]): SoilingAssessment | null {
  const valid = daily.filter((d) => d.cleanRatio !== null)
  if (!valid.length) return null
  // Correção de viés: o quantil 75 % de amostras com ruído fica ~0,8 % acima da mediana
  const recent = valid.slice(-2).map((d) => 1 - (d.cleanRatio as number) + 0.008)
  const lossPct = Math.max(0, median(recent) * 100)
  const trendPctPerDay = -linearSlope(valid.map((_, i) => i), valid.map((d) => d.cleanRatio as number)) * 100
  const stable = valid.length >= 4 && Math.abs(trendPctPerDay) < 0.12 && lossPct >= 3

  const avgExpected = daily.slice(-7).reduce((a, d) => a + d.expectedKwh, 0) / Math.min(7, daily.length)
  const lostKwhPerDay = avgExpected * (lossPct / 100)
  const lostRsPerDay = lostKwhPerDay * effectiveValuePerKwh(plant.economics)
  const cleaningPaybackDays = lostRsPerDay > 0 ? plant.economics.cleaningCostRs / lostRsPerDay : Infinity

  const severity: Severity =
    lossPct >= 8 || cleaningPaybackDays <= 10 ? 'critical'
      : lossPct >= 4 || cleaningPaybackDays <= 30 ? 'warning'
        : lossPct >= 2 ? 'info' : 'ok'

  return { lossPct, trendPctPerDay, stable, lostKwhPerDay, lostRsPerDay, cleaningPaybackDays, severity }
}

type Acc = { exp: number; meas: number }
const ratio = (a?: Acc) => (a && a.exp > 0 ? a.meas / a.exp : NaN)

/**
 * Saúde das strings: compara cada string com o PRÓPRIO valor esperado (que já inclui a
 * sombra da fileira da frente) e depois com a mediana do mesmo inversor. Além do desvio
 * médio, extrai a ASSINATURA do defeito (horário, intermitência, tensão) para sugerir a causa.
 */
export function stringHealth(
  plant: PlantConfig,
  expected: ExpectedSample[],
  measured: TelemetrySample[],
  from: number,
  to: number,
): StringHealth[] {
  const pi = new Map<string, Acc>()
  const periods = new Map<string, Record<'morning' | 'midday' | 'afternoon' | 'lowSun', Acc>>()
  const volts = new Map<string, number[]>()
  const drops = new Map<string, { n: number; total: number; streak: number }>()
  const energy = new Map<string, number>()
  const invOf = new Map(plant.strings.map((s) => [s.id, s.inverterId]))

  for (const { e, m } of pair(expected, measured)) {
    if (e.t < from || e.t > to) continue
    for (const [id, r] of Object.entries(m.strings)) energy.set(id, (energy.get(id) ?? 0) + (r.dcW / 1000) * STEP_H)
    if (e.poa < 60) continue

    const h = localHour(e.t, plant.timezone)
    const period = h < 10 ? 'morning' : h < 14 ? 'midday' : 'afternoon'
    const ratiosByInv = new Map<string, number[]>()

    for (const s of e.strings) {
      const inv = invOf.get(s.stringId)!
      if (!producing(m, inv) || s.dcW < 50) continue
      const meas = m.strings[s.stringId]
      const p = periods.get(s.stringId) ?? { morning: { exp: 0, meas: 0 }, midday: { exp: 0, meas: 0 }, afternoon: { exp: 0, meas: 0 }, lowSun: { exp: 0, meas: 0 } }
      if (e.poa >= 100) {
        p[period].exp += s.dcW
        p[period].meas += meas?.dcW ?? 0
      }
      // Sol baixo (< 30°): onde aparece a sombra de vegetação e da fileira da frente
      if (e.sunElevation < 30) {
        p.lowSun.exp += s.dcW
        p.lowSun.meas += meas?.dcW ?? 0
      }
      periods.set(s.stringId, p)

      if (e.poa >= 300) {
        const a = pi.get(s.stringId) ?? { exp: 0, meas: 0 }
        a.exp += s.dcW
        a.meas += meas?.dcW ?? 0
        pi.set(s.stringId, a)
        if (meas && meas.currentA > 0.5) volts.set(s.stringId, [...(volts.get(s.stringId) ?? []), meas.voltageV])
        const list = ratiosByInv.get(inv) ?? []
        list.push((meas?.dcW ?? 0) / s.dcW)
        ratiosByInv.set(inv, list)
      }
    }

    // Intermitência: string cai a ~0 enquanto as vizinhas do mesmo inversor geram normal
    if (e.poa >= 300) {
      for (const s of e.strings) {
        const inv = invOf.get(s.stringId)!
        const peers = ratiosByInv.get(inv)
        if (!peers || peers.length < 3) continue
        const r = (m.strings[s.stringId]?.dcW ?? 0) / Math.max(1, s.dcW)
        const d = drops.get(s.stringId) ?? { n: 0, total: 0, streak: 0 }
        d.total++
        const dropped = r < 0.15 && median(peers) > 0.6
        if (dropped) d.n++
        // Sequência atual de zeros: distingue circuito ABERTO (zero contínuo até agora) de intermitência
        d.streak = dropped ? d.streak + 1 : 0
        drops.set(s.stringId, d)
      }
    }
  }

  const base = plant.strings.map((s) => ({
    s,
    pi: ratio(pi.get(s.id)),
    v: median(volts.get(s.id) ?? []),
    per: periods.get(s.id),
  }))

  const peerMedian = (s: (typeof base)[number], pick: (x: (typeof base)[number]) => number) => {
    const vals = base.filter((p) => p.s.inverterId === s.s.inverterId && !Number.isNaN(pick(p))).map(pick)
    return median(vals)
  }

  return base.map((b) => {
    const refPi = peerMedian(b, (x) => x.pi)
    const deviation = Number.isNaN(b.pi) || !refPi ? 0 : b.pi / refPi - 1
    const refV = peerMedian(b, (x) => x.v)
    const voltageDeviation = Number.isNaN(b.v) || !refV ? 0 : b.v / refV - 1
    const d = drops.get(b.s.id)
    const intermittency = d && d.total ? d.n / d.total : 0

    const periodDev = (key: 'morning' | 'midday' | 'afternoon' | 'lowSun') => {
      const own = ratio(b.per?.[key])
      const ref = peerMedian(b, (x) => ratio(x.per?.[key]))
      return Number.isNaN(own) || !ref ? 0 : own / ref - 1
    }
    const byPeriod = {
      morning: periodDev('morning'),
      midday: periodDev('midday'),
      afternoon: periodDev('afternoon'),
      lowSun: periodDev('lowSun'),
    }

    let cause: StringCause = 'none'
    let status: Severity = 'ok'
    const piValue = Number.isNaN(b.pi) ? 0 : b.pi
    const openNow = (d?.streak ?? 0) >= 6 && (d?.n ?? 0) / Math.max(1, d?.streak ?? 1) < 1.5
    if ((!Number.isNaN(b.pi) && b.pi < 0.05) || openNow) {
      cause = 'open'
      status = 'critical'
    } else if (intermittency >= 0.03) {
      cause = 'intermittent'
      status = intermittency >= 0.1 ? 'critical' : 'warning'
    } else if (voltageDeviation <= -0.03) {
      cause = 'low-voltage'
      status = 'warning'
    } else if (byPeriod.midday > -0.04 && byPeriod.lowSun <= -0.1) {
      cause = 'shading-low-sun'
      status = 'warning'
    } else if (byPeriod.afternoon <= -0.1 && byPeriod.morning > -0.04) {
      cause = 'shading-afternoon'
      status = 'warning'
    } else if (byPeriod.morning <= -0.1 && byPeriod.afternoon > -0.04) {
      cause = 'shading-morning'
      status = 'warning'
    } else if (deviation <= -0.06) {
      cause = 'constant-loss'
      status = deviation <= -0.15 ? 'critical' : 'warning'
    }

    return {
      stringId: b.s.id,
      inverterId: b.s.inverterId,
      performanceIndex: piValue,
      deviation,
      voltageDeviation,
      intermittency,
      byPeriod,
      energyKwh: energy.get(b.s.id) ?? 0,
      cause,
      status,
    }
  })
}

/**
 * Saúde dos inversores: separa perda na CONVERSÃO (CA/CC abaixo da eficiência esperada →
 * derating por temperatura, falha interna) de perda no ARRANJO inteiro (CC baixo em todas
 * as strings do inversor ao mesmo tempo → PID, degradação, sujeira só daquele lado).
 */
export function inverterHealth(
  plant: PlantConfig,
  expected: ExpectedSample[],
  measured: TelemetrySample[],
  strings: StringHealth[],
  from: number,
  to: number,
): InverterHealth[] {
  const acc = new Map<string, { expAc: number; measAc: number; expDc: number; measDc: number; effExpAc: number; effExpDc: number; effMeasAc: number; effMeasDc: number }>()

  for (const { e, m } of pair(expected, measured)) {
    if (e.t < from || e.t > to || e.poa < 400) continue
    for (const inv of plant.inverters) {
      if (!producing(m, inv.id)) continue
      const a = acc.get(inv.id) ?? { expAc: 0, measAc: 0, expDc: 0, measDc: 0, effExpAc: 0, effExpDc: 0, effMeasAc: 0, effMeasDc: 0 }
      const expDc = e.strings.filter((s) => plant.strings.find((x) => x.id === s.stringId)?.inverterId === inv.id).reduce((x, s) => x + s.dcW, 0)
      const r = m.inverters[inv.id]
      a.expAc += e.inverterAcW[inv.id]
      a.measAc += r.acW
      a.expDc += expDc
      a.measDc += r.dcW
      if (e.inverterAcW[inv.id] > 0.5 * inv.pacMaxW) {
        a.effExpAc += e.inverterAcW[inv.id]
        a.effExpDc += expDc
        a.effMeasAc += r.acW
        a.effMeasDc += r.dcW
      }
      acc.set(inv.id, a)
    }
  }

  const base = plant.inverters.map((inv) => {
    const a = acc.get(inv.id)
    return {
      id: inv.id,
      ac: a && a.expAc ? a.measAc / a.expAc : NaN,
      dc: a && a.expDc ? a.measDc / a.expDc : NaN,
      // Eficiência de conversão medida ÷ esperada, só em carga alta (onde o derating aparece)
      eff: a && a.effMeasDc && a.effExpDc && a.effExpAc ? a.effMeasAc / a.effMeasDc / (a.effExpAc / a.effExpDc) : NaN,
    }
  })

  return base.map((b) => {
    const others = base.filter((o) => o.id !== b.id && !Number.isNaN(o.ac))
    const refAc = others.length ? median(others.map((o) => o.ac)) : NaN
    const refDc = others.length ? median(others.map((o) => o.dc)) : NaN
    const acDeviation = Number.isNaN(b.ac) || Number.isNaN(refAc) ? 0 : b.ac / refAc - 1
    const dcDeviation = Number.isNaN(b.dc) || Number.isNaN(refDc) ? 0 : b.dc / refDc - 1
    const ownStringsOk = strings.filter((s) => s.inverterId === b.id).every((s) => s.status === 'ok')

    let cause: InverterCause = 'none'
    let status: Severity = 'ok'
    if (!Number.isNaN(b.eff) && b.eff < 0.94) {
      cause = 'conversion'
      status = b.eff < 0.85 ? 'critical' : 'warning'
    } else if (dcDeviation <= -0.05 && ownStringsOk) {
      cause = 'array-wide'
      status = dcDeviation <= -0.12 ? 'critical' : 'warning'
    }
    return {
      inverterId: b.id,
      acRatio: Number.isNaN(b.ac) ? 0 : b.ac,
      dcRatio: Number.isNaN(b.dc) ? 0 : b.dc,
      acDeviation,
      dcDeviation,
      cause,
      status,
    }
  })
}

/** Primeiro dia em que a string passou a desviar — ajuda a correlacionar com uma causa. */
export function stringDeviationOnset(
  plant: PlantConfig,
  expected: ExpectedSample[],
  measured: TelemetrySample[],
  stringId: string,
  days: number[],
): number | null {
  let onset: number | null = null
  for (const day of [...days].reverse()) {
    const h = stringHealth(plant, expected, measured, day, day + DAY).find((x) => x.stringId === stringId)
    if (h && h.status !== 'ok') onset = day
    else if (onset !== null) break
  }
  return onset
}

export interface Outage {
  inverterId: string
  start: number
  end: number
  lostKwh: number
}

/** Indisponibilidade: inversor sem geração enquanto o modelo esperava > 1,5 kW. */
export function detectOutages(expected: ExpectedSample[], measured: TelemetrySample[]): Outage[] {
  const outages: Outage[] = []
  const open = new Map<string, Outage>()
  for (const { e, m } of pair(expected, measured)) {
    for (const [invId, expW] of Object.entries(e.inverterAcW)) {
      const r = m.inverters[invId]
      const down = expW > 1500 && (!r || r.acW < expW * 0.02)
      const cur = open.get(invId)
      if (down) {
        if (cur) {
          cur.end = e.t + 15 * MINUTE
          cur.lostKwh += (expW / 1000) * STEP_H
        } else open.set(invId, { inverterId: invId, start: e.t, end: e.t + 15 * MINUTE, lostKwh: (expW / 1000) * STEP_H })
      } else if (cur && expW > 1500) {
        outages.push(cur)
        open.delete(invId)
      }
    }
  }
  return [...outages, ...open.values()].sort((a, b) => a.start - b.start)
}

const STRING_MESSAGE: Record<Exclude<StringCause, 'none'>, string> = {
  open: 'diag.string.open',
  intermittent: 'diag.string.intermittent',
  'low-voltage': 'diag.string.lowVoltage',
  'shading-low-sun': 'diag.string.shadingLowSun',
  'shading-morning': 'diag.string.shadingMorning',
  'shading-afternoon': 'diag.string.shadingAfternoon',
  'constant-loss': 'diag.string.message',
}

/** Monta a lista de diagnósticos exibida no painel (texto resolvido via i18n na UI). */
export interface RainObservation {
  byDay: Map<number, number>
  forecast: { day: number; mm: number }[]
}

/**
 * Lavagem natural: compara a razão "limpa" do dia anterior com a do dia seguinte a cada
 * chuva relevante. Devolve a chuva mais recente que recuperou geração de forma mensurável.
 */
export function detectRainWash(daily: DailyPerformance[], rain: RainObservation | undefined) {
  if (!rain) return null
  const byDay = new Map(daily.map((d) => [d.day, d.cleanRatio]))
  let best: { day: number; mm: number; gainPct: number } | null = null
  for (const [day, mm] of rain.byDay) {
    if (mm < 8) continue
    const before = byDay.get(day - DAY)
    const after = byDay.get(day + DAY)
    if (before == null || after == null) continue
    const gainPct = (after - before) * 100
    if (gainPct >= 1.2 && (!best || day > best.day)) best = { day, mm, gainPct }
  }
  return best
}

export function buildDiagnostics(args: {
  plant: PlantConfig
  expected: ExpectedSample[]
  measured: TelemetrySample[]
  events: InverterEvent[]
  now: number
  rain?: RainObservation
}) {
  const { plant, expected, measured, now, rain } = args
  const today = startOfLocalDay(now, plant.timezone)
  const value = effectiveValuePerKwh(plant.economics)
  const daily = dailyPerformance(plant, expected, measured)
  const soiling = assessSoiling(plant, daily)
  // Janela de 2 dias: dados suficientes mesmo de manhã cedo
  const strings = stringHealth(plant, expected, measured, today - DAY, now)
  const inverters = inverterHealth(plant, expected, measured, strings, today - DAY, now)
  const outages = detectOutages(expected, measured)
  const diagnostics: Diagnostic[] = []

  // Chuva relevante prevista nas próximas 48 h: pode adiar (ou dispensar) a limpeza paga
  const rainSoon = rain?.forecast.find((f) => f.day <= today + DAY && f.mm >= 10) ?? null
  const washed = detectRainWash(daily, rain)

  if (soiling) {
    const waitRain = !!rainSoon && soiling.severity !== 'ok' && !soiling.stable
    const key = soiling.severity === 'ok' ? 'ok' : soiling.stable ? 'stable' : waitRain ? 'waitRain' : 'message'
    diagnostics.push({
      id: 'soiling',
      kind: 'soiling',
      severity: waitRain ? 'info' : soiling.severity,
      titleKey: `diag.soiling.${key === 'message' ? 'title' : `${key}Title`}`,
      messageKey: `diag.soiling.${key}`,
      params: {
        rainMm: Math.round(rainSoon?.mm ?? 0),
        rainDay: rainSoon?.day ?? today,
        loss: soiling.lossPct.toFixed(1),
        trend: soiling.trendPctPerDay.toFixed(2),
        rsDay: soiling.lostRsPerDay.toFixed(2),
        payback: Number.isFinite(soiling.cleaningPaybackDays) ? Math.ceil(soiling.cleaningPaybackDays) : '∞',
        cost: plant.economics.cleaningCostRs,
      },
    })
  }

  if (washed) {
    diagnostics.push({
      id: 'rain-wash',
      kind: 'soiling',
      severity: 'info',
      titleKey: 'diag.rain.washTitle',
      messageKey: 'diag.rain.wash',
      params: { mm: Math.round(washed.mm), day: washed.day, gain: washed.gainPct.toFixed(1) },
    })
  }

  for (const s of strings.filter((x) => x.status !== 'ok' && x.cause !== 'none')) {
    const onset = stringDeviationOnset(plant, expected, measured, s.stringId, daily.map((d) => d.day))
    diagnostics.push({
      id: `string-${s.stringId}`,
      kind: 'string-mismatch',
      severity: s.status,
      titleKey: s.cause === 'open' ? 'diag.string.openTitle' : 'diag.string.title',
      messageKey: STRING_MESSAGE[s.cause as Exclude<StringCause, 'none'>],
      params: {
        string: s.stringId,
        inverter: s.inverterId,
        dev: Math.abs(s.deviation * 100).toFixed(1),
        vdev: Math.abs(s.voltageDeviation * 100).toFixed(1),
        drops: (s.intermittency * 100).toFixed(0),
        morning: Math.abs(s.byPeriod.morning * 100).toFixed(0),
        lowSun: Math.abs(s.byPeriod.lowSun * 100).toFixed(0),
        afternoon: Math.abs(s.byPeriod.afternoon * 100).toFixed(0),
        since: onset ?? today,
      },
      target: s.stringId,
    })
  }

  for (const inv of inverters.filter((x) => x.status !== 'ok')) {
    diagnostics.push({
      id: `inverter-${inv.inverterId}`,
      kind: 'inverter',
      severity: inv.status,
      titleKey: inv.cause === 'conversion' ? 'diag.inverter.conversionTitle' : 'diag.inverter.arrayTitle',
      messageKey: inv.cause === 'conversion' ? 'diag.inverter.conversion' : 'diag.inverter.array',
      params: {
        inverter: inv.inverterId,
        ac: Math.abs(inv.acDeviation * 100).toFixed(1),
        dc: Math.abs(inv.dcDeviation * 100).toFixed(1),
      },
      target: inv.inverterId,
    })
  }

  // Indisponibilidades: agrupa desarmes repetidos (assinatura de sobretensão na rede)
  const recent = outages.filter((o) => o.end > now - 7 * DAY)
  for (const invId of new Set(recent.map((o) => o.inverterId))) {
    const list = recent.filter((o) => o.inverterId === invId)
    const ongoing = list.find((o) => o.end >= now - 20 * MINUTE)
    const lastDays = list.filter((o) => o.start >= today - 2 * DAY)
    const kwh = list.reduce((a, o) => a + o.lostKwh, 0)
    if (ongoing && ongoing.end - ongoing.start >= HOUR) {
      diagnostics.push({
        id: `outage-now-${invId}`,
        kind: 'outage',
        severity: 'critical',
        titleKey: 'diag.outage.nowTitle',
        messageKey: 'diag.outage.now',
        params: { inverter: invId, start: ongoing.start, kwh: ongoing.lostKwh.toFixed(1), rs: (ongoing.lostKwh * value).toFixed(2) },
        target: invId,
      })
    } else if (lastDays.length >= 2) {
      const hours = lastDays.map((o) => localHour(o.start, plant.timezone))
      const h = median(hours)
      diagnostics.push({
        id: `outage-recurrent-${invId}`,
        kind: 'outage',
        severity: lastDays.length >= 4 ? 'critical' : 'warning',
        titleKey: 'diag.outage.recurrentTitle',
        messageKey: 'diag.outage.recurrent',
        params: {
          inverter: invId,
          count: lastDays.length,
          hour: `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`,
          kwh: kwh.toFixed(1),
          rs: (kwh * value).toFixed(2),
        },
        target: invId,
      })
    } else {
      for (const o of list) {
        diagnostics.push({
          id: `outage-${invId}-${o.start}`,
          kind: 'outage',
          severity: 'warning',
          titleKey: 'diag.outage.title',
          messageKey: 'diag.outage.message',
          params: {
            inverter: invId,
            start: o.start,
            minutes: Math.round((o.end - o.start) / MINUTE),
            kwh: o.lostKwh.toFixed(1),
            rs: (o.lostKwh * value).toFixed(2),
          },
          target: invId,
        })
      }
    }
  }

  const todayExp = expected.filter((e) => e.t >= today && e.t < today + DAY)
  const thermalKwh = todayExp.reduce((a, e) => a + (e.thermalLossW / 1000) * STEP_H, 0)
  const dcKwh = todayExp.reduce((a, e) => a + (e.strings.reduce((x, s) => x + s.dcW, 0) / 1000) * STEP_H, 0)
  const peakCell = Math.max(...todayExp.map((e) => e.cellC))
  const thermalPct = dcKwh > 0 ? (thermalKwh / (dcKwh + thermalKwh)) * 100 : 0
  diagnostics.push({
    id: 'thermal',
    kind: 'thermal',
    severity: thermalPct > 10 ? 'warning' : 'info',
    titleKey: 'diag.thermal.title',
    messageKey: 'diag.thermal.message',
    params: { kwh: thermalKwh.toFixed(1), pct: thermalPct.toFixed(1), peak: peakCell.toFixed(0), gamma: plant.module.gammaPmaxPctPerC },
  })

  const clipKwh = todayExp.reduce((a, e) => a + (e.clippedW / 1000) * STEP_H, 0)
  if (clipKwh > 0.5) {
    diagnostics.push({
      id: 'clipping',
      kind: 'clipping',
      severity: 'info',
      titleKey: 'diag.clipping.title',
      messageKey: 'diag.clipping.message',
      params: { kwh: clipKwh.toFixed(1) },
    })
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2, ok: 3 }
  diagnostics.sort((a, b) => order[a.severity] - order[b.severity])
  return { diagnostics, daily, strings, inverters, soiling, outages, rainSoon, washed }
}

import { effectiveValuePerKwh, type ExpectedSample, type PlantConfig } from '@/entities/plant'
import type { InverterEvent, TelemetrySample } from '@/entities/telemetry'
import { DAY, HOUR, MINUTE, startOfLocalDay } from '@/shared/lib/time'
import type { DailyPerformance, Diagnostic, Severity, StringHealth } from '../model/types'

const STEP_H = 0.25 // amostras de 15 min → 0,25 h

export const median = (xs: number[]) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function pair(expected: ExpectedSample[], measured: TelemetrySample[]) {
  const byT = new Map(measured.map((m) => [m.t, m]))
  return expected
    .map((e) => ({ e, m: byT.get(e.t) }))
    .filter((p): p is { e: ExpectedSample; m: TelemetrySample } => !!p.m)
}

const allProducing = (m: TelemetrySample) =>
  Object.values(m.inverters).every((i) => i.status !== 'fault' && i.status !== 'offline')

/**
 * Desempenho diário. A razão "limpa" usa só intervalos com POA > 400 W/m², inversores
 * operando e a MEDIANA entre strings — robusta a uma string com defeito e a desarmes,
 * isolando o efeito que atinge todos os módulos por igual: a sujeira.
 */
export function dailyPerformance(
  plant: PlantConfig,
  expected: ExpectedSample[],
  measured: TelemetrySample[],
): DailyPerformance[] {
  const dcKwp = plant.strings.reduce((a, s) => a + s.modules * plant.module.pmaxW, 0) / 1000
  const days = new Map<number, { exp: number; meas: number; poa: number; num: number; den: number }>()

  for (const { e, m } of pair(expected, measured)) {
    const day = startOfLocalDay(e.t, plant.timezone)
    const d = days.get(day) ?? { exp: 0, meas: 0, poa: 0, num: 0, den: 0 }
    const measAc = Object.values(m.inverters).reduce((a, i) => a + i.acW, 0)
    d.exp += (e.acW / 1000) * STEP_H
    d.meas += (measAc / 1000) * STEP_H
    d.poa += (e.poa / 1000) * STEP_H

    if (e.poa > 400 && allProducing(m)) {
      const ratios = e.strings
        .filter((s) => s.dcW > 50)
        .map((s) => (m.strings[s.stringId]?.dcW ?? 0) / s.dcW)
      if (ratios.length) {
        const totalExp = e.strings.reduce((a, s) => a + s.dcW, 0)
        d.num += median(ratios) * totalExp
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
  lostKwhPerDay: number
  lostRsPerDay: number
  cleaningPaybackDays: number
  severity: Severity
}

export function assessSoiling(plant: PlantConfig, daily: DailyPerformance[]): SoilingAssessment | null {
  const valid = daily.filter((d) => d.cleanRatio !== null)
  if (!valid.length) return null
  const recent = valid.slice(-2).map((d) => 1 - (d.cleanRatio as number))
  const lossPct = Math.max(0, median(recent) * 100)
  const trendPctPerDay = -linearSlope(valid.map((_, i) => i), valid.map((d) => d.cleanRatio as number)) * 100

  const avgExpected = daily.slice(-7).reduce((a, d) => a + d.expectedKwh, 0) / Math.min(7, daily.length)
  const lostKwhPerDay = avgExpected * (lossPct / 100)
  const lostRsPerDay = lostKwhPerDay * effectiveValuePerKwh(plant.economics)
  const cleaningPaybackDays = lostRsPerDay > 0 ? plant.economics.cleaningCostRs / lostRsPerDay : Infinity

  const severity: Severity =
    lossPct >= 8 || cleaningPaybackDays <= 10 ? 'critical'
      : lossPct >= 4 || cleaningPaybackDays <= 30 ? 'warning'
        : lossPct >= 2 ? 'info' : 'ok'

  return { lossPct, trendPctPerDay, lostKwhPerDay, lostRsPerDay, cleaningPaybackDays, severity }
}

/**
 * Saúde das strings: compara cada string com o PRÓPRIO valor esperado (que já inclui a
 * sombra da fileira da frente) e depois com a mediana do mesmo inversor. Comparar
 * potências brutas entre strings geraria falso positivo nas fileiras sombreadas.
 */
export function stringHealth(
  plant: PlantConfig,
  expected: ExpectedSample[],
  measured: TelemetrySample[],
  from: number,
  to: number,
): StringHealth[] {
  const acc = new Map<string, { exp: number; meas: number }>()
  for (const { e, m } of pair(expected, measured)) {
    if (e.t < from || e.t > to || e.poa < 300 || !allProducing(m)) continue
    for (const s of e.strings) {
      const a = acc.get(s.stringId) ?? { exp: 0, meas: 0 }
      a.exp += s.dcW
      a.meas += m.strings[s.stringId]?.dcW ?? 0
      acc.set(s.stringId, a)
    }
  }

  const energy = new Map<string, number>()
  for (const { m } of pair(expected, measured)) {
    if (m.t < from || m.t > to) continue
    for (const [id, r] of Object.entries(m.strings)) energy.set(id, (energy.get(id) ?? 0) + (r.dcW / 1000) * STEP_H)
  }

  const pis = plant.strings.map((s) => {
    const a = acc.get(s.id)
    return { s, pi: a && a.exp > 0 ? a.meas / a.exp : NaN }
  })

  return pis.map(({ s, pi }) => {
    const peers = pis.filter((p) => p.s.inverterId === s.inverterId && !Number.isNaN(p.pi)).map((p) => p.pi)
    const ref = median(peers)
    const deviation = Number.isNaN(pi) || !ref ? 0 : pi / ref - 1
    const status: Severity = deviation <= -0.15 ? 'critical' : deviation <= -0.06 ? 'warning' : 'ok'
    return {
      stringId: s.id,
      inverterId: s.inverterId,
      performanceIndex: Number.isNaN(pi) ? 0 : pi,
      deviation,
      energyKwh: energy.get(s.id) ?? 0,
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
    if (h && h.deviation <= -0.06) onset = day
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
      } else if (cur) {
        outages.push(cur)
        open.delete(invId)
      }
    }
  }
  return [...outages, ...open.values()]
}

/** Monta a lista de diagnósticos exibida no painel (texto resolvido via i18n na UI). */
export function buildDiagnostics(args: {
  plant: PlantConfig
  expected: ExpectedSample[]
  measured: TelemetrySample[]
  events: InverterEvent[]
  now: number
}): { diagnostics: Diagnostic[]; daily: DailyPerformance[]; strings: StringHealth[]; soiling: SoilingAssessment | null; outages: Outage[] } {
  const { plant, expected, measured, now } = args
  const today = startOfLocalDay(now, plant.timezone)
  const daily = dailyPerformance(plant, expected, measured)
  const soiling = assessSoiling(plant, daily)
  // Janela de 2 dias: dados suficientes mesmo de manhã cedo
  const strings = stringHealth(plant, expected, measured, today - DAY, now)
  const outages = detectOutages(expected, measured)
  const diagnostics: Diagnostic[] = []

  if (soiling) {
    diagnostics.push({
      id: 'soiling',
      kind: 'soiling',
      severity: soiling.severity,
      titleKey: soiling.severity === 'ok' ? 'diag.soiling.okTitle' : 'diag.soiling.title',
      messageKey: soiling.severity === 'ok' ? 'diag.soiling.ok' : 'diag.soiling.message',
      params: {
        loss: soiling.lossPct.toFixed(1),
        trend: soiling.trendPctPerDay.toFixed(2),
        rsDay: soiling.lostRsPerDay.toFixed(2),
        payback: Number.isFinite(soiling.cleaningPaybackDays) ? Math.ceil(soiling.cleaningPaybackDays) : '∞',
        cost: plant.economics.cleaningCostRs,
      },
    })
  }

  for (const s of strings.filter((x) => x.status !== 'ok')) {
    const onset = stringDeviationOnset(plant, expected, measured, s.stringId, daily.map((d) => d.day))
    diagnostics.push({
      id: `string-${s.stringId}`,
      kind: 'string-mismatch',
      severity: s.status,
      titleKey: 'diag.string.title',
      messageKey: 'diag.string.message',
      params: { string: s.stringId, inverter: s.inverterId, dev: (s.deviation * 100).toFixed(1), since: onset ?? now },
      target: s.stringId,
    })
  }

  for (const o of outages.filter((x) => x.end > now - 7 * DAY)) {
    diagnostics.push({
      id: `outage-${o.inverterId}-${o.start}`,
      kind: 'outage',
      severity: o.end > now - HOUR ? 'critical' : 'warning',
      titleKey: 'diag.outage.title',
      messageKey: 'diag.outage.message',
      params: {
        inverter: o.inverterId,
        start: o.start,
        minutes: Math.round((o.end - o.start) / MINUTE),
        kwh: o.lostKwh.toFixed(1),
        rs: (o.lostKwh * effectiveValuePerKwh(plant.economics)).toFixed(2),
      },
      target: o.inverterId,
    })
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
  return { diagnostics, daily, strings, soiling, outages }
}

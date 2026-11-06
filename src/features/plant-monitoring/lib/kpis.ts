import { effectiveValuePerKwh, type ExpectedSample, type PlantConfig } from '@/entities/plant'
import type { TelemetrySample } from '@/entities/telemetry'
import { DAY, startOfLocalDay } from '@/shared/lib/time'

export interface PlantKpis {
  powerKw: number
  expectedPowerKw: number
  energyTodayKwh: number
  expectedSoFarKwh: number
  expectedFullDayKwh: number
  savingsTodayRs: number
  performanceRatioToday: number
  irradianceWm2: number
  cellTempC: number
  ambientC: number
  lastSampleAt: number | null
}

const STEP_H = 0.25

export function computeKpis(
  plant: PlantConfig,
  expected: ExpectedSample[],
  measured: TelemetrySample[],
  now: number,
): PlantKpis {
  const today = startOfLocalDay(now, plant.timezone)
  const measToday = measured.filter((m) => m.t >= today && m.t <= now)
  const expToday = expected.filter((e) => e.t >= today && e.t < today + DAY)
  const last = measToday.at(-1)
  const lastExp = expToday.filter((e) => e.t <= now).at(-1)
  const ac = (m: TelemetrySample) => Object.values(m.inverters).reduce((a, i) => a + i.acW, 0)

  const energyTodayKwh = measToday.reduce((a, m) => a + (ac(m) / 1000) * STEP_H, 0)
  const expectedSoFarKwh = expToday.filter((e) => e.t <= now).reduce((a, e) => a + (e.acW / 1000) * STEP_H, 0)
  const poaKwh = expToday.filter((e) => e.t <= now).reduce((a, e) => a + (e.poa / 1000) * STEP_H, 0)
  const dcKwp = plant.strings.reduce((a, s) => a + s.modules * plant.module.pmaxW, 0) / 1000

  return {
    powerKw: last ? ac(last) / 1000 : 0,
    expectedPowerKw: lastExp ? lastExp.acW / 1000 : 0,
    energyTodayKwh,
    expectedSoFarKwh,
    expectedFullDayKwh: expToday.reduce((a, e) => a + (e.acW / 1000) * STEP_H, 0),
    savingsTodayRs: energyTodayKwh * effectiveValuePerKwh(plant.economics),
    performanceRatioToday: poaKwh > 0.2 ? energyTodayKwh / dcKwp / poaKwh : 0,
    irradianceWm2: lastExp?.poa ?? 0,
    cellTempC: lastExp?.cellC ?? 0,
    ambientC: lastExp?.ambientC ?? 0,
    lastSampleAt: last?.t ?? null,
  }
}

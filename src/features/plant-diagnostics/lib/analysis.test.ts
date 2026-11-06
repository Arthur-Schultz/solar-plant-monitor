import { describe, expect, it } from 'vitest'
import { PLANT } from '@/entities/plant'
import { DEMO_SCENARIO } from '@/entities/telemetry'
import { resampleTo15min, syntheticHourly } from '@/entities/weather'
import { runPipeline } from '@/features/plant-monitoring/lib/pipeline'
import { DAY, HOUR, startOfLocalDay } from '@/shared/lib/time'
import { effectiveValuePerKwh } from '@/entities/plant'
import { buildDiagnostics, linearSlope, median } from './analysis'

// "Agora" fixo: 6/nov/2026 16h local → testes reprodutíveis
const NOW = Date.UTC(2026, 10, 6, 19, 0)
const weather = resampleTo15min(
  syntheticHourly(PLANT.latitude, PLANT.longitude, PLANT.timezone, { now: NOW }),
  PLANT.latitude,
  PLANT.longitude,
)

async function scenario(overrides: Partial<typeof DEMO_SCENARIO> = {}) {
  const r = await runPipeline(PLANT, weather, 22, NOW, { ...DEMO_SCENARIO, ...overrides })
  return { ...r, ...buildDiagnostics({ plant: PLANT, ...r, now: NOW }) }
}

describe('utilitários', () => {
  it('mediana e inclinação', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(linearSlope([0, 1, 2], [1, 3, 5])).toBeCloseTo(2)
  })

  it('valor efetivo do kWh desconta o Fio B só da parcela injetada', () => {
    const v = effectiveValuePerKwh(PLANT.economics)
    expect(v).toBeLessThan(PLANT.economics.tariffRsPerKwh)
    expect(v).toBeCloseTo(0.88 - 0.7 * 0.27 * 0.6, 6)
  })
})

describe('diagnósticos sobre a telemetria simulada', () => {
  it('usina saudável e limpa não gera alertas de string nem de sujeira', async () => {
    const r = await scenario({ daysSinceCleaning: 0, degradedString: null, inverterTrip: null })
    expect(r.strings.every((s) => s.status === 'ok')).toBe(true)
    expect(r.soiling!.lossPct).toBeLessThan(1.5)
    expect(r.outages).toHaveLength(0)
  })

  it('detecta a string degradada B3 e só ela — inclusive com a sombra das fileiras de trás', async () => {
    const r = await scenario()
    const bad = r.strings.filter((s) => s.status !== 'ok').map((s) => s.stringId)
    expect(bad).toEqual(['B3'])
    const b3 = r.strings.find((s) => s.stringId === 'B3')!
    expect(b3.deviation).toBeLessThan(-0.1)
    expect(b3.deviation).toBeGreaterThan(-0.16)
  })

  it('estima a sujeira acumulada (≈ simulada) mesmo com a string defeituosa', async () => {
    const r = await scenario({ rainWashFraction: 0 })
    const simulated = DEMO_SCENARIO.daysSinceCleaning * DEMO_SCENARIO.soilingRatePerDay * 100
    expect(r.soiling!.lossPct).toBeGreaterThan(simulated - 1.5)
    expect(r.soiling!.lossPct).toBeLessThan(simulated + 1.5)
    expect(r.diagnostics.find((d) => d.kind === 'soiling')!.severity).not.toBe('ok')
  })

  it('encontra o desarme do inversor B e a energia perdida', async () => {
    const r = await scenario()
    expect(r.outages).toHaveLength(1)
    const o = r.outages[0]
    expect(o.inverterId).toBe('INV-B')
    const tripStart = startOfLocalDay(NOW, PLANT.timezone) - 3 * DAY + 13.25 * HOUR
    expect(Math.abs(o.start - tripStart)).toBeLessThanOrEqual(15 * 60_000)
    expect(o.lostKwh).toBeGreaterThan(0)
  })

  it('a telemetria nunca ultrapassa o instante atual', async () => {
    const r = await scenario()
    expect(Math.max(...r.measured.map((m) => m.t))).toBeLessThanOrEqual(NOW)
    expect(Math.max(...r.expected.map((m) => m.t))).toBeGreaterThan(NOW)
  })
})

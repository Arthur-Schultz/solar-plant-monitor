import { describe, expect, it } from 'vitest'
import { effectiveValuePerKwh, PLANT } from '@/entities/plant'
import { DEMO_FAULTS, FAULT_CATALOG, type FaultInjection, type FaultKind } from '@/entities/telemetry'
import { resampleTo15min, syntheticHourly } from '@/entities/weather'
import { runPipeline } from '@/features/plant-monitoring/lib/pipeline'
import { buildDiagnostics, linearSlope, median, quantile } from './analysis'

// "Agora" fixo: 6/nov/2026 16h local → testes reprodutíveis
const NOW = Date.UTC(2026, 10, 6, 19, 0)
const weather = resampleTo15min(
  syntheticHourly(PLANT.latitude, PLANT.longitude, PLANT.timezone, { now: NOW }),
  PLANT.latitude,
  PLANT.longitude,
)

async function analyse(faults: FaultInjection[]) {
  const r = await runPipeline(PLANT, weather, 22, NOW, { faults, noise: 0.012 })
  return { ...r, ...buildDiagnostics({ plant: PLANT, ...r, now: NOW }) }
}

function single(kind: FaultKind, overrides: Partial<FaultInjection> = {}): FaultInjection[] {
  const def = FAULT_CATALOG.find((d) => d.kind === kind)!
  return [{
    id: kind,
    kind,
    target: def.target === 'plant' ? null : def.defaultTarget!,
    severity: def.defaultSeverity,
    sinceDaysAgo: ['soiling-uniform', 'pid', 'aging'].includes(kind) ? 7 : 2,
    ...overrides,
  }]
}

const problems = (r: Awaited<ReturnType<typeof analyse>>) =>
  r.diagnostics.filter((d) => !['thermal', 'clipping'].includes(d.kind) && d.severity !== 'ok')

describe('utilitários', () => {
  it('mediana, quantil e inclinação', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(quantile([1, 2, 3, 4, 5], 0.75)).toBe(4)
    expect(linearSlope([0, 1, 2], [1, 3, 5])).toBeCloseTo(2)
  })

  it('valor efetivo do kWh desconta o Fio B só da parcela injetada', () => {
    expect(effectiveValuePerKwh(PLANT.economics)).toBeCloseTo(0.88 - 0.7 * 0.27 * 0.6, 6)
  })
})

describe('usina saudável', () => {
  it('não gera nenhum alerta (sem falso positivo)', async () => {
    const r = await analyse([])
    expect(problems(r)).toHaveLength(0)
    expect(r.strings.every((s) => s.status === 'ok')).toBe(true)
    expect(r.inverters.every((i) => i.status === 'ok')).toBe(true)
  })

  it('a telemetria nunca ultrapassa o instante atual', async () => {
    const r = await analyse([])
    expect(Math.max(...r.measured.map((m) => m.t))).toBeLessThanOrEqual(NOW)
    expect(Math.max(...r.expected.map((m) => m.t))).toBeGreaterThan(NOW)
  })
})

/**
 * Cada falha do catálogo, isolada, precisa ser encontrada pela assinatura certa — e só ela.
 * É o teste que garante que o simulador manual e os diagnósticos "conversam".
 */
describe('cada falha simulada é detectada pela assinatura certa', () => {
  const cases: [FaultKind, string, string | undefined][] = [
    ['soiling-uniform', 'diag.soiling.message', undefined],
    ['aging', 'diag.soiling.stable', undefined],
    ['soiling-localized', 'diag.string.message', 'A2'],
    ['hotspot', 'diag.string.message', 'B3'],
    ['vegetation-shading', 'diag.string.shadingLowSun', 'A1'],
    ['object-shading', 'diag.string.shadingAfternoon', 'B4'],
    ['loose-connector', 'diag.string.intermittent', 'A3'],
    ['open-string', 'diag.string.open', 'B2'],
    ['string-short', 'diag.string.lowVoltage', 'A4'],
    ['grid-overvoltage', 'diag.outage.recurrent', 'INV-B'],
    ['inverter-offline', 'diag.outage.now', 'INV-B'],
    ['inverter-derating', 'diag.inverter.conversion', 'INV-A'],
    ['pid', 'diag.inverter.array', 'INV-A'],
  ]

  it.each(cases)('%s → %s', async (kind, messageKey, target) => {
    const r = await analyse(single(kind))
    const found = problems(r)
    expect(found.map((d) => d.messageKey)).toEqual([messageKey])
    if (target) expect(found[0].target).toBe(target)
  })
})

describe('falhas que começaram hoje', () => {
  it('string aberta desde hoje é "aberta", não "intermitente"', async () => {
    const r = await analyse(single('open-string', { sinceDaysAgo: 0 }))
    expect(problems(r).map((d) => d.messageKey)).toEqual(['diag.string.open'])
  })

  it('conector com mau contato desde hoje continua "intermitente"', async () => {
    const r = await analyse(single('loose-connector', { sinceDaysAgo: 0 }))
    expect(problems(r).map((d) => d.messageKey)).toEqual(['diag.string.intermittent'])
  })
})

describe('chuva', () => {
  const dirty = () => single('soiling-uniform', { severity: 0.5 }) // 11 % hoje sem chuva

  it('chuva forte lava a sujeira e o diagnóstico reconhece a limpeza natural', async () => {
    const dry = await analyse(dirty())
    const rainy = await analyse([...dirty(), ...single('heavy-rain', { severity: 0.6, sinceDaysAgo: 3 })]) // 32 mm
    expect(rainy.soiling!.lossPct).toBeLessThan(dry.soiling!.lossPct - 3)
    const wash = rainy.diagnostics.find((d) => d.id === 'rain-wash')
    expect(wash?.params.mm).toBe(32)
  })

  it('chuva fraca (< 5 mm) não lava nada', async () => {
    const dry = await analyse(dirty())
    const drizzle = await analyse([...dirty(), ...single('heavy-rain', { severity: 0, sinceDaysAgo: 3 })]) // 5 mm
    expect(drizzle.soiling!.lossPct).toBeCloseTo(dry.soiling!.lossPct, 0)
  })

  it('com chuva forte prevista, recomenda esperar antes de pagar a limpeza', async () => {
    const r = await runPipeline(PLANT, weather, 22, NOW, { faults: dirty(), noise: 0.012 })
    const tomorrow = r.expected[r.expected.length - 1].t
    const base = buildDiagnostics({ plant: PLANT, ...r, now: NOW, rain: { byDay: r.rain.byDay, forecast: [] } })
    const withForecast = buildDiagnostics({ plant: PLANT, ...r, now: NOW, rain: { byDay: r.rain.byDay, forecast: [{ day: tomorrow, mm: 18 }] } })
    expect(base.diagnostics.find((d) => d.id === 'soiling')!.messageKey).toBe('diag.soiling.message')
    const soiling = withForecast.diagnostics.find((d) => d.id === 'soiling')!
    expect(soiling.messageKey).toBe('diag.soiling.waitRain')
    expect(soiling.params.rainMm).toBe(18)
  })
})

describe('cenário de demonstração (várias falhas ao mesmo tempo)', () => {
  it('encontra sujeira, o hotspot em B3 e os desarmes do INV-B', async () => {
    const r = await analyse(DEMO_FAULTS)
    const keys = problems(r).map((d) => `${d.messageKey}:${d.target ?? ''}`)
    expect(keys).toContain('diag.string.message:B3')
    expect(keys).toContain('diag.outage.recurrent:INV-B')
    expect(r.soiling!.lossPct).toBeGreaterThan(2)
  })

  it('a estimativa de sujeira fica perto do valor simulado mesmo com uma string ruim', async () => {
    const r = await analyse([...single('soiling-uniform', { severity: 0.3 }), ...single('hotspot')])
    // 2 + 18·0,3 = 7,4 % hoje (rampa linear desde 7 dias atrás)
    expect(r.soiling!.lossPct).toBeGreaterThan(5.5)
    expect(r.soiling!.lossPct).toBeLessThan(8)
  })
})

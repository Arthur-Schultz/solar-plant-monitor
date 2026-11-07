import type { TFunction } from 'i18next'
import { effectiveValuePerKwh, nameplateAcW, nameplateDcW, type PlantConfig } from '@/entities/plant'
import type { InverterEvent, TelemetrySample } from '@/entities/telemetry'
import { buildDiagnostics, formatDiagnosticParams } from '@/features/plant-diagnostics'
import type { PlantKpis, RainInfo } from '@/features/plant-monitoring'
import { startOfLocalDay } from '@/shared/lib/time'

type Analysis = ReturnType<typeof buildDiagnostics>
type Fmt = Parameters<typeof formatDiagnosticParams>[1] & { time: (t: number) => string }

const r1 = (v: number) => Math.round(v * 10) / 10
const pct = (v: number) => r1(v * 100)

/**
 * Retrato compacto do painel enviado ao assistente a cada pergunta. Os textos dos
 * diagnósticos vão já traduzidos, então a IA "vê" exatamente o que o usuário vê.
 * Não inclui o cenário do simulador: a IA precisa raciocinar pelos dados, como numa usina real.
 */
export function buildAssistantSnapshot(args: {
  plant: PlantConfig
  kpis: PlantKpis
  analysis: Analysis
  measured: TelemetrySample[]
  events: InverterEvent[]
  rain: RainInfo
  tiltDeg: number
  weatherSource: string | null
  now: number
  t: TFunction
  fmt: Fmt
}) {
  const { plant, kpis, analysis, measured, events, rain, tiltDeg, weatherSource, now, t, fmt } = args
  const last = measured.at(-1)
  const today = startOfLocalDay(now, plant.timezone)

  return {
    momento: `${fmt.day(now)} ${fmt.time(now)} (${plant.timezone})`,
    usina: {
      nome: plant.name,
      local: plant.locationLabel,
      potenciaCcKwp: r1(nameplateDcW(plant) / 1000),
      potenciaCaKw: r1(nameplateAcW(plant) / 1000),
      modulos: `${plant.strings.length * plant.strings[0].modules} × ${plant.module.pmaxW} Wp (γ ${plant.module.gammaPmaxPctPerC} %/°C, NOCT ${plant.module.noctC} °C)`,
      strings: plant.strings.map((s) => `${s.id}→${s.inverterId}, fileira ${s.row + 1}`).join('; '),
      inclinacaoGraus: tiltDeg,
      orientacao: 'face norte',
      tarifaRsKwh: plant.economics.tariffRsPerKwh,
      valorEfetivoRsKwh: r1(effectiveValuePerKwh(plant.economics) * 100) / 100,
      custoLimpezaRs: plant.economics.cleaningCostRs,
    },
    agora: {
      potenciaKw: r1(kpis.powerKw),
      potenciaEsperadaKw: r1(kpis.expectedPowerKw),
      irradianciaPlanoWm2: Math.round(kpis.irradianceWm2),
      temperaturaArC: r1(kpis.ambientC),
      temperaturaCelulaC: r1(kpis.cellTempC),
    },
    hoje: {
      energiaKwh: r1(kpis.energyTodayKwh),
      esperadoAteAgoraKwh: r1(kpis.expectedSoFarKwh),
      previsaoDiaKwh: r1(kpis.expectedFullDayKwh),
      economiaRs: r1(kpis.savingsTodayRs),
      performanceRatioPct: pct(kpis.performanceRatioToday),
    },
    ultimosDias: analysis.daily.map((d) => ({
      dia: fmt.day(d.day),
      esperadoKwh: r1(d.expectedKwh),
      medidoKwh: r1(d.measuredKwh),
      prPct: pct(d.performanceRatio),
    })),
    sujeiraEstimada: analysis.soiling && {
      perdaPct: r1(analysis.soiling.lossPct),
      tendenciaPctPorDia: r1(analysis.soiling.trendPctPerDay * 10) / 10,
      perdaEstavelSemTendencia: analysis.soiling.stable,
      perdaRsPorDia: r1(analysis.soiling.lostRsPerDay),
      limpezaSePagaEmDias: Number.isFinite(analysis.soiling.cleaningPaybackDays) ? Math.ceil(analysis.soiling.cleaningPaybackDays) : null,
    },
    chuva: {
      agoraMmPorHora: r1(rain.nowMmPerHour),
      ultimosDiasMm: [...rain.byDay.entries()]
        .sort(([a], [b]) => a - b)
        .filter(([, mm]) => mm >= 0.5)
        .map(([day, mm]) => ({ dia: fmt.day(day), mm: r1(mm) })),
      previsaoMm: rain.forecast.map((f) => ({ dia: fmt.day(f.day), mm: r1(f.mm) })),
      regra: 'chuva > ~10 mm lava parte da poeira; < 5 mm não limpa',
    },
    strings48h: analysis.strings.map((s) => ({
      id: s.stringId,
      inversor: s.inverterId,
      indiceDesempenhoPct: pct(s.performanceIndex),
      desvioVizinhasPct: pct(s.deviation),
      desvioTensaoPct: pct(s.voltageDeviation),
      quedasIntermitentesPct: pct(s.intermittency),
      desvioSolBaixoPct: pct(s.byPeriod.lowSun),
      desvioManhaPct: pct(s.byPeriod.morning),
      desvioTardePct: pct(s.byPeriod.afternoon),
      energiaKwh: r1(s.energyKwh),
      status: s.status,
      assinatura: s.cause,
      agora: last?.strings[s.stringId] && {
        potenciaW: Math.round(last.strings[s.stringId].dcW),
        tensaoV: Math.round(last.strings[s.stringId].voltageV),
        correnteA: r1(last.strings[s.stringId].currentA),
      },
    })),
    inversores: plant.inverters.map((inv) => {
      const h = analysis.inverters.find((x) => x.inverterId === inv.id)
      const r = last?.inverters[inv.id]
      return {
        id: inv.id,
        statusAgora: r?.status ?? 'sem dados',
        potenciaCaKw: r1((r?.acW ?? 0) / 1000),
        potenciaCcKw: r1((r?.dcW ?? 0) / 1000),
        temperaturaDissipadorC: Math.round(r?.heatsinkC ?? 0),
        energiaHojeKwh: r1(measured.filter((m) => m.t >= today).reduce((a, m) => a + (m.inverters[inv.id]?.acW ?? 0) / 4000, 0)),
        desvioCaVsOutroPct: h ? pct(h.acDeviation) : null,
        desvioCcVsOutroPct: h ? pct(h.dcDeviation) : null,
        assinatura: h?.cause ?? 'none',
      }
    }),
    diagnosticos: analysis.diagnostics.map((d) => {
      const p = formatDiagnosticParams(d.params, fmt)
      return { gravidade: d.severity, titulo: t(d.titleKey, p), detalhe: t(d.messageKey, p) }
    }),
    eventosInversores: events.slice(-12).map((e) => ({
      quando: `${fmt.day(e.t)} ${fmt.time(e.t)}`,
      inversor: e.inverterId,
      codigo: e.code,
      descricao: t(e.messageKey),
    })),
    origemDosDados: `clima: ${weatherSource ?? 'desconhecido'}; geração esperada: modelo físico; telemetria: simulada`,
  }
}

export type AssistantSnapshot = ReturnType<typeof buildAssistantSnapshot>

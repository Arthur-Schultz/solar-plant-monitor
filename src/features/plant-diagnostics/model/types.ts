export type Severity = 'ok' | 'info' | 'warning' | 'critical'

export interface Diagnostic {
  id: string
  kind: 'soiling' | 'string-mismatch' | 'outage' | 'thermal' | 'clipping'
  severity: Severity
  /** Chaves i18n + parâmetros: o texto é montado na UI, no idioma ativo */
  titleKey: string
  messageKey: string
  params: Record<string, string | number>
  /** Elemento físico relacionado (string ou inversor) — destacado na maquete 3D */
  target?: string
}

export interface DailyPerformance {
  /** Início do dia local (ms UTC) */
  day: number
  expectedKwh: number
  measuredKwh: number
  /** Irradiação no plano (kWh/m²) */
  poaKwhM2: number
  /** Performance Ratio IEC 61724 = Yf / Yr */
  performanceRatio: number
  /** Razão medido/esperado em intervalos limpos e saudáveis (base da estimativa de sujeira) */
  cleanRatio: number | null
}

export interface StringHealth {
  stringId: string
  inverterId: string
  /** Índice de desempenho = medido / esperado (1 = conforme o modelo) */
  performanceIndex: number
  /** Desvio relativo à mediana das strings do mesmo inversor */
  deviation: number
  energyKwh: number
  status: Severity
}

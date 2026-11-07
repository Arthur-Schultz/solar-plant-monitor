export type Severity = 'ok' | 'info' | 'warning' | 'critical'

export interface Diagnostic {
  id: string
  kind: 'soiling' | 'string-mismatch' | 'outage' | 'inverter' | 'thermal' | 'clipping'
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

/**
 * Assinatura do defeito, inferida só pelos dados:
 * - open: sem corrente nenhuma (fusível, conector solto, cabo rompido)
 * - intermittent: quedas a zero e voltas (contato ruim, MC4 mal crimpado/oxidado)
 * - low-voltage: tensão abaixo das vizinhas (módulos a menos, diodos de bypass em curto)
 * - shading-low-sun: perde só de manhã cedo e fim de tarde (vegetação, fileira da frente)
 * - shading-afternoon / shading-morning: perde numa janela fixa (árvore, poste, construção)
 * - constant-loss: perda proporcional o dia todo (hotspot, módulo trincado, sujeira localizada)
 */
export type StringCause =
  | 'none'
  | 'open'
  | 'intermittent'
  | 'low-voltage'
  | 'shading-low-sun'
  | 'shading-morning'
  | 'shading-afternoon'
  | 'constant-loss'

export interface StringHealth {
  stringId: string
  inverterId: string
  /** Índice de desempenho = medido / esperado (1 = conforme o modelo) */
  performanceIndex: number
  /** Desvio relativo à mediana das strings do mesmo inversor */
  deviation: number
  /** Desvio de tensão em relação às vizinhas */
  voltageDeviation: number
  /** Fração dos intervalos com queda abrupta a ~zero enquanto as vizinhas geram */
  intermittency: number
  /** Desvio por período: manhã (<10h), meio-dia (10–14h), tarde (>14h) e Sol baixo (< 30°) */
  byPeriod: { morning: number; midday: number; afternoon: number; lowSun: number }
  energyKwh: number
  cause: StringCause
  status: Severity
}

export type InverterCause = 'none' | 'conversion' | 'array-wide'

export interface InverterHealth {
  inverterId: string
  /** CA medido ÷ CA esperado */
  acRatio: number
  /** CC medido ÷ CC esperado */
  dcRatio: number
  /** Desvio de CA em relação ao outro inversor */
  acDeviation: number
  dcDeviation: number
  cause: InverterCause
  status: Severity
}

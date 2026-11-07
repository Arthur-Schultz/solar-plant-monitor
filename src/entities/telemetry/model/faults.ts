/**
 * Catálogo de falhas comuns em microgeração solar — usado pelo simulador (para gerar a
 * telemetria) e pela UI (para o usuário ligar/desligar cada problema na mão).
 * Os diagnósticos NÃO leem este catálogo: eles precisam inferir o problema pelos dados.
 */
export type FaultKind =
  // Sujeira e sombra
  | 'soiling-uniform'
  | 'heavy-rain'
  | 'soiling-localized'
  | 'vegetation-shading'
  | 'object-shading'
  // Conexões e módulos
  | 'loose-connector'
  | 'hotspot'
  | 'open-string'
  // Inversor e rede
  | 'grid-overvoltage'
  | 'inverter-derating'
  | 'inverter-offline'
  // Degradação e projeto
  | 'pid'
  | 'aging'
  | 'string-short'

export type FaultGroup = 'dirt-shade' | 'connections-modules' | 'inverter-grid' | 'degradation-design'
export type FaultTarget = 'plant' | 'string' | 'inverter'

export interface FaultDefinition {
  kind: FaultKind
  group: FaultGroup
  target: FaultTarget
  /** Se a intensidade faz diferença (alguns defeitos são binários) */
  hasSeverity: boolean
  /** Evento pontual (acontece num dia) em vez de defeito contínuo */
  isEvent?: boolean
  defaultSeverity: number
  defaultTarget?: string
}

export interface FaultInjection {
  id: string
  kind: FaultKind
  /** id da string ou do inversor; null para falhas da usina inteira */
  target: string | null
  /** 0–1: o significado físico depende do tipo (ver `faultMagnitude`) */
  severity: number
  /** Há quantos dias o problema começou (0 = hoje) */
  sinceDaysAgo: number
}

export const FAULT_CATALOG: FaultDefinition[] = [
  { kind: 'soiling-uniform', group: 'dirt-shade', target: 'plant', hasSeverity: true, defaultSeverity: 0.25 },
  { kind: 'heavy-rain', group: 'dirt-shade', target: 'plant', hasSeverity: true, isEvent: true, defaultSeverity: 0.4 },
  { kind: 'soiling-localized', group: 'dirt-shade', target: 'string', hasSeverity: true, defaultSeverity: 0.4, defaultTarget: 'A2' },
  { kind: 'vegetation-shading', group: 'dirt-shade', target: 'string', hasSeverity: true, defaultSeverity: 0.6, defaultTarget: 'A1' },
  { kind: 'object-shading', group: 'dirt-shade', target: 'string', hasSeverity: true, defaultSeverity: 0.5, defaultTarget: 'B4' },
  { kind: 'loose-connector', group: 'connections-modules', target: 'string', hasSeverity: true, defaultSeverity: 0.5, defaultTarget: 'A3' },
  { kind: 'hotspot', group: 'connections-modules', target: 'string', hasSeverity: true, defaultSeverity: 0.5, defaultTarget: 'B3' },
  { kind: 'open-string', group: 'connections-modules', target: 'string', hasSeverity: false, defaultSeverity: 1, defaultTarget: 'B2' },
  { kind: 'grid-overvoltage', group: 'inverter-grid', target: 'inverter', hasSeverity: true, defaultSeverity: 0.4, defaultTarget: 'INV-B' },
  { kind: 'inverter-derating', group: 'inverter-grid', target: 'inverter', hasSeverity: true, defaultSeverity: 0.5, defaultTarget: 'INV-A' },
  { kind: 'inverter-offline', group: 'inverter-grid', target: 'inverter', hasSeverity: false, defaultSeverity: 1, defaultTarget: 'INV-B' },
  { kind: 'pid', group: 'degradation-design', target: 'inverter', hasSeverity: true, defaultSeverity: 0.5, defaultTarget: 'INV-A' },
  { kind: 'aging', group: 'degradation-design', target: 'plant', hasSeverity: true, defaultSeverity: 0.4 },
  { kind: 'string-short', group: 'degradation-design', target: 'string', hasSeverity: true, defaultSeverity: 0, defaultTarget: 'A4' },
]

export const FAULT_GROUPS: FaultGroup[] = ['dirt-shade', 'connections-modules', 'inverter-grid', 'degradation-design']

export const faultDefinition = (kind: FaultKind) => FAULT_CATALOG.find((f) => f.kind === kind)!

/**
 * Converte a intensidade 0–1 numa grandeza física legível (mostrada na UI e usada pelo
 * simulador). Mantida num só lugar para a UI e o simulador nunca divergirem.
 */
export function faultMagnitude(kind: FaultKind, severity: number): { value: number; unit: 'pct' | 'years' | 'modules' | 'deg' | 'tripLoad' | 'powerCap' | 'dropChance' | 'mm' } {
  const s = Math.max(0, Math.min(1, severity))
  switch (kind) {
    case 'soiling-uniform': return { value: 2 + 18 * s, unit: 'pct' } // perda atingida hoje
    case 'heavy-rain': return { value: Math.round(5 + 45 * s), unit: 'mm' }
    case 'soiling-localized': return { value: 4 + 26 * s, unit: 'pct' }
    case 'vegetation-shading': return { value: 12 + 26 * s, unit: 'deg' } // sombra quando o Sol está abaixo disto
    case 'object-shading': return { value: 30 + 55 * s, unit: 'pct' }
    case 'loose-connector': return { value: 8 + 40 * s, unit: 'dropChance' } // chance de queda nos horários de pico
    case 'hotspot': return { value: 5 + 15 * s, unit: 'pct' }
    case 'open-string': return { value: 100, unit: 'pct' }
    case 'grid-overvoltage': return { value: 90 - 45 * s, unit: 'tripLoad' } // carga do inversor que dispara a proteção
    case 'inverter-derating': return { value: 90 - 40 * s, unit: 'powerCap' } // teto de potência por temperatura
    case 'inverter-offline': return { value: 100, unit: 'pct' }
    case 'pid': return { value: 4 + 16 * s, unit: 'pct' }
    case 'aging': return { value: Math.round(1 + 24 * s), unit: 'years' }
    case 'string-short': return { value: 1 + Math.round(2 * s), unit: 'modules' }
  }
}

/**
 * Fração da sujeira que uma chuva lava. Abaixo de ~5 mm a chuva só umedece a poeira;
 * acima de ~35 mm lava quase tudo o que sai sem escovação (~80 %).
 */
export function rainWashFraction(mm: number): number {
  return Math.max(0, Math.min(0.8, (mm - 5) / 37.5))
}

export const DEMO_FAULTS: FaultInjection[] = [
  { id: 'demo-soiling', kind: 'soiling-uniform', target: null, severity: 0.12, sinceDaysAgo: 7 },
  { id: 'demo-hotspot', kind: 'hotspot', target: 'B3', severity: 0.5, sinceDaysAgo: 4 },
  { id: 'demo-grid', kind: 'grid-overvoltage', target: 'INV-B', severity: 0.25, sinceDaysAgo: 3 },
]

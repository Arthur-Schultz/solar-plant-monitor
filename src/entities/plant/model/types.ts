import type { InverterSpec, ModuleSpec } from '@/shared/lib/solar'

export interface StringConfig {
  id: string
  inverterId: string
  /** Mesa física (1 string = 1 mesa de 2×10 módulos em retrato) */
  tableIndex: number
  /** Fileira (0 = mais ao norte, sem sombra de outra fileira) */
  row: number
  modules: number
}

export interface InverterConfig extends InverterSpec {
  id: string
  label: string
  model: string
  mppts: number
}

export interface PlantEconomics {
  /** Tarifa cheia com impostos (R$/kWh) — Cemig B2 Rural, valor estimado */
  tariffRsPerKwh: number
  /** Componente TUSD Fio B (R$/kWh) — estimado */
  fioBRsPerKwh: number
  /** Fração do Fio B cobrada sobre a energia injetada em 2026 (Lei 14.300, GD II) */
  fioBChargedFraction: number
  /** Fração da geração consumida no instante (não injetada) — ordenha/resfriador de leite */
  simultaneousConsumption: number
  /** Custo de uma limpeza completa (R$) */
  cleaningCostRs: number
}

export interface PlantConfig {
  id: string
  name: string
  locationLabel: string
  latitude: number
  longitude: number
  altitudeM: number
  timezone: string
  module: ModuleSpec & { model: string }
  inverters: InverterConfig[]
  strings: StringConfig[]
  layout: {
    /** Módulos por mesa na horizontal e na vertical (retrato) */
    modulesAcross: number
    modulesHigh: number
    /** Distância entre fileiras (m) */
    pitchM: number
    /** Altura da borda inferior da mesa ao solo (m) */
    clearanceM: number
    /** Espaço entre as duas colunas de mesas (m) */
    columnGapM: number
  }
  /** Inclinação padrão (graus) — ajustável sazonalmente na estrutura */
  defaultTiltDeg: number
  tiltRangeDeg: [number, number]
  /** Azimute da face dos módulos (0 = norte) */
  surfaceAzimuthDeg: number
  albedo: number
  systemLosses: number
  economics: PlantEconomics
}

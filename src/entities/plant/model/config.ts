import type { PlantConfig, StringConfig } from './types'

/**
 * Usina de referência (simulação). Todos os parâmetros são valores típicos de mercado,
 * documentados aqui para que possam ser substituídos por dados reais de projeto.
 *
 * 160 módulos × 470 Wp = 75,2 kWp CC
 * 2 inversores × 30 kW = 60 kW CA → razão CC/CA 1,25 → microgeração (≤ 75 kW CA, Lei 14.300)
 * 8 strings de 20 módulos (4 por inversor, 2 por MPPT); cada string ocupa uma mesa 2P×10.
 */
const strings: StringConfig[] = ['INV-A', 'INV-B'].flatMap((inverterId, invIdx) =>
  Array.from({ length: 4 }, (_, i) => ({
    id: `${inverterId.slice(-1)}${i + 1}`,
    inverterId,
    tableIndex: invIdx * 4 + i,
    row: i,
    modules: 20,
  })),
)

export const PLANT: PlantConfig = {
  id: 'ufv-rio-do-peixe',
  name: 'UFV Fazenda Rio do Peixe',
  locationLabel: 'Torreões · Juiz de Fora – MG',
  latitude: -21.8628,
  longitude: -43.5406,
  altitudeM: 560,
  timezone: 'America/Sao_Paulo',
  module: {
    model: 'Mono PERC half-cell 470 Wp (parâmetros típicos)',
    pmaxW: 470,
    gammaPmaxPctPerC: -0.34,
    noctC: 45,
    lengthM: 2.094,
    widthM: 1.134,
  },
  inverters: [
    { id: 'INV-A', label: 'Inversor A', model: 'Trifásico 380 V · 30 kW', pacMaxW: 30_000, efficiency: 0.982, mppts: 3 },
    { id: 'INV-B', label: 'Inversor B', model: 'Trifásico 380 V · 30 kW', pacMaxW: 30_000, efficiency: 0.982, mppts: 3 },
  ],
  strings,
  layout: {
    modulesAcross: 10,
    modulesHigh: 2,
    pitchM: 7.5,
    clearanceM: 0.6,
    columnGapM: 4,
  },
  defaultTiltDeg: 22,
  tiltRangeDeg: [5, 40],
  surfaceAzimuthDeg: 0,
  albedo: 0.2,
  systemLosses: 0.06,
  economics: {
    tariffRsPerKwh: 0.88,
    fioBRsPerKwh: 0.27,
    fioBChargedFraction: 0.6,
    simultaneousConsumption: 0.3,
    cleaningCostRs: 450,
  },
}

export const nameplateDcW = (plant: PlantConfig) =>
  plant.strings.reduce((acc, s) => acc + s.modules * plant.module.pmaxW, 0)

export const nameplateAcW = (plant: PlantConfig) =>
  plant.inverters.reduce((acc, i) => acc + i.pacMaxW, 0)

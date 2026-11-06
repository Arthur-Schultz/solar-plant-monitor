import type { PlantEconomics } from '../model/types'

/**
 * Valor efetivo de cada kWh gerado (R$/kWh).
 * - Parcela consumida no instante: evita a tarifa cheia.
 * - Parcela injetada: vira crédito, mas paga a fração vigente do Fio B (Lei 14.300, GD II).
 */
export function effectiveValuePerKwh(e: PlantEconomics): number {
  const injected = 1 - e.simultaneousConsumption
  return e.tariffRsPerKwh - injected * e.fioBRsPerKwh * e.fioBChargedFraction
}

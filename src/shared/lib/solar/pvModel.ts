/**
 * Modelo de potência FV de primeira ordem (PVWatts-like), com cada perda explícita
 * para que o dashboard consiga mostrar "para onde foi a energia".
 */

export interface ModuleSpec {
  /** Potência nominal STC (W) */
  pmaxW: number
  /** Coeficiente térmico de Pmax (%/°C) — tipicamente −0,29 a −0,40 */
  gammaPmaxPctPerC: number
  /** Temperatura nominal de operação da célula (°C) */
  noctC: number
  /** Dimensões (m) — usadas na maquete e na geometria de sombreamento */
  lengthM: number
  widthM: number
}

export interface InverterSpec {
  /** Potência nominal CA (W) */
  pacMaxW: number
  /** Eficiência europeia (0–1) */
  efficiency: number
}

/**
 * Temperatura de célula pelo modelo NOCT com correção por vento simples.
 * NOCT é medido a 800 W/m², 20 °C ambiente, 1 m/s de vento.
 */
export function cellTemperature(
  poa: number,
  ambientC: number,
  noctC: number,
  windMs = 1,
): number {
  const windFactor = 9.5 / (5.7 + 3.8 * Math.max(0, windMs))
  return ambientC + (poa / 800) * (noctC - 20) * windFactor * (1 - 0.2 / 0.9)
}

/** Fator multiplicativo devido à temperatura (1 = sem perda, <1 = perda). */
export function temperatureFactor(cellC: number, gammaPctPerC: number): number {
  return 1 + (gammaPctPerC / 100) * (cellC - 25)
}

/** Perda por reflexão em ângulos rasantes (modelo ASHRAE, b0 = 0,05). */
export function incidenceAngleModifier(aoiDeg: number): number {
  if (aoiDeg >= 89) return 0
  const iam = 1 - 0.05 * (1 / Math.cos((aoiDeg * Math.PI) / 180) - 1)
  return Math.max(0, Math.min(1, iam))
}

export interface DcPowerInput {
  poaBeam: number
  poaDiffuse: number
  aoiDeg: number
  ambientC: number
  windMs: number
  nameplateW: number
  module: ModuleSpec
  /** Fração do feixe direto bloqueada por sombra de outras fileiras (0–1) */
  shadingFraction: number
  /** Perda por sujidade (0–1) */
  soilingLoss: number
  /** Perdas DC fixas: mismatch, cabos, LID, degradação (0–1) */
  systemLosses: number
}

export interface DcPowerBreakdown {
  /** Potência DC efetiva (W) */
  dcW: number
  /** Irradiância efetiva após sombra e IAM (W/m²) */
  effectivePoa: number
  cellC: number
  /** Potência que existiria sem perda térmica (W) — base para quantificar a perda */
  dcAt25CW: number
  thermalLossW: number
  shadingLossW: number
  soilingLossW: number
}

export function dcPower(input: DcPowerInput): DcPowerBreakdown {
  const iam = incidenceAngleModifier(input.aoiDeg)
  const beamUnshaded = input.poaBeam * iam
  const beam = beamUnshaded * (1 - input.shadingFraction)
  const poaNoShade = beamUnshaded + input.poaDiffuse
  const effectivePoa = beam + input.poaDiffuse

  const cellC = cellTemperature(effectivePoa, input.ambientC, input.module.noctC, input.windMs)
  const tf = temperatureFactor(cellC, input.module.gammaPmaxPctPerC)

  const base = input.nameplateW / 1000
  const clean = 1 - input.soilingLoss
  const sys = 1 - input.systemLosses

  const dcAt25CW = base * effectivePoa * clean * sys
  const dcW = Math.max(0, dcAt25CW * tf)

  return {
    dcW,
    effectivePoa,
    cellC,
    dcAt25CW,
    thermalLossW: Math.max(0, dcAt25CW - dcW),
    shadingLossW: Math.max(0, base * (poaNoShade - effectivePoa) * clean * sys * tf),
    soilingLossW: Math.max(0, base * effectivePoa * input.soilingLoss * sys * tf),
  }
}

/**
 * Conversão CC→CA com curva de eficiência simplificada e limitação (clipping) na
 * potência nominal. Com razão CC/CA de 1,25 o clipping ocorre em dias muito limpos.
 */
export function acPower(dcW: number, inverter: InverterSpec): { acW: number; clippedW: number } {
  if (dcW <= 0) return { acW: 0, clippedW: 0 }
  const loadRatio = dcW / inverter.pacMaxW
  // Eficiência cai em carga baixa (perdas fixas de autoconsumo)
  const eff = inverter.efficiency * (1 - 0.004 / Math.max(loadRatio, 0.02))
  const raw = Math.max(0, dcW * eff)
  const acW = Math.min(raw, inverter.pacMaxW)
  return { acW, clippedW: raw - acW }
}

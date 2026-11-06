import {
  acPower,
  dcPower,
  erbsDecomposition,
  extraterrestrialIrradiance,
  interRowShadingFraction,
  planeOfArray,
  sunPosition,
} from '@/shared/lib/solar'
import type { PlantConfig } from '../model/types'

/** Entrada meteorológica mínima (tipagem estrutural — não acopla à entidade weather). */
export interface MeteoInput {
  t: number
  ghi: number
  dni?: number
  dhi?: number
  tempC: number
  windMs: number
}

export interface StringExpectation {
  stringId: string
  dcW: number
  shadingFraction: number
}

export interface ExpectedSample {
  t: number
  sunElevation: number
  sunAzimuth: number
  ghi: number
  poa: number
  ambientC: number
  cellC: number
  /** Potência CA esperada da usina limpa e saudável (W) */
  acW: number
  /** Potência CA esperada por inversor (W) */
  inverterAcW: Record<string, number>
  strings: StringExpectation[]
  /** Perdas (W) — usadas no gráfico de cascata/decomposição */
  thermalLossW: number
  shadingLossW: number
  clippedW: number
}

export interface ExpectedModelOptions {
  tiltDeg: number
  /** Perda por sujeira aplicada ao modelo (0 = referência limpa) */
  soilingLoss?: number
}

/**
 * Modelo físico da usina: clima → posição solar → irradiância no plano → potência CC
 * por string (com sombreamento por fileira) → potência CA por inversor (com clipping).
 *
 * Observação: o Open-Meteo entrega a média da hora ANTERIOR ao carimbo de tempo; o
 * reamostrador da entidade weather já centraliza os valores, então aqui `t` é instantâneo.
 */
export function computeExpected(
  plant: PlantConfig,
  meteo: MeteoInput[],
  { tiltDeg, soilingLoss = 0 }: ExpectedModelOptions,
): ExpectedSample[] {
  const moduleSlopeLength = plant.module.lengthM * plant.layout.modulesHigh

  return meteo.map((m) => {
    const date = new Date(m.t)
    const sun = sunPosition(date, plant.latitude, plant.longitude)
    const components =
      m.dni !== undefined && m.dhi !== undefined
        ? { ghi: m.ghi, dni: m.dni, dhi: m.dhi }
        : erbsDecomposition(m.ghi, sun.zenith, extraterrestrialIrradiance(date))

    const poa = planeOfArray(
      components, sun.zenith, sun.azimuth, tiltDeg, plant.surfaceAzimuthDeg, plant.albedo,
    )
    const rowShade = interRowShadingFraction(
      sun.elevation, sun.azimuth, tiltDeg, plant.surfaceAzimuthDeg,
      moduleSlopeLength, plant.layout.pitchM,
    )

    let thermalLossW = 0
    let shadingLossW = 0
    let cellC = m.tempC

    const strings: StringExpectation[] = plant.strings.map((s) => {
      // A fileira da frente (row 0) não recebe sombra de outra fileira
      const shadingFraction = s.row === 0 ? 0 : rowShade
      const r = dcPower({
        poaBeam: poa.beam,
        poaDiffuse: poa.diffuse + poa.ground,
        aoiDeg: poa.aoi,
        ambientC: m.tempC,
        windMs: m.windMs,
        nameplateW: s.modules * plant.module.pmaxW,
        module: plant.module,
        shadingFraction,
        soilingLoss,
        systemLosses: plant.systemLosses,
      })
      thermalLossW += r.thermalLossW
      shadingLossW += r.shadingLossW
      cellC = Math.max(cellC, r.cellC)
      return { stringId: s.id, dcW: r.dcW, shadingFraction }
    })

    let acW = 0
    let clippedW = 0
    const inverterAcW: Record<string, number> = {}
    for (const inv of plant.inverters) {
      const dc = strings
        .filter((_, i) => plant.strings[i].inverterId === inv.id)
        .reduce((a, s) => a + s.dcW, 0)
      const ac = acPower(dc, inv)
      inverterAcW[inv.id] = ac.acW
      acW += ac.acW
      clippedW += ac.clippedW
    }

    return {
      t: m.t,
      sunElevation: sun.elevation,
      sunAzimuth: sun.azimuth,
      ghi: m.ghi,
      poa: poa.poa,
      ambientC: m.tempC,
      cellC,
      acW,
      inverterAcW,
      strings,
      thermalLossW,
      shadingLossW,
      clippedW,
    }
  })
}

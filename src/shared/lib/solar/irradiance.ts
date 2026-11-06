import { DEG, RAD } from './sunPosition'

export interface IrradianceComponents {
  /** Irradiância global horizontal (W/m²) */
  ghi: number
  /** Irradiância direta normal (W/m²) */
  dni: number
  /** Irradiância difusa horizontal (W/m²) */
  dhi: number
}

export interface PlaneOfArrayIrradiance {
  /** Total no plano dos módulos (W/m²) */
  poa: number
  beam: number
  diffuse: number
  ground: number
  /** Ângulo de incidência entre o Sol e a normal do módulo (graus) */
  aoi: number
}

/** Modelo de céu claro de Haurwitz (1945): GHI apenas função do zênite. */
export function clearSkyGhi(zenithDeg: number): number {
  const cosZ = Math.cos(zenithDeg * DEG)
  if (cosZ <= 0) return 0
  return 1098 * cosZ * Math.exp(-0.057 / cosZ)
}

/**
 * Decomposição de Erbs et al. (1982): estima DHI/DNI a partir de GHI e do índice
 * de claridade kt. Usado quando a fonte meteorológica só fornece GHI.
 */
export function erbsDecomposition(
  ghi: number,
  zenithDeg: number,
  extraterrestrial: number,
): IrradianceComponents {
  const cosZ = Math.cos(zenithDeg * DEG)
  if (ghi <= 0 || cosZ <= 0.017) return { ghi: Math.max(0, ghi), dni: 0, dhi: Math.max(0, ghi) }

  const kt = Math.min(ghi / (extraterrestrial * cosZ), 1)
  let kd: number
  if (kt <= 0.22) kd = 1 - 0.09 * kt
  else if (kt <= 0.8)
    kd = 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4
  else kd = 0.165

  const dhi = kd * ghi
  const dni = Math.max(0, (ghi - dhi) / cosZ)
  return { ghi, dni, dhi }
}

/** Cosseno do ângulo de incidência entre o raio solar e a normal do módulo. */
export function cosAngleOfIncidence(
  sunZenithDeg: number,
  sunAzimuthDeg: number,
  tiltDeg: number,
  surfaceAzimuthDeg: number,
): number {
  const z = sunZenithDeg * DEG
  const t = tiltDeg * DEG
  return (
    Math.cos(z) * Math.cos(t) +
    Math.sin(z) * Math.sin(t) * Math.cos((sunAzimuthDeg - surfaceAzimuthDeg) * DEG)
  )
}

/**
 * Transposição para o plano inclinado — modelo isotrópico de Liu & Jordan.
 * Simples e explicável; o modelo de Perez seria a evolução natural (~2–4 % mais preciso).
 */
export function planeOfArray(
  components: IrradianceComponents,
  sunZenithDeg: number,
  sunAzimuthDeg: number,
  tiltDeg: number,
  surfaceAzimuthDeg: number,
  albedo = 0.2,
): PlaneOfArrayIrradiance {
  const cosAoi = cosAngleOfIncidence(sunZenithDeg, sunAzimuthDeg, tiltDeg, surfaceAzimuthDeg)
  const sunUp = sunZenithDeg < 90
  const beam = sunUp ? Math.max(0, components.dni * cosAoi) : 0
  const t = tiltDeg * DEG
  const diffuse = components.dhi * (1 + Math.cos(t)) / 2
  const ground = components.ghi * albedo * (1 - Math.cos(t)) / 2
  return {
    poa: beam + diffuse + ground,
    beam,
    diffuse,
    ground,
    aoi: Math.acos(Math.max(-1, Math.min(1, cosAoi))) * RAD,
  }
}

/**
 * Fração sombreada de uma fileira pela fileira da frente (geometria 2D no plano de perfil).
 * Retorna 0 (sem sombra) a 1 (fileira totalmente sombreada).
 *
 * @param rowLength comprimento inclinado da mesa (m)
 * @param pitch distância entre fileiras, de borda a borda equivalente (m)
 */
export function interRowShadingFraction(
  sunElevationDeg: number,
  sunAzimuthDeg: number,
  tiltDeg: number,
  surfaceAzimuthDeg: number,
  rowLength: number,
  pitch: number,
): number {
  if (sunElevationDeg <= 0) return 1
  const relAz = (sunAzimuthDeg - surfaceAzimuthDeg) * DEG
  const cosRel = Math.cos(relAz)
  // Sol atrás do plano dos módulos: não há sombra mútua relevante (o feixe já é ~0)
  if (cosRel <= 0) return 0
  const profile = Math.atan(Math.tan(sunElevationDeg * DEG) / cosRel)
  const t = tiltDeg * DEG
  const unshaded = (pitch * Math.sin(profile)) / (rowLength * Math.sin(profile + t))
  return Math.max(0, Math.min(1, 1 - unshaded))
}

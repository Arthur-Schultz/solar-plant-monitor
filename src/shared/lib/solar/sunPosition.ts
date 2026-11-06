/**
 * Posição aparente do Sol (algoritmo simplificado NOAA / Astronomical Almanac).
 * Precisão ~0,01° em elevação para 1950–2050 — suficiente para modelagem FV e sombras.
 *
 * Convenções:
 *  - azimute em graus a partir do NORTE, sentido horário (N=0, L=90, S=180, O=270)
 *  - elevação em graus acima do horizonte (negativa = noite)
 */
export interface SunPosition {
  elevation: number
  azimuth: number
  /** Ângulo zenital = 90 − elevação */
  zenith: number
  /** Declinação solar (graus) — útil para depuração/visualização */
  declination: number
}

export const DEG = Math.PI / 180
export const RAD = 180 / Math.PI

const mod = (a: number, n: number) => ((a % n) + n) % n

export function julianDay(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5
}

export function sunPosition(date: Date, latitude: number, longitude: number): SunPosition {
  const n = julianDay(date) - 2_451_545.0

  const meanLongitude = mod(280.46 + 0.9856474 * n, 360)
  const meanAnomaly = mod(357.528 + 0.9856003 * n, 360) * DEG
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG
  const obliquity = (23.439 - 0.0000004 * n) * DEG

  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  )
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude))

  // Tempo sideral médio de Greenwich (horas) → ângulo horário local
  const gmstHours = mod(18.697374558 + 24.06570982441908 * n, 24)
  const localSiderealDeg = gmstHours * 15 + longitude
  const hourAngle = (localSiderealDeg * DEG - rightAscension)

  const lat = latitude * DEG
  const sinEl =
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle)
  let elevation = Math.asin(Math.max(-1, Math.min(1, sinEl))) * RAD

  // Refração atmosférica (Bennett) — relevante só perto do horizonte
  if (elevation > -1) {
    elevation += 1.02 / Math.tan((elevation + 10.3 / (elevation + 5.11)) * DEG) / 60
  }

  const azimuth = mod(
    Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(lat) - Math.tan(declination) * Math.cos(lat),
    ) * RAD + 180,
    360,
  )

  return { elevation, azimuth, zenith: 90 - elevation, declination: declination * RAD }
}

/** Irradiância extraterrestre normal (W/m²) com correção da excentricidade da órbita. */
export function extraterrestrialIrradiance(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  const dayOfYear = Math.floor((date.getTime() - start) / 86_400_000)
  return 1361 * (1 + 0.033 * Math.cos((2 * Math.PI * dayOfYear) / 365))
}

/** Converte azimute/elevação em vetor unitário (x = leste, y = cima, z = sul). */
export function sunVector(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = azimuthDeg * DEG
  const el = elevationDeg * DEG
  return [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)]
}

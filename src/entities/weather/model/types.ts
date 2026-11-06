/** Amostra meteorológica instantânea (já reamostrada para 15 min). */
export interface WeatherSample {
  /** Instante (ms, UTC) */
  t: number
  /** Irradiância global horizontal (W/m²) */
  ghi: number
  /** Direta normal (W/m²) */
  dni: number
  /** Difusa horizontal (W/m²) */
  dhi: number
  tempC: number
  /** Nebulosidade total (%) */
  cloudCover: number
  windMs: number
  /** Precipitação acumulada no intervalo (mm) */
  precipMm: number
}

/** Formato horário bruto, comum às fontes (API e sintética). */
export interface HourlyWeather {
  /** Fim do intervalo horário (ms UTC). Valores de radiação são média da hora anterior. */
  t: number[]
  ghi: number[]
  dni: number[]
  dhi: number[]
  tempC: number[]
  cloudCover: number[]
  windMs: number[]
  precipMm: number[]
}

export type WeatherSource = 'open-meteo' | 'cache' | 'synthetic'

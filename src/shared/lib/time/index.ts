export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

const formatters = new Map<string, Intl.DateTimeFormat>()
const offsetCache = new Map<string, number>()

/** Deslocamento do fuso (minutos) em relação ao UTC, ex.: America/Sao_Paulo → −180. Memoizado por hora. */
export function tzOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  const key = `${timeZone}|${Math.floor(at.getTime() / HOUR)}`
  const hit = offsetCache.get(key)
  if (hit !== undefined) return hit

  let fmt = formatters.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    formatters.set(timeZone, fmt)
  }
  const part = fmt.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value
  const m = part?.match(/GMT([+-])(\d{2}):?(\d{2})?/)
  const value = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0
  if (offsetCache.size > 5000) offsetCache.clear()
  offsetCache.set(key, value)
  return value
}

/** Início do dia local (ms UTC) que contém o instante `t`. */
export function startOfLocalDay(t: number, timeZone: string): number {
  const off = tzOffsetMinutes(timeZone, new Date(t)) * MINUTE
  return Math.floor((t + off) / DAY) * DAY - off
}

/** Hora local decimal (0–24) do instante `t`. */
export function localHour(t: number, timeZone: string): number {
  return (t - startOfLocalDay(t, timeZone)) / HOUR
}

/** PRNG determinístico (mulberry32) — simulações reprodutíveis entre renders. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

import type { Diagnostic } from '../model/types'

interface Formatter {
  num: (v: number, digits?: number) => string
  brl: (v: number) => string
  day: (t: number) => string
  dateTime: (t: number) => string
}

const MONEY = new Set(['rsDay', 'rs', 'cost'])
const DATES = new Set(['start'])
const DAYS = new Set(['since', 'rainDay', 'day'])

/** Formata os parâmetros de um diagnóstico no idioma ativo (moeda, datas, decimais). */
export function formatDiagnosticParams(params: Diagnostic['params'], fmt: Formatter): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => {
      if (MONEY.has(k)) return [k, fmt.brl(Number(v))]
      if (DATES.has(k)) return [k, fmt.dateTime(Number(v))]
      if (DAYS.has(k)) return [k, fmt.day(Number(v))]
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) {
        const decimals = v.includes('.') ? v.split('.')[1].length : 0
        return [k, fmt.num(Number(v), decimals)]
      }
      if (typeof v === 'number' && !Number.isInteger(v)) return [k, fmt.num(v, 2)]
      return [k, v]
    }),
  )
}

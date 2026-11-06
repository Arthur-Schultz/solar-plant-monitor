import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/** Formatadores Intl memoizados por idioma — números tabulares e fuso da usina. */
export function useFormat(timeZone: string) {
  const { i18n } = useTranslation()
  const lng = i18n.language

  return useMemo(() => {
    const cache = new Map<number, Intl.NumberFormat>()
    const nf = (d: number) => {
      let f = cache.get(d)
      if (!f) {
        f = new Intl.NumberFormat(lng, { minimumFractionDigits: d, maximumFractionDigits: d })
        cache.set(d, f)
      }
      return f
    }
    const brl = new Intl.NumberFormat(lng, { style: 'currency', currency: 'BRL' })
    const time = new Intl.DateTimeFormat(lng, { timeZone, hour: '2-digit', minute: '2-digit' })
    const day = new Intl.DateTimeFormat(lng, { timeZone, day: '2-digit', month: '2-digit' })
    const weekday = new Intl.DateTimeFormat(lng, { timeZone, weekday: 'short', day: '2-digit' })
    const dateTime = new Intl.DateTimeFormat(lng, { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

    return {
      num: (v: number, digits = 1) => (Number.isFinite(v) ? nf(digits).format(v) : '—'),
      brl: (v: number) => brl.format(v),
      time: (t: number) => time.format(t),
      day: (t: number) => day.format(t),
      weekday: (t: number) => weekday.format(t),
      dateTime: (t: number) => dateTime.format(t),
    }
  }, [lng, timeZone])
}

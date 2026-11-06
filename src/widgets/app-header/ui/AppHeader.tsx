import { useTranslation } from 'react-i18next'
import { PLANT, nameplateAcW, nameplateDcW } from '@/entities/plant'
import { useWeatherStore } from '@/entities/weather'
import { LanguageSwitch } from '@/features/language-switch'
import { useFormat } from '@/shared/lib/format/useFormat'

export function AppHeader({ now }: { now: number }) {
  const { t } = useTranslation()
  const fmt = useFormat(PLANT.timezone)
  const source = useWeatherStore((s) => s.source)
  const status = useWeatherStore((s) => s.status)
  const load = useWeatherStore((s) => s.load)

  return (
    <header className="app-header">
      <div className="brand">
        <svg viewBox="0 0 32 32" className="brand__mark" aria-hidden>
          <circle cx="16" cy="11" r="5" fill="#c98500" />
          <path d="M4 26 L10 17 H22 L28 26 Z" fill="#1c5cab" />
          <path d="M10 17 L8 26 M16 17 V26 M22 17 L24 26 M7 21.5 H25" stroke="#0d1218" strokeWidth="1.2" />
        </svg>
        <div>
          <h1>{PLANT.name}</h1>
          <p>
            {PLANT.locationLabel} · {fmt.num(nameplateDcW(PLANT) / 1000, 1)} kWp / {fmt.num(nameplateAcW(PLANT) / 1000, 0)} kW · {t('app.subtitle')}
          </p>
        </div>
      </div>

      <div className="header-meta">
        <span className="pill pill--sim">{t('app.simulatedBadge')}</span>
        {source && (
          <button
            type="button"
            className={`pill ${source === 'synthetic' ? 'pill--warn' : 'pill--live'}`}
            onClick={() => void load(PLANT.latitude, PLANT.longitude, PLANT.timezone, { force: true })}
            title={t('app.reload')}
            disabled={status === 'loading'}
          >
            {t(`app.weatherSource.${source}`)} ↻
          </button>
        )}
        <span className="pill">{t('app.telemetrySource')}</span>
        <span className="clock tnum">{fmt.time(now)}</span>
        <LanguageSwitch />
      </div>
    </header>
  )
}

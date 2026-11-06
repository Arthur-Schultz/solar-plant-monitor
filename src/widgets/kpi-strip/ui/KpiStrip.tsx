import { useTranslation } from 'react-i18next'
import { effectiveValuePerKwh, PLANT } from '@/entities/plant'
import type { PlantKpis } from '@/features/plant-monitoring'
import { useFormat } from '@/shared/lib/format/useFormat'

interface TileProps {
  label: string
  value: string
  unit?: string
  hint?: string
  accent?: 'measured' | 'expected'
  progress?: number
}

function Tile({ label, value, unit, hint, accent, progress }: TileProps) {
  return (
    <div className={`kpi ${accent ? `kpi--${accent}` : ''}`}>
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {progress !== undefined && (
        <span className="kpi__bar" aria-hidden>
          <span style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
        </span>
      )}
      {hint && <span className="kpi__hint">{hint}</span>}
    </div>
  )
}

export function KpiStrip({ kpis }: { kpis: PlantKpis }) {
  const { t } = useTranslation()
  const fmt = useFormat(PLANT.timezone)
  const ratio = kpis.expectedSoFarKwh > 0 ? kpis.energyTodayKwh / kpis.expectedSoFarKwh : 0

  return (
    <div className="kpi-strip">
      <Tile
        label={t('kpi.power')}
        value={fmt.num(kpis.powerKw, 1)}
        unit="kW"
        accent="measured"
        progress={kpis.powerKw / 60}
        hint={t('kpi.expectedShort', { value: fmt.num(kpis.expectedPowerKw, 1) })}
      />
      <Tile
        label={t('kpi.energyToday')}
        value={fmt.num(kpis.energyTodayKwh, 0)}
        unit="kWh"
        progress={ratio}
        hint={t('kpi.ofExpected', { pct: fmt.num(ratio * 100, 0) })}
      />
      <Tile
        label={t('kpi.savings')}
        value={fmt.brl(kpis.savingsTodayRs)}
        hint={t('kpi.savingsHint', { value: fmt.brl(effectiveValuePerKwh(PLANT.economics)) })}
      />
      <Tile
        label={t('kpi.pr')}
        value={kpis.performanceRatioToday > 0 ? fmt.num(kpis.performanceRatioToday * 100, 1) : '—'}
        unit="%"
        hint={t('kpi.prHint')}
      />
      <Tile
        label={t('kpi.forecastDay')}
        value={fmt.num(kpis.expectedFullDayKwh, 0)}
        unit="kWh"
        accent="expected"
        hint={t('kpi.forecastHint')}
      />
    </div>
  )
}

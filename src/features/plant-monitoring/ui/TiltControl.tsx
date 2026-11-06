import { useTranslation } from 'react-i18next'
import { PLANT } from '@/entities/plant'
import { useFormat } from '@/shared/lib/format/useFormat'
import { useMonitoringStore } from '../model/store'

/** Ajuste sazonal da inclinação: recalcula o modelo e mostra o impacto na energia do dia. */
export function TiltControl({ expectedDayKwh }: { expectedDayKwh: number }) {
  const { t } = useTranslation()
  const fmt = useFormat(PLANT.timezone)
  const tilt = useMonitoringStore((s) => s.tiltDeg)
  const setTilt = useMonitoringStore((s) => s.setTilt)
  const [min, max] = PLANT.tiltRangeDeg

  return (
    <div className="control-card">
      <div className="control-card__head">
        <strong>{t('tilt.title')}</strong>
        <span className="tnum big">{tilt}°</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={tilt}
        onChange={(e) => setTilt(Number(e.target.value))}
        aria-label={t('tilt.title')}
      />
      <p className="muted small">{t('tilt.hint', { min, max })}</p>
      <p className="tilt-result">
        {t('tilt.expected', { tilt })}: <b className="tnum">{fmt.num(expectedDayKwh, 0)} kWh</b>
      </p>
    </div>
  )
}

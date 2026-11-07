import { useTranslation } from 'react-i18next'
import { PLANT } from '@/entities/plant'
import type { InverterEvent, InverterStatus, TelemetrySample } from '@/entities/telemetry'
import { useMonitoringStore } from '@/features/plant-monitoring'
import { useFormat } from '@/shared/lib/format/useFormat'
import { startOfLocalDay } from '@/shared/lib/time'
import { Panel, StatusBadge } from '@/shared/ui'

const STATUS_LEVEL: Record<InverterStatus, 'ok' | 'idle' | 'critical' | 'warning'> = {
  producing: 'ok',
  standby: 'idle',
  fault: 'critical',
  offline: 'warning',
}

interface Props {
  measured: TelemetrySample[]
  events: InverterEvent[]
  now: number
}

export function InverterPanel({ measured, events, now }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat(PLANT.timezone)
  const selected = useMonitoringStore((s) => s.selectedTarget)
  const select = useMonitoringStore((s) => s.select)
  const today = startOfLocalDay(now, PLANT.timezone)
  const last = measured.at(-1)

  return (
    <Panel title={t('inverter.title')} subtitle={`2 × ${PLANT.inverters[0].model}`}>
      <div className="inverters">
        {PLANT.inverters.map((inv) => {
          const r = last?.inverters[inv.id]
          const energy = measured
            .filter((m) => m.t >= today)
            .reduce((a, m) => a + (m.inverters[inv.id]?.acW ?? 0) / 1000 / 4, 0)
          const status = r?.status ?? 'offline'
          const load = (r?.acW ?? 0) / inv.pacMaxW
          return (
            <button
              key={inv.id}
              type="button"
              className={`inverter ${selected === inv.id ? 'is-selected' : ''}`}
              onClick={() => select(inv.id)}
            >
              <div className="inverter__head">
                <strong>{inv.label}</strong>
                <StatusBadge level={STATUS_LEVEL[status]} label={t(`inverter.status.${status}`)} />
              </div>
              <div className="inverter__power">
                {fmt.num((r?.acW ?? 0) / 1000, 1)}
                <small> kW {t('inverter.ac')}</small>
              </div>
              <div className="inverter__load" aria-label={`${t('inverter.load')} ${fmt.num(load * 100, 0)}%`}>
                <span style={{ width: `${Math.min(100, load * 100)}%` }} />
              </div>
              <dl className="inverter__stats">
                <div><dt>{t('inverter.today')}</dt><dd>{fmt.num(energy, 0)} kWh</dd></div>
                <div><dt>{t('inverter.dc')}</dt><dd>{fmt.num((r?.dcW ?? 0) / 1000, 1)} kW</dd></div>
                <div><dt>{t('inverter.heatsink')}</dt><dd>{fmt.num(r?.heatsinkC ?? 0, 0)} °C</dd></div>
              </dl>
            </button>
          )
        })}
      </div>

      <h3 className="subhead">{t('inverter.events')}</h3>
      {events.length === 0 ? (
        <p className="muted">{t('inverter.noEvents')}</p>
      ) : (
        <ul className="events">
          {[...events].reverse().slice(0, 6).map((e) => (
            <li key={`${e.t}-${e.code}`}>
              <StatusBadge level={e.severity === 'critical' ? 'critical' : e.severity === 'warning' ? 'warning' : 'info'} label={e.code} />
              <span className="events__time">{fmt.dateTime(e.t)}</span>
              <span>{e.inverterId} · {t(e.messageKey)}</span>
            </li>
          ))}
        </ul>
      )}
      {events.length > 6 && <p className="muted small events__more">{t('inverter.moreEvents', { count: events.length - 6 })}</p>}
    </Panel>
  )
}

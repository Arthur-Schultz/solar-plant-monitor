import { useTranslation } from 'react-i18next'
import { PLANT } from '@/entities/plant'
import type { Diagnostic } from '@/features/plant-diagnostics'
import { useMonitoringStore } from '@/features/plant-monitoring'
import { useFormat } from '@/shared/lib/format/useFormat'
import { Panel, StatusBadge } from '@/shared/ui'

const MONEY = new Set(['rsDay', 'rs', 'cost'])
const DATES = new Set(['start'])
const DAYS = new Set(['since'])

export function DiagnosticsPanel({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const { t } = useTranslation()
  const fmt = useFormat(PLANT.timezone)
  const selected = useMonitoringStore((s) => s.selectedTarget)
  const select = useMonitoringStore((s) => s.select)

  const format = (params: Diagnostic['params']) =>
    Object.fromEntries(
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

  return (
    <Panel title={t('diag.title')}>
      <ul className="diagnostics">
        {diagnostics.map((d) => {
          const params = format(d.params)
          const clickable = !!d.target
          return (
            <li
              key={d.id}
              className={`diag diag--${d.severity} ${d.target && d.target === selected ? 'is-selected' : ''}`}
            >
              <button type="button" disabled={!clickable} onClick={() => d.target && select(d.target)}>
                <div className="diag__head">
                  <StatusBadge level={d.severity} label={t(`diag.severity.${d.severity}`)} />
                  <strong>{t(d.titleKey, params)}</strong>
                </div>
                <p>{t(d.messageKey, params)}</p>
              </button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

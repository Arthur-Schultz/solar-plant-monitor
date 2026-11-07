import { useTranslation } from 'react-i18next'
import { PLANT } from '@/entities/plant'
import { formatDiagnosticParams, type Diagnostic } from '@/features/plant-diagnostics'
import { useMonitoringStore } from '@/features/plant-monitoring'
import { useFormat } from '@/shared/lib/format/useFormat'
import { Panel, StatusBadge } from '@/shared/ui'

export function DiagnosticsPanel({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const { t } = useTranslation()
  const fmt = useFormat(PLANT.timezone)
  const selected = useMonitoringStore((s) => s.selectedTarget)
  const select = useMonitoringStore((s) => s.select)

  const format = (params: Diagnostic['params']) => formatDiagnosticParams(params, fmt)

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

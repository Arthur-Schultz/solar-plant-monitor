import { useTranslation } from 'react-i18next'
import { PLANT } from '@/entities/plant'
import {
  FAULT_CATALOG,
  FAULT_GROUPS,
  faultMagnitude,
  useFaultStore,
  type FaultDefinition,
  type FaultInjection,
} from '@/entities/telemetry'
import { useFormat } from '@/shared/lib/format/useFormat'
import { Panel } from '@/shared/ui'

const SINCE_OPTIONS = [0, 1, 3, 7] as const

function FaultControls({ def, fault }: { def: FaultDefinition; fault: FaultInjection }) {
  const { t } = useTranslation()
  const fmt = useFormat(PLANT.timezone)
  const update = useFaultStore((s) => s.update)
  const magnitude = faultMagnitude(def.kind, fault.severity)
  const targets = def.target === 'string' ? PLANT.strings.map((s) => s.id) : def.target === 'inverter' ? PLANT.inverters.map((i) => i.id) : []

  return (
    <div className="fault__controls">
      {targets.length > 0 && (
        <label>
          <span>{t('faults.target')}</span>
          <select value={fault.target ?? ''} onChange={(e) => update(fault.id, { target: e.target.value })}>
            {targets.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span>{def.isEvent ? t('faults.when') : t('faults.since')}</span>
        <select value={fault.sinceDaysAgo} onChange={(e) => update(fault.id, { sinceDaysAgo: Number(e.target.value) })}>
          {SINCE_OPTIONS.map((d) => (
            <option key={d} value={d}>{t(`faults.sinceOptions.${d}`)}</option>
          ))}
        </select>
      </label>
      {def.hasSeverity && (
        <label className="fault__severity">
          <span>
            {t('faults.severity')} · <b className="tnum">{fmt.num(magnitude.value, 0)} {t(`faults.units.${magnitude.unit}`)}</b>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={fault.severity}
            onChange={(e) => update(fault.id, { severity: Number(e.target.value) })}
          />
        </label>
      )}
    </div>
  )
}

/**
 * Painel para injetar problemas reais na usina simulada. O objetivo é mostrar que os
 * diagnósticos encontram cada defeito só pela assinatura nos dados.
 */
export function FaultSimulatorPanel() {
  const { t } = useTranslation()
  const faults = useFaultStore((s) => s.faults)
  const toggle = useFaultStore((s) => s.toggle)
  const loadDemo = useFaultStore((s) => s.loadDemo)
  const clear = useFaultStore((s) => s.clear)

  return (
    <Panel
      title={
        <>
          {t('faults.title')} <span className="pill pill--count">{t('faults.active', { count: faults.length })}</span>
        </>
      }
      subtitle={t('faults.subtitle')}
      actions={
        <div className="fault-actions">
          <button type="button" className="btn" onClick={loadDemo}>{t('faults.demo')}</button>
          <button type="button" className="btn" onClick={clear}>{t('faults.clear')}</button>
        </div>
      }
    >
      <div className="fault-groups">
        {FAULT_GROUPS.map((group) => (
          <section key={group} className="fault-group">
            <h3 className="subhead">{t(`faults.groups.${group}`)}</h3>
            <ul>
              {FAULT_CATALOG.filter((d) => d.group === group).map((def) => {
                const active = faults.find((f) => f.kind === def.kind)
                return (
                  <li key={def.kind} className={`fault ${active ? 'is-active' : ''}`}>
                    <label className="fault__toggle">
                      <input type="checkbox" role="switch" checked={!!active} onChange={() => toggle(def.kind)} />
                      <span className="switch" aria-hidden />
                      <span className="fault__text">
                        <strong>{t(`faults.kinds.${def.kind}.name`)}</strong>
                        <small>
                          {t(`faults.kinds.${def.kind}.hint`)}
                          {active && def.target === 'plant' ? ` · ${t('faults.plant')}` : ''}
                        </small>
                      </span>
                    </label>
                    {active && <FaultControls def={def} fault={active} />}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
    </Panel>
  )
}

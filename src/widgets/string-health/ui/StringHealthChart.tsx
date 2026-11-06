import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PLANT } from '@/entities/plant'
import type { StringHealth } from '@/features/plant-diagnostics'
import { useMonitoringStore } from '@/features/plant-monitoring'
import { useFormat } from '@/shared/lib/format/useFormat'
import { EChart, Panel, baseAxis, baseTooltip, viz, type EChartsOption } from '@/shared/ui'

const ICON = { ok: '', info: '', warning: '⚠ ', critical: '✕ ' } as const

export function StringHealthChart({ strings }: { strings: StringHealth[] }) {
  const { t } = useTranslation()
  const fmt = useFormat(PLANT.timezone)
  const [asTable, setAsTable] = useState(false)
  const selected = useMonitoringStore((s) => s.selectedTarget)
  const select = useMonitoringStore((s) => s.select)

  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 400,
    grid: { left: 40, right: 16, top: 16, bottom: 40 },
    tooltip: {
      ...baseTooltip,
      trigger: 'item',
      formatter: (p: { dataIndex: number }) => {
        const s = strings[p.dataIndex]
        return `<b>String ${s.stringId}</b> · ${s.inverterId}<br/>${t('table.pi')}: <b>${fmt.num(s.performanceIndex * 100, 1)}%</b><br/>${t('table.deviation')}: <b>${fmt.num(s.deviation * 100, 1)}%</b><br/>${t('table.energy')}: <b>${fmt.num(s.energyKwh, 0)} kWh</b>`
      },
    },
    xAxis: {
      ...baseAxis,
      type: 'category',
      data: strings.map((s) => s.stringId),
      axisLabel: { ...baseAxis.axisLabel, color: viz.textSecondary, fontSize: 12 },
    },
    yAxis: {
      ...baseAxis,
      type: 'value',
      min: 70,
      max: 105,
      axisLabel: { ...baseAxis.axisLabel, formatter: '{value}%' },
    },
    series: [
      {
        type: 'bar',
        barWidth: '46%',
        data: strings.map((s) => ({
          value: +(s.performanceIndex * 100).toFixed(1),
          itemStyle: {
            color: s.status === 'ok' ? viz.measured : viz.status[s.status],
            borderRadius: [4, 4, 0, 0],
            borderColor: selected === s.stringId ? viz.textPrimary : 'transparent',
            borderWidth: 2,
          },
          label: {
            show: s.status !== 'ok',
            position: 'top',
            color: viz.textPrimary,
            fontSize: 11,
            formatter: `${ICON[s.status]}${fmt.num(s.deviation * 100, 1)}%`,
          },
        })),
        markLine: {
          symbol: 'none',
          silent: true,
          lineStyle: { color: viz.textMuted, type: 'dashed' },
          label: { show: false },
          data: [{ yAxis: 100 }],
        },
      },
    ],
  }), [strings, selected, fmt, t])

  const onClick = useCallback((p: { dataIndex?: number }) => {
    if (p.dataIndex !== undefined) select(strings[p.dataIndex].stringId)
  }, [strings, select])

  return (
    <Panel
      title={t('chart.strings')}
      subtitle={t('chart.stringsSub')}
      actions={
        <button type="button" className="link-btn" onClick={() => setAsTable((v) => !v)}>
          {asTable ? t('chart.chart') : t('chart.table')}
        </button>
      }
    >
      {asTable ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('table.string')}</th><th>{t('table.inverter')}</th><th>{t('table.pi')}</th>
              <th>{t('table.deviation')}</th><th>{t('table.energy')}</th>
            </tr>
          </thead>
          <tbody>
            {strings.map((s) => (
              <tr key={s.stringId} className={s.status !== 'ok' ? `row--${s.status}` : ''}>
                <td>{s.stringId}</td><td>{s.inverterId}</td>
                <td>{fmt.num(s.performanceIndex * 100, 1)}%</td>
                <td>{ICON[s.status]}{fmt.num(s.deviation * 100, 1)}%</td>
                <td>{fmt.num(s.energyKwh, 0)} kWh</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EChart option={option} height={230} ariaLabel={t('chart.strings')} onClick={onClick} />
      )}
    </Panel>
  )
}

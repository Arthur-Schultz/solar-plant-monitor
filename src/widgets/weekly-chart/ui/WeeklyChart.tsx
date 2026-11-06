import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PLANT } from '@/entities/plant'
import type { DailyPerformance } from '@/features/plant-diagnostics'
import { useFormat } from '@/shared/lib/format/useFormat'
import { EChart, Panel, baseAxis, baseLegend, baseTooltip, viz, type EChartsOption } from '@/shared/ui'

/** Energia diária esperada × medida. O PR vai como rótulo, não num segundo eixo Y. */
export function WeeklyChart({ daily }: { daily: DailyPerformance[] }) {
  const { t } = useTranslation()
  const fmt = useFormat(PLANT.timezone)
  const [asTable, setAsTable] = useState(false)

  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 400,
    legend: { ...baseLegend, data: [t('chart.expected'), t('chart.measured')] },
    grid: { left: 44, right: 8, top: 34, bottom: 28 },
    tooltip: {
      ...baseTooltip,
      axisPointer: { type: 'shadow' },
      formatter: (ps: { dataIndex: number }[]) => {
        const d = daily[ps[0].dataIndex]
        return `<b>${fmt.weekday(d.day)}</b><br/>${t('table.expected')}: <b>${fmt.num(d.expectedKwh, 0)} kWh</b><br/>${t('table.measured')}: <b>${fmt.num(d.measuredKwh, 0)} kWh</b><br/>PR: <b>${fmt.num(d.performanceRatio * 100, 1)}%</b>`
      },
    },
    xAxis: { ...baseAxis, type: 'category', data: daily.map((d) => fmt.weekday(d.day)) },
    yAxis: { ...baseAxis, type: 'value', name: 'kWh', nameTextStyle: { color: viz.textMuted, align: 'right' } },
    series: [
      {
        name: t('chart.expected'),
        type: 'bar',
        barGap: '12%',
        barWidth: '30%',
        itemStyle: { color: 'rgba(201,133,0,0.35)', borderColor: viz.expected, borderWidth: 1, borderRadius: [4, 4, 0, 0] },
        data: daily.map((d) => +d.expectedKwh.toFixed(1)),
      },
      {
        name: t('chart.measured'),
        type: 'bar',
        barWidth: '30%',
        itemStyle: { color: viz.measured, borderRadius: [4, 4, 0, 0] },
        label: {
          show: true,
          position: 'top',
          color: viz.textSecondary,
          fontSize: 10,
          formatter: (p: { dataIndex: number }) => `PR ${fmt.num(daily[p.dataIndex].performanceRatio * 100, 0)}%`,
        },
        data: daily.map((d) => +d.measuredKwh.toFixed(1)),
      },
    ],
  }), [daily, fmt, t])

  return (
    <Panel
      title={t('chart.week')}
      subtitle={t('chart.weekSub')}
      actions={
        <button type="button" className="link-btn" onClick={() => setAsTable((v) => !v)}>
          {asTable ? t('chart.chart') : t('chart.table')}
        </button>
      }
    >
      {asTable ? (
        <table className="data-table">
          <thead>
            <tr><th>{t('table.day')}</th><th>{t('table.expected')}</th><th>{t('table.measured')}</th><th>{t('table.pr')}</th></tr>
          </thead>
          <tbody>
            {daily.map((d) => (
              <tr key={d.day}>
                <td>{fmt.weekday(d.day)}</td>
                <td>{fmt.num(d.expectedKwh, 0)} kWh</td>
                <td>{fmt.num(d.measuredKwh, 0)} kWh</td>
                <td>{fmt.num(d.performanceRatio * 100, 1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EChart option={option} height={250} ariaLabel={t('chart.week')} />
      )}
    </Panel>
  )
}

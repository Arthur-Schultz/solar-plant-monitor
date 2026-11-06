import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PLANT, type ExpectedSample } from '@/entities/plant'
import { useFormat } from '@/shared/lib/format/useFormat'
import { DAY, startOfLocalDay } from '@/shared/lib/time'
import { EChart, Panel, baseAxis, baseLegend, baseTooltip, viz, type EChartsOption } from '@/shared/ui'

export function ThermalChart({ expected, now }: { expected: ExpectedSample[]; now: number }) {
  const { t } = useTranslation()
  const fmt = useFormat(PLANT.timezone)

  const option = useMemo<EChartsOption>(() => {
    const start = startOfLocalDay(now, PLANT.timezone)
    const exp = expected.filter((e) => e.t >= start && e.t <= start + DAY)
    return {
      animationDuration: 400,
      legend: { ...baseLegend, data: [t('chart.cell'), t('chart.ambient')] },
      grid: { left: 36, right: 12, top: 34, bottom: 26 },
      tooltip: {
        ...baseTooltip,
        formatter: (ps: { seriesName: string; value: [number, number]; marker: string }[]) =>
          [`<b>${fmt.time(ps[0].value[0])}</b>`, ...ps.map((p) => `${p.marker}${p.seriesName}: <b>${fmt.num(p.value[1], 1)} °C</b>`)].join('<br/>'),
      },
      xAxis: {
        ...baseAxis,
        type: 'time',
        min: start,
        max: start + DAY,
        splitLine: { show: false },
        axisLabel: { ...baseAxis.axisLabel, formatter: (v: number) => fmt.time(v) },
      },
      yAxis: { ...baseAxis, type: 'value', name: '°C', min: 10, nameTextStyle: { color: viz.textMuted, align: 'right' } },
      series: [
        {
          name: t('chart.cell'),
          type: 'line',
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: viz.series2, width: 2 },
          itemStyle: { color: viz.series2 },
          data: exp.map((e) => [e.t, e.cellC]),
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: { color: viz.textMuted, type: 'dashed' },
            label: { formatter: 'STC 25 °C', color: viz.textMuted, fontSize: 10, position: 'insideStartTop' },
            data: [{ yAxis: 25 }],
          },
        },
        {
          name: t('chart.ambient'),
          type: 'line',
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: viz.measured, width: 2 },
          itemStyle: { color: viz.measured },
          data: exp.map((e) => [e.t, e.ambientC]),
        },
      ],
    }
  }, [expected, now, fmt, t])

  return (
    <Panel title={t('chart.thermal')} subtitle={t('chart.thermalSub')}>
      <EChart option={option} height={200} ariaLabel={t('chart.thermal')} />
    </Panel>
  )
}

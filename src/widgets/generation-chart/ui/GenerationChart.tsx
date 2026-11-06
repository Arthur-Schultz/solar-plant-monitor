import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExpectedSample } from '@/entities/plant'
import type { TelemetrySample } from '@/entities/telemetry'
import { useFormat } from '@/shared/lib/format/useFormat'
import { DAY, startOfLocalDay } from '@/shared/lib/time'
import { EChart, Panel, baseAxis, baseLegend, baseTooltip, viz, type EChartsOption } from '@/shared/ui'

interface Props {
  expected: ExpectedSample[]
  measured: TelemetrySample[]
  now: number
  timeZone: string
}

/**
 * Duas áreas de plotagem empilhadas com o MESMO eixo de tempo (small multiples), em vez
 * de um gráfico de dois eixos Y: potência (kW) em cima, irradiância (W/m²) embaixo.
 */
export function GenerationChart({ expected, measured, now, timeZone }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat(timeZone)

  const option = useMemo<EChartsOption>(() => {
    const start = startOfLocalDay(now, timeZone)
    const end = start + DAY
    const exp = expected.filter((e) => e.t >= start && e.t <= end)
    const meas = measured.filter((m) => m.t >= start && m.t <= end)
    const acKw = (m: TelemetrySample) => Object.values(m.inverters).reduce((a, i) => a + i.acW, 0) / 1000

    const xAxis = (gridIndex: number, showLabels: boolean) => ({
      ...baseAxis,
      type: 'time' as const,
      gridIndex,
      min: start + 5 * 3_600_000,
      max: start + 19 * 3_600_000,
      splitLine: { show: false },
      axisLabel: { ...baseAxis.axisLabel, show: showLabels, formatter: (v: number) => fmt.time(v) },
    })

    return {
      animationDuration: 500,
      legend: { ...baseLegend, data: [t('chart.expected'), t('chart.measured'), t('chart.poa')] },
      tooltip: {
        ...baseTooltip,
        formatter: (params: { seriesName: string; value: [number, number]; marker: string }[]) => {
          if (!params.length) return ''
          const head = `<b>${fmt.time(params[0].value[0])}</b>`
          const rows = params.map((p) => {
            const unit = p.seriesName === t('chart.poa') ? ' W/m²' : ' kW'
            const d = unit === ' kW' ? 1 : 0
            return `${p.marker}${p.seriesName}: <b style="font-variant-numeric:tabular-nums">${fmt.num(p.value[1], d)}${unit}</b>`
          })
          return [head, ...rows].join('<br/>')
        },
      },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 44, right: 64, top: 30, height: '58%' },
        { left: 44, right: 64, top: '76%', bottom: 26 },
      ],
      xAxis: [xAxis(0, false), xAxis(1, true)],
      yAxis: [
        { ...baseAxis, type: 'value', gridIndex: 0, name: 'kW', nameTextStyle: { color: viz.textMuted, align: 'right' }, max: 65 },
        { ...baseAxis, type: 'value', gridIndex: 1, max: 1200, splitNumber: 2, name: 'W/m²', nameTextStyle: { color: viz.textMuted, align: 'right' } },
      ],
      series: [
        {
          name: t('chart.expected'),
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: viz.expected, width: 2, type: [6, 4] },
          itemStyle: { color: viz.expected },
          areaStyle: { color: 'rgba(201,133,0,0.10)' },
          data: exp.map((e) => [e.t, e.acW / 1000]),
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: { color: viz.textSecondary, type: 'solid', width: 1 },
            label: { formatter: t('chart.now'), color: viz.textSecondary, fontSize: 11 },
            data: [{ xAxis: now }],
          },
        },
        {
          name: t('chart.measured'),
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          showSymbol: false,
          smooth: 0.15,
          lineStyle: { color: viz.measured, width: 2 },
          itemStyle: { color: viz.measured },
          endLabel: {
            show: meas.length > 0 && acKw(meas[meas.length - 1]) > 0.5,
            formatter: (p: { value: [number, number] }) => `${fmt.num(p.value[1], 1)} kW`,
            color: viz.textPrimary,
            fontSize: 12,
          },
          data: meas.map((m) => [m.t, acKw(m)]),
        },
        {
          name: t('chart.poa'),
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          showSymbol: false,
          smooth: 0.2,
          lineStyle: { color: viz.textMuted, width: 1.5 },
          itemStyle: { color: viz.textMuted },
          areaStyle: { color: 'rgba(115,129,148,0.14)' },
          data: exp.map((e) => [e.t, e.poa]),
        },
      ],
    }
  }, [expected, measured, now, timeZone, t, fmt])

  return (
    <Panel title={t('chart.today')} subtitle={t('chart.todaySub')}>
      <EChart option={option} height={330} ariaLabel={t('chart.today')} />
    </Panel>
  )
}

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PLANT, type ExpectedSample } from '@/entities/plant'
import type { SoilingAssessment, StringHealth } from '@/features/plant-diagnostics'
import { useFormat } from '@/shared/lib/format/useFormat'
import { DAY, startOfLocalDay } from '@/shared/lib/time'
import { EChart, Panel, baseAxis, baseTooltip, viz, type EChartsOption } from '@/shared/ui'

interface Props {
  expected: ExpectedSample[]
  strings: StringHealth[]
  soiling: SoilingAssessment | null
  now: number
}

/** Decomposição das perdas de hoje (até agora) em kWh — barras horizontais ordenadas. */
export function LossesChart({ expected, strings, soiling, now }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat(PLANT.timezone)

  const items = useMemo(() => {
    const start = startOfLocalDay(now, PLANT.timezone)
    const exp = expected.filter((e) => e.t >= start && e.t <= Math.min(now, start + DAY))
    const sumKwh = (f: (e: ExpectedSample) => number) => exp.reduce((a, e) => a + f(e) / 1000 / 4, 0)
    const expectedAc = sumKwh((e) => e.acW)
    const soilPct = (soiling?.lossPct ?? 0) / 100
    const stringLoss = strings
      .filter((s) => s.status !== 'ok')
      .reduce((a, s) => {
        const id = s.stringId
        const sExp = sumKwh((e) => e.strings.find((x) => x.stringId === id)?.dcW ?? 0)
        return a + sExp * (1 - soilPct) * Math.abs(s.deviation)
      }, 0)

    return [
      { key: 'thermal', kwh: sumKwh((e) => e.thermalLossW) },
      { key: 'shading', kwh: sumKwh((e) => e.shadingLossW) },
      { key: 'soiling', kwh: expectedAc * soilPct },
      { key: 'clipping', kwh: sumKwh((e) => e.clippedW) },
      { key: 'string', kwh: stringLoss },
    ].sort((a, b) => b.kwh - a.kwh)
  }, [expected, strings, soiling, now])

  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 400,
    grid: { left: 150, right: 64, top: 6, bottom: 6 },
    tooltip: { ...baseTooltip, trigger: 'item', formatter: (p: { name: string; value: number }) => `${p.name}: <b>${fmt.num(p.value, 1)} kWh</b>` },
    xAxis: { ...baseAxis, type: 'value', show: false },
    yAxis: {
      ...baseAxis,
      type: 'category',
      inverse: true,
      axisLine: { show: false },
      axisLabel: { ...baseAxis.axisLabel, color: viz.textSecondary, fontSize: 12 },
      data: items.map((i) => t(`chart.lossItems.${i.key}`)),
    },
    series: [
      {
        type: 'bar',
        barWidth: 14,
        itemStyle: { color: viz.series2, borderRadius: [0, 4, 4, 0] },
        label: {
          show: true,
          position: 'right',
          color: viz.textPrimary,
          fontSize: 12,
          formatter: (p: { value: number }) => `${fmt.num(p.value, 1)} kWh`,
        },
        data: items.map((i) => +i.kwh.toFixed(2)),
      },
    ],
  }), [items, fmt, t])

  return (
    <Panel title={t('chart.losses')} subtitle={t('chart.lossesSub')}>
      <EChart option={option} height={200} ariaLabel={t('chart.losses')} />
    </Panel>
  )
}

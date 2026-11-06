import { BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  AxisPointerComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'

// Tree-shaking: só os módulos usados entram no bundle
echarts.use([
  LineChart, BarChart, GridComponent, LegendComponent, TooltipComponent,
  MarkLineComponent, MarkAreaComponent, AxisPointerComponent, CanvasRenderer,
])

export type EChartsOption = echarts.EChartsCoreOption

interface Props {
  option: EChartsOption
  height: number | string
  ariaLabel: string
  onClick?: (params: { name?: string; dataIndex?: number; seriesName?: string }) => void
}

/**
 * Wrapper fino: uma instância por montagem, `setOption` incremental (notMerge=false)
 * para animar mudanças, e ResizeObserver para layouts responsivos.
 */
export function EChart({ option, height, ariaLabel, onClick }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!el.current) return
    const instance = echarts.init(el.current, undefined, { renderer: 'canvas' })
    chart.current = instance
    const ro = new ResizeObserver(() => instance.resize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: false, lazyUpdate: true, replaceMerge: ['series'] })
  }, [option])

  useEffect(() => {
    const c = chart.current
    if (!c || !onClick) return
    c.on('click', onClick as never)
    return () => {
      c.off('click', onClick as never)
    }
  }, [onClick])

  return <div ref={el} role="img" aria-label={ariaLabel} style={{ width: '100%', height }} />
}

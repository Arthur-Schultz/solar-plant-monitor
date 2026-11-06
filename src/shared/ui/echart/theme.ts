/** Tokens de cor validados (OKLab/CVD) contra a superfície escura do painel. */
export const viz = {
  surface: '#121821',
  grid: '#1f2a36',
  axis: '#2b3846',
  textPrimary: '#e6ebf1',
  textSecondary: '#a7b3c2',
  textMuted: '#738194',
  measured: '#3987e5',
  expected: '#c98500',
  series3: '#199e70',
  series2: '#d95926',
  status: {
    ok: '#0ca30c',
    info: '#5b9cf0',
    warning: '#fab219',
    critical: '#d03b3b',
  },
} as const

export const baseAxis = {
  axisLine: { lineStyle: { color: viz.axis } },
  axisTick: { show: false },
  axisLabel: { color: viz.textMuted, fontSize: 11, fontFamily: 'inherit' },
  splitLine: { lineStyle: { color: viz.grid, width: 1 } },
}

export const baseTooltip = {
  trigger: 'axis' as const,
  backgroundColor: '#0d1218',
  borderColor: viz.axis,
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: viz.textPrimary, fontSize: 12, fontFamily: 'inherit' },
  axisPointer: { type: 'line' as const, lineStyle: { color: viz.textMuted, type: 'dashed' as const } },
}

export const baseLegend = {
  top: 0,
  right: 0,
  icon: 'roundRect',
  itemWidth: 12,
  itemHeight: 4,
  textStyle: { color: viz.textSecondary, fontSize: 12, fontFamily: 'inherit' },
}

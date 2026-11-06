import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PLANT } from '@/entities/plant'
import type { InverterStatus } from '@/entities/telemetry'
import type { StringHealth } from '@/features/plant-diagnostics'
import { TiltControl, useMonitoringStore } from '@/features/plant-monitoring'
import { SunControlPanel, useResolvedSun } from '@/features/sun-control'
import { sunPosition } from '@/shared/lib/solar'
import { MINUTE, startOfLocalDay } from '@/shared/lib/time'
import { Panel } from '@/shared/ui'
import { PlantScene, type Health } from '../lib/PlantScene'

interface Props {
  strings: StringHealth[]
  inverterStatus: Record<string, InverterStatus>
  expectedDayKwh: number
  now: number
}

export function PlantTwin({ strings, inverterStatus, expectedDayKwh, now }: Props) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<PlantScene | null>(null)
  const [heatmap, setHeatmap] = useState(true)
  const tilt = useMonitoringStore((s) => s.tiltDeg)
  const selected = useMonitoringStore((s) => s.selectedTarget)
  const select = useMonitoringStore((s) => s.select)
  const sun = useResolvedSun(now)

  // Arco do Sol do dia (a cada 10 min) — mostra a trajetória que gera a curva em sino
  const day = startOfLocalDay(now, PLANT.timezone)
  const sunPath = useMemo(() => {
    const pts: [number, number][] = []
    for (let m = 0; m <= 24 * 60; m += 10) {
      const p = sunPosition(new Date(day + m * MINUTE), PLANT.latitude, PLANT.longitude)
      pts.push([p.azimuth, p.elevation])
    }
    return pts
  }, [day])

  const stringHealth = useMemo(
    () => Object.fromEntries(strings.map((s) => [s.stringId, s.status as Health])),
    [strings],
  )

  // Cena criada uma vez; os rótulos 3D seguem o idioma inicial (recriá-la a cada troca é caro)
  useEffect(() => {
    if (!host.current) return
    const s = new PlantScene(host.current, PLANT, { river: t('twin.river'), north: t('twin.north') }, (id) => {
      if (id) useMonitoringStore.getState().select(id)
    })
    scene.current = s
    return () => {
      s.dispose()
      scene.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    scene.current?.update({
      sun: { azimuth: sun.azimuth, elevation: sun.elevation },
      sunPath,
      tiltDeg: tilt,
      stringHealth,
      inverterStatus,
      selected,
      heatmap,
    })
  }, [sun.azimuth, sun.elevation, sunPath, tilt, stringHealth, inverterStatus, selected, heatmap])

  return (
    <Panel
      title={t('twin.title')}
      subtitle={`${PLANT.name} · ${t('twin.legendString')}`}
      className="twin-panel"
      bodyClassName="twin-body"
      actions={
        <label className="toggle">
          <input type="checkbox" checked={heatmap} onChange={(e) => setHeatmap(e.target.checked)} />
          <span>{t('twin.heatmap')}</span>
        </label>
      }
    >
      <div className="twin-canvas" ref={host} />
      {selected && (
        <button type="button" className="twin-chip" onClick={() => select(selected)}>
          {t('twin.selected', { id: selected })} ✕
        </button>
      )}
      <aside className="twin-controls">
        <SunControlPanel sun={sun} now={now} />
        <TiltControl expectedDayKwh={expectedDayKwh} />
      </aside>
    </Panel>
  )
}

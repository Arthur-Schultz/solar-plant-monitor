import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { PLANT } from '@/entities/plant'
import { useFormat } from '@/shared/lib/format/useFormat'
import { sunPosition } from '@/shared/lib/solar'
import { HOUR, localHour, startOfLocalDay } from '@/shared/lib/time'
import { useSunControlStore } from '../model/store'
import type { ResolvedSun } from '../model/useSun'

interface Props {
  sun: ResolvedSun
  now: number
}

const R = 46

/** Bússola SVG: arrastar define o azimute; a distância ao centro, a elevação (projeção polar). */
function Compass({ azimuth, elevation, cardinals, onChange }: { azimuth: number; elevation: number; cardinals: string[]; onChange: (az: number, el: number) => void }) {
  const ref = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  const r = (Math.max(0, 90 - Math.max(0, elevation)) / 90) * R
  const a = (azimuth * Math.PI) / 180
  const x = 60 + r * Math.sin(a)
  const y = 60 - r * Math.cos(a)

  const update = (e: ReactPointerEvent) => {
    const box = ref.current!.getBoundingClientRect()
    const dx = ((e.clientX - box.left) / box.width) * 120 - 60
    const dy = ((e.clientY - box.top) / box.height) * 120 - 60
    const az = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
    const el = 90 - (Math.min(R, Math.hypot(dx, dy)) / R) * 90
    onChange(Math.round(az), Math.round(el))
  }

  return (
    <svg
      ref={ref}
      viewBox="0 0 120 120"
      className="compass"
      onPointerDown={(e) => {
        dragging.current = true
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        update(e)
      }}
      onPointerMove={(e) => dragging.current && update(e)}
      onPointerUp={() => (dragging.current = false)}
    >
      <circle cx="60" cy="60" r={R} className="compass__ring" />
      <circle cx="60" cy="60" r={R * (2 / 3)} className="compass__grid" />
      <circle cx="60" cy="60" r={R / 3} className="compass__grid" />
      {cardinals.map((l, i) => {
        const ang = (i * Math.PI) / 2
        return (
          <text key={l} x={60 + 55 * Math.sin(ang)} y={60 - 55 * Math.cos(ang) + 3.5} className={`compass__label ${i === 0 ? 'is-north' : ''}`}>
            {l}
          </text>
        )
      })}
      <line x1="60" y1="60" x2={x} y2={y} className="compass__ray" />
      <circle cx={x} cy={y} r="6" className={`compass__sun ${elevation < 0 ? 'is-night' : ''}`} />
    </svg>
  )
}

export function SunControlPanel({ sun, now }: Props) {
  const { t } = useTranslation()
  const fmt = useFormat(PLANT.timezone)
  const { mode, setMode, setManual, setElevation, setAzimuth } = useSunControlStore()
  const [hour, setHour] = useState(() => localHour(now, PLANT.timezone))
  const [playing, setPlaying] = useState(false)

  const applyHour = (h: number) => {
    setHour(h)
    const p = sunPosition(new Date(startOfLocalDay(now, PLANT.timezone) + h * HOUR), PLANT.latitude, PLANT.longitude)
    setManual(Math.round(p.azimuth), Math.round(p.elevation * 10) / 10)
  }

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      setHour((h) => {
        const next = h >= 18.5 ? 5.5 : h + 0.08
        const p = sunPosition(new Date(startOfLocalDay(now, PLANT.timezone) + next * HOUR), PLANT.latitude, PLANT.longitude)
        setManual(p.azimuth, p.elevation)
        return next
      })
    }, 40)
    return () => window.clearInterval(id)
  }, [playing, now, setManual])

  const hh = Math.floor(hour)
  const mm = Math.round((hour - hh) * 60)

  return (
    <div className="control-card">
      <div className="control-card__head">
        <strong>{t('sun.title')}</strong>
        <div className="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'realtime'} onClick={() => { setPlaying(false); setMode('realtime') }}>
            {t('sun.realtime')}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'manual'} onClick={() => setMode('manual')}>
            {t('sun.manual')}
          </button>
        </div>
      </div>

      <div className="sun-grid">
        <Compass cardinals={t('sun.cardinals').split(',')} azimuth={sun.azimuth} elevation={sun.elevation} onChange={(az, el) => { setPlaying(false); setManual(az, el) }} />
        <dl className="sun-readout">
          <div>
            <dt>{t('sun.azimuth')}</dt>
            <dd>{fmt.num(sun.azimuth, 0)}°</dd>
          </div>
          <div>
            <dt>{t('sun.elevation')}</dt>
            <dd>{fmt.num(sun.elevation, 1)}°</dd>
          </div>
          {sun.elevation < 0 && <p className="muted small">{t('sun.belowHorizon')}</p>}
        </dl>
      </div>

      <label className="slider">
        <span>{t('sun.azimuth')}</span>
        <input type="range" min={0} max={359} value={Math.round(sun.azimuth)} onChange={(e) => { setPlaying(false); setAzimuth(Number(e.target.value)) }} />
      </label>
      <label className="slider">
        <span>{t('sun.elevation')}</span>
        <input type="range" min={-10} max={90} value={Math.round(sun.elevation)} onChange={(e) => { setPlaying(false); setElevation(Number(e.target.value)) }} />
      </label>
      <label className="slider">
        <span>
          {t('sun.hour')} · <b className="tnum">{String(hh).padStart(2, '0')}:{String(mm).padStart(2, '0')}</b>
        </span>
        <div className="slider__row">
          <input type="range" min={5} max={19} step={0.05} value={hour} onChange={(e) => { setPlaying(false); applyHour(Number(e.target.value)) }} />
          <button type="button" className="icon-btn" onClick={() => setPlaying((p) => !p)} aria-label={playing ? t('sun.pause') : t('sun.play')} title={playing ? t('sun.pause') : t('sun.play')}>
            {playing ? '❚❚' : '▶'}
          </button>
        </div>
      </label>
    </div>
  )
}

import { create } from 'zustand'
import { PLANT, type ExpectedSample } from '@/entities/plant'
import { useFaultStore, type InverterEvent, type TelemetrySample } from '@/entities/telemetry'
import { useWeatherStore } from '@/entities/weather'
import { runPipeline, type RainInfo } from '../lib/pipeline'

interface MonitoringState {
  tiltDeg: number
  now: number
  ready: boolean
  expected: ExpectedSample[]
  measured: TelemetrySample[]
  events: InverterEvent[]
  rain: RainInfo
  /** String/inversor destacado (sincroniza maquete 3D ↔ tabela ↔ diagnósticos) */
  selectedTarget: string | null
  setTilt: (deg: number) => void
  tick: (now?: number) => void
  select: (target: string | null) => void
  recompute: () => Promise<void>
}

let runId = 0

export const useMonitoringStore = create<MonitoringState>((set, get) => ({
  tiltDeg: PLANT.defaultTiltDeg,
  now: Date.now(),
  ready: false,
  expected: [],
  measured: [],
  events: [],
  rain: { byDay: new Map(), forecast: [], nowMmPerHour: 0 },
  selectedTarget: null,

  setTilt(deg) {
    const [min, max] = PLANT.tiltRangeDeg
    set({ tiltDeg: Math.max(min, Math.min(max, Math.round(deg))) })
    void get().recompute()
  },

  tick(now = Date.now()) {
    set({ now })
    void get().recompute()
  },

  select(target) {
    set({ selectedTarget: get().selectedTarget === target ? null : target })
  },

  async recompute() {
    const weather = useWeatherStore.getState().samples
    if (!weather.length) return
    const id = ++runId
    const { tiltDeg, now } = get()
    const faults = useFaultStore.getState().faults
    const result = await runPipeline(PLANT, weather, tiltDeg, now, { faults, noise: 0.012 })
    if (id !== runId) return // descarta resultado obsoleto (troca rápida de inclinação)
    set({ ...result, ready: true })
  },
}))

/** Liga o pipeline ao clima: recalcula sempre que novas amostras chegam. */
export function initMonitoring(): () => void {
  const unsub = useWeatherStore.subscribe((s, prev) => {
    if (s.samples !== prev.samples) void useMonitoringStore.getState().recompute()
  })
  const unsubFaults = useFaultStore.subscribe((s, prev) => {
    if (s.faults !== prev.faults) void useMonitoringStore.getState().recompute()
  })
  void useWeatherStore.getState().load(PLANT.latitude, PLANT.longitude, PLANT.timezone)
  const timer = window.setInterval(() => useMonitoringStore.getState().tick(), 60_000)
  return () => {
    unsub()
    unsubFaults()
    window.clearInterval(timer)
  }
}

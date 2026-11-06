import { create } from 'zustand'

export type SunMode = 'realtime' | 'manual'

interface SunControlState {
  mode: SunMode
  /** Graus a partir do norte, sentido horário */
  azimuth: number
  elevation: number
  setMode: (mode: SunMode) => void
  setAzimuth: (deg: number) => void
  setElevation: (deg: number) => void
  setManual: (azimuth: number, elevation: number) => void
}

const wrap = (d: number) => ((d % 360) + 360) % 360

export const useSunControlStore = create<SunControlState>((set) => ({
  mode: 'realtime',
  azimuth: 60,
  elevation: 35,
  setMode: (mode) => set({ mode }),
  setAzimuth: (deg) => set({ azimuth: wrap(deg), mode: 'manual' }),
  setElevation: (deg) => set({ elevation: Math.max(-10, Math.min(90, deg)), mode: 'manual' }),
  setManual: (azimuth, elevation) => set({ azimuth: wrap(azimuth), elevation, mode: 'manual' }),
}))

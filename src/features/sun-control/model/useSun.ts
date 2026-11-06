import { useMemo } from 'react'
import { PLANT } from '@/entities/plant'
import { sunPosition } from '@/shared/lib/solar'
import { useSunControlStore } from './store'

export interface ResolvedSun {
  azimuth: number
  elevation: number
  isRealtime: boolean
}

/** Posição solar efetiva para a maquete: astronômica no "agora" ou definida manualmente. */
export function useResolvedSun(now: number): ResolvedSun {
  const { mode, azimuth, elevation } = useSunControlStore()
  return useMemo(() => {
    if (mode === 'manual') return { azimuth, elevation, isRealtime: false }
    const p = sunPosition(new Date(now), PLANT.latitude, PLANT.longitude)
    return { azimuth: p.azimuth, elevation: p.elevation, isRealtime: true }
  }, [mode, azimuth, elevation, now])
}

import { describe, expect, it } from 'vitest'
import {
  acPower,
  cellTemperature,
  clearSkyGhi,
  dcPower,
  erbsDecomposition,
  extraterrestrialIrradiance,
  interRowShadingFraction,
  planeOfArray,
  sunPosition,
  temperatureFactor,
} from './index'

// Torreões, Juiz de Fora — MG
const LAT = -21.8628
const LON = -43.5406

describe('sunPosition', () => {
  it('no solstício de verão (dez) ao meio-dia solar o Sol está quase a pino, levemente ao sul', () => {
    // Meio-dia solar em −43,54° ≈ 14:54 UTC (sem correção da equação do tempo)
    const p = sunPosition(new Date(Date.UTC(2026, 11, 21, 14, 52)), LAT, LON)
    expect(p.elevation).toBeGreaterThan(87)
    expect(p.declination).toBeCloseTo(-23.44, 0)
  })

  it('no solstício de inverno (jun) ao meio-dia o Sol fica ao NORTE e baixo (~45°)', () => {
    const p = sunPosition(new Date(Date.UTC(2026, 5, 21, 14, 55)), LAT, LON)
    expect(p.elevation).toBeGreaterThan(43)
    expect(p.elevation).toBeLessThan(46)
    const fromNorth = Math.min(p.azimuth, 360 - p.azimuth)
    expect(fromNorth).toBeLessThan(5)
  })

  it('de manhã o Sol está a leste e à tarde a oeste', () => {
    const morning = sunPosition(new Date(Date.UTC(2026, 2, 20, 11, 0)), LAT, LON) // 08h local
    const afternoon = sunPosition(new Date(Date.UTC(2026, 2, 20, 19, 0)), LAT, LON) // 16h local
    expect(morning.azimuth).toBeGreaterThan(45)
    expect(morning.azimuth).toBeLessThan(135)
    expect(afternoon.azimuth).toBeGreaterThan(225)
    expect(afternoon.azimuth).toBeLessThan(315)
  })

  it('à meia-noite o Sol está abaixo do horizonte', () => {
    const p = sunPosition(new Date(Date.UTC(2026, 10, 6, 3, 0)), LAT, LON)
    expect(p.elevation).toBeLessThan(0)
  })
})

describe('irradiância', () => {
  it('céu claro ao zênite fica próximo de 1000 W/m²', () => {
    expect(clearSkyGhi(0)).toBeGreaterThan(1000)
    expect(clearSkyGhi(0)).toBeLessThan(1100)
    expect(clearSkyGhi(95)).toBe(0)
  })

  it('Erbs conserva energia: GHI = DNI·cosZ + DHI', () => {
    const z = 30
    const c = erbsDecomposition(800, z, extraterrestrialIrradiance(new Date()))
    expect(c.dni * Math.cos((z * Math.PI) / 180) + c.dhi).toBeCloseTo(800, 6)
    expect(c.dhi).toBeLessThan(800)
  })

  it('céu encoberto (kt baixo) é quase todo difuso', () => {
    const c = erbsDecomposition(100, 30, 1361)
    expect(c.dhi / c.ghi).toBeGreaterThan(0.9)
  })

  it('módulo voltado para o Sol recebe mais que o plano horizontal', () => {
    // Inverno, Sol ao norte a 45°: inclinar 22° para o norte deve ganhar irradiância
    const comps = { ghi: 650, dni: 800, dhi: 85 }
    const flat = planeOfArray(comps, 45, 0, 0, 0)
    const tilted = planeOfArray(comps, 45, 0, 22, 0)
    expect(tilted.poa).toBeGreaterThan(flat.poa)
    expect(tilted.aoi).toBeCloseTo(23, 0)
  })

  it('sombra entre fileiras: nenhuma ao meio-dia, total no horizonte', () => {
    expect(interRowShadingFraction(60, 0, 22, 0, 2.3, 5)).toBe(0)
    expect(interRowShadingFraction(0.01, 0, 22, 0, 2.3, 5)).toBeGreaterThan(0.95)
    const low = interRowShadingFraction(15, 0, 22, 0, 2.3, 5)
    expect(low).toBeGreaterThan(0)
    expect(low).toBeLessThan(1)
  })
})

describe('modelo FV', () => {
  const module = { pmaxW: 470, gammaPmaxPctPerC: -0.34, noctC: 45, lengthM: 1.9, widthM: 1.13 }

  it('célula esquenta ~25–30 °C acima do ambiente a 1000 W/m²', () => {
    const tc = cellTemperature(1000, 28, 45, 1)
    expect(tc - 28).toBeGreaterThan(20)
    expect(tc - 28).toBeLessThan(35)
  })

  it('coeficiente térmico: a 60 °C perde ~11,9 % com γ = −0,34 %/°C', () => {
    expect(1 - temperatureFactor(60, -0.34)).toBeCloseTo(0.119, 3)
  })

  it('a perda térmica reportada fecha a conta com a potência a 25 °C', () => {
    const r = dcPower({
      poaBeam: 800, poaDiffuse: 150, aoiDeg: 10, ambientC: 30, windMs: 1,
      nameplateW: 37_600, module, shadingFraction: 0, soilingLoss: 0.03, systemLosses: 0.05,
    })
    expect(r.dcW + r.thermalLossW).toBeCloseTo(r.dcAt25CW, 6)
    expect(r.thermalLossW).toBeGreaterThan(0)
  })

  it('inversor limita (clipping) na potência nominal CA', () => {
    const inv = { pacMaxW: 30_000, efficiency: 0.98 }
    const r = acPower(36_000, inv)
    expect(r.acW).toBe(30_000)
    expect(r.clippedW).toBeGreaterThan(0)
    expect(acPower(0, inv).acW).toBe(0)
  })
})

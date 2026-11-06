import * as THREE from 'three'

/** Textura procedural de célula fotovoltaica (half-cell 6×24 com barramentos). */
export function createCellTexture(): THREE.CanvasTexture {
  const w = 128
  const h = 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = '#0f1c33'
  g.fillRect(0, 0, w, h)
  const cols = 6
  const rows = 12
  const cw = w / cols
  const ch = h / rows
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const grad = g.createLinearGradient(i * cw, j * ch, (i + 1) * cw, (j + 1) * ch)
      grad.addColorStop(0, '#1a2d52')
      grad.addColorStop(1, '#13223f')
      g.fillStyle = grad
      g.fillRect(i * cw + 1.5, j * ch + 1.5, cw - 3, ch - 3)
    }
  }
  // Barramentos (busbars) finos
  g.strokeStyle = 'rgba(190,200,220,0.22)'
  g.lineWidth = 1
  for (let i = 0; i < cols; i++) {
    for (const f of [0.3, 0.7]) {
      g.beginPath()
      g.moveTo(i * cw + cw * f, 0)
      g.lineTo(i * cw + cw * f, h)
      g.stroke()
    }
  }
  // Divisão half-cut no meio do módulo
  g.fillStyle = '#c9d2de'
  g.fillRect(0, h / 2 - 1, w, 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Textura de ondulação para a água (animada via offset). */
export function createWaterTexture(): THREE.CanvasTexture {
  const s = 256
  const c = document.createElement('canvas')
  c.width = s
  c.height = s
  const g = c.getContext('2d')!
  g.fillStyle = '#2b6a86'
  g.fillRect(0, 0, s, s)
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * s
    const y = Math.random() * s
    const len = 8 + Math.random() * 26
    g.strokeStyle = `rgba(200,235,250,${0.08 + Math.random() * 0.16})`
    g.lineWidth = 1 + Math.random()
    g.beginPath()
    g.moveTo(x, y)
    g.quadraticCurveTo(x + len / 2, y - 2, x + len, y)
    g.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Sprite de texto (rótulos de strings, rio e norte). */
export function createLabelSprite(
  text: string,
  { color = '#e6ebf1', background = 'rgba(13,18,24,0.78)', fontSize = 44, scale = 1 } = {},
): THREE.Sprite {
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  const font = `600 ${fontSize}px Inter, system-ui, sans-serif`
  g.font = font
  const padX = fontSize * 0.5
  const w = Math.ceil(g.measureText(text).width + padX * 2)
  const h = Math.ceil(fontSize * 1.6)
  c.width = w
  c.height = h
  g.font = font
  if (background !== 'transparent') {
    g.fillStyle = background
    const r = h / 2.6
    g.beginPath()
    g.roundRect(0, 0, w, h, r)
    g.fill()
  }
  g.fillStyle = color
  g.textBaseline = 'middle'
  g.textAlign = 'center'
  g.fillText(text, w / 2, h / 2 + 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
  const sprite = new THREE.Sprite(mat)
  const unit = 0.045 * scale
  sprite.scale.set(w * unit, h * unit, 1)
  sprite.renderOrder = 10
  return sprite
}

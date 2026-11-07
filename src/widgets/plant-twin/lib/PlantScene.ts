import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { PlantConfig } from '@/entities/plant'
import { sunVector } from '@/shared/lib/solar'
import { seededRandom } from '@/shared/lib/time'
import { createCellTexture, createLabelSprite, createWaterTexture } from './textures'

export type Health = 'ok' | 'info' | 'warning' | 'critical'

export interface SceneState {
  sun: { azimuth: number; elevation: number }
  /** Trajetória do Sol hoje (az, el) — desenhada como arco no céu */
  sunPath: [number, number][]
  tiltDeg: number
  stringHealth: Record<string, Health>
  inverterStatus: Record<string, 'producing' | 'standby' | 'fault' | 'offline'>
  selected: string | null
  heatmap: boolean
  /** Intensidade da chuva 0–1 (0 = sem chuva) */
  rain: number
}

const RAIN_DROPS = 4500
const RAIN_BOX = { x: 70, z: 62, top: 42 }

const HEALTH_EMISSIVE: Record<Health, number> = {
  ok: 0x1c5cab,
  info: 0x1c5cab,
  warning: 0xfab219,
  critical: 0xd03b3b,
}

const STATUS_LED = { producing: 0x22c55e, standby: 0x64748b, fault: 0xef4444, offline: 0xf59e0b } as const

const SUN_DISTANCE = 95

/**
 * Cena 3D da usina (Three.js puro, sem framework): terreno, Rio do Peixe com mata ciliar,
 * 8 mesas (1 por string), casa de inversores, cerca, bússola e Sol com sombras projetadas.
 * Coordenadas: x = leste, y = cima, z = sul (o norte fica em −z).
 */
export class PlantScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.OrthographicCamera
  private controls: OrbitControls
  private sunLight: THREE.DirectionalLight
  private hemi: THREE.HemisphereLight
  private sunMesh: THREE.Mesh
  private sunPathLine: THREE.Line
  private waterTex: THREE.CanvasTexture
  private tables = new Map<string, { pivot: THREE.Group; holder: THREE.Group; material: THREE.MeshStandardMaterial; outline: THREE.LineSegments; legsFront: THREE.Mesh[]; legsBack: THREE.Mesh[]; label: THREE.Sprite }>()
  private inverterLeds = new Map<string, THREE.Mesh>()
  private inverterBoxes = new Map<string, THREE.Mesh>()
  private pickables: THREE.Object3D[] = []
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private resizeObserver: ResizeObserver
  private frustum = 24
  private disposed = false
  private hovered: string | null = null
  private rainIntensity = 0
  private rainMesh: THREE.LineSegments | null = null
  private rainSpeed: Float32Array | null = null
  private skyRain = new THREE.Color('#6d7884')
  private skyDay = new THREE.Color('#9cc3e6')
  private skyDusk = new THREE.Color('#e7a47a')
  private skyNight = new THREE.Color('#16223a')

  private readonly tableWidth: number
  private readonly tableLength: number

  private container: HTMLElement
  private plant: PlantConfig
  private onPick: (id: string | null) => void

  constructor(
    container: HTMLElement,
    plant: PlantConfig,
    labels: { river: string; north: string },
    onPick: (id: string | null) => void,
  ) {
    this.container = container
    this.plant = plant
    this.onPick = onPick
    const { modulesAcross, modulesHigh } = plant.layout
    this.tableWidth = modulesAcross * (plant.module.widthM + 0.02)
    this.tableLength = modulesHigh * (plant.module.lengthM + 0.02)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)

    // Câmera ortográfica "isométrica" olhando do nordeste: vê a face dos módulos (voltada ao norte)
    const aspect = container.clientWidth / Math.max(1, container.clientHeight)
    this.camera = new THREE.OrthographicCamera(-this.frustum * aspect, this.frustum * aspect, this.frustum, -this.frustum, 0.1, 500)
    this.camera.position.set(62, 58, -70)
    this.camera.lookAt(6, 0, 2)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(6, 0, 2)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minZoom = 0.6
    this.controls.maxZoom = 3.5
    this.controls.maxPolarAngle = Math.PI * 0.44
    this.controls.minPolarAngle = Math.PI * 0.12
    this.controls.enablePan = true

    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x3a4a2a, 0.55)
    this.scene.add(this.hemi)

    this.sunLight = new THREE.DirectionalLight(0xfff1d6, 2.6)
    this.sunLight.castShadow = true
    this.sunLight.shadow.mapSize.set(2048, 2048)
    const sc = this.sunLight.shadow.camera
    sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 220
    this.sunLight.shadow.bias = -0.0004
    this.sunLight.shadow.normalBias = 0.03
    this.scene.add(this.sunLight, this.sunLight.target)

    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd36b, fog: false }),
    )
    this.scene.add(this.sunMesh)

    this.sunPathLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0xffd36b, dashSize: 2, gapSize: 1.5, transparent: true, opacity: 0.55, fog: false }),
    )
    this.scene.add(this.sunPathLine)

    this.scene.fog = new THREE.Fog(0x9cc3e6, 120, 260)

    this.buildGround()
    this.waterTex = this.buildRiver(labels.river)
    this.buildTables()
    this.buildInverterHouse()
    this.buildFence()
    this.buildCompass(labels.north)

    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    const timer = new THREE.Timer()
    this.renderer.setAnimationLoop((time) => {
      if (this.disposed) return
      timer.update(time)
      const dt = timer.getDelta()
      this.waterTex.offset.x -= dt * (0.035 + 0.09 * this.rainIntensity)
      this.animateRain(dt)
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    })
  }

  // ---------------------------------------------------------------- construção

  private buildGround() {
    const size = 220
    const seg = 110
    const geo = new THREE.PlaneGeometry(size, size, seg, seg)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const colors: number[] = []
    const base = new THREE.Color('#5d7a3a')
    const dry = new THREE.Color('#8a8a4a')
    const dark = new THREE.Color('#40592a')
    const rand = seededRandom(42)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const dist = Math.hypot(x, z - 2)
      // Colinas suaves da Zona da Mata longe da usina (área da usina terraplanada)
      const hill = Math.max(0, dist - 34) / 40
      const y = hill * hill * (3 + 2.2 * Math.sin(x * 0.07) + 1.6 * Math.cos(z * 0.05 + 1))
      pos.setY(i, y - this.riverDepthAt(x, z))
      const n = 0.5 + 0.5 * Math.sin(x * 0.31 + z * 0.17) * Math.cos(z * 0.23)
      const c = base.clone().lerp(n > 0.6 ? dry : dark, Math.abs(n - 0.5) * 0.9 + rand() * 0.08)
      colors.push(c.r, c.g, c.b)
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }))
    ground.receiveShadow = true
    this.scene.add(ground)

    // Brita sob a usina e estrada de terra
    const gravel = new THREE.Mesh(
      new THREE.PlaneGeometry(this.tableWidth * 2 + this.plant.layout.columnGapM + 6, this.plant.layout.pitchM * 4 + 4),
      new THREE.MeshStandardMaterial({ color: '#8f8b7e', roughness: 1 }),
    )
    gravel.rotation.x = -Math.PI / 2
    gravel.position.set(0, 0.02, -1.6)
    gravel.receiveShadow = true
    this.scene.add(gravel)

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 80),
      new THREE.MeshStandardMaterial({ color: '#9c7a55', roughness: 1 }),
    )
    road.rotation.x = -Math.PI / 2
    road.rotation.z = 0.18
    road.position.set(22, 0.03, -52)
    road.receiveShadow = true
    this.scene.add(road)
  }

  /** Curva do rio (ao sul da usina, meandrando de oeste para leste). */
  private riverCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-115, 0, 30),
    new THREE.Vector3(-70, 0, 42),
    new THREE.Vector3(-35, 0, 28),
    new THREE.Vector3(0, 0, 36),
    new THREE.Vector3(30, 0, 48),
    new THREE.Vector3(62, 0, 34),
    new THREE.Vector3(115, 0, 44),
  ])
  private riverSamples = this.riverCurve.getSpacedPoints(160)

  private riverDepthAt(x: number, z: number): number {
    let min = Infinity
    for (const p of this.riverSamples) min = Math.min(min, Math.hypot(p.x - x, p.z - z))
    return min < 6 ? (1 - min / 6) * 1.1 : 0
  }

  private ribbon(width: number, y: number): THREE.BufferGeometry {
    const pts = this.riverSamples
    const verts: number[] = []
    const uvs: number[] = []
    const idx: number[] = []
    let acc = 0
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const next = pts[Math.min(i + 1, pts.length - 1)]
      const prev = pts[Math.max(i - 1, 0)]
      const dir = next.clone().sub(prev).normalize()
      const nrm = new THREE.Vector3(-dir.z, 0, dir.x)
      const w = width * (0.85 + 0.15 * Math.sin(i * 0.4))
      verts.push(p.x + nrm.x * w, y, p.z + nrm.z * w, p.x - nrm.x * w, y, p.z - nrm.z * w)
      if (i > 0) acc += p.distanceTo(prev)
      uvs.push(acc / 18, 0, acc / 18, 1)
      if (i < pts.length - 1) {
        const a = i * 2
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    return geo
  }

  private buildRiver(label: string) {
    const bank = new THREE.Mesh(this.ribbon(6.2, -0.35), new THREE.MeshStandardMaterial({ color: '#6b5a3e', roughness: 1 }))
    bank.receiveShadow = true
    const tex = createWaterTexture()
    tex.repeat.set(1, 1)
    const water = new THREE.Mesh(
      this.ribbon(4.2, -0.3),
      new THREE.MeshStandardMaterial({ map: tex, color: '#4a8fae', roughness: 0.18, metalness: 0.15, transparent: true, opacity: 0.94 }),
    )
    water.receiveShadow = true
    this.scene.add(bank, water)

    // Mata ciliar: árvores ao longo das margens (projetam sombra, mas longe das mesas)
    const rand = seededRandom(7)
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4630', roughness: 1 })
    const leafMats = ['#2f5d2a', '#3b6b2f', '#2a4f26'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }))
    const crown = new THREE.IcosahedronGeometry(1, 0)
    const trunk = new THREE.CylinderGeometry(0.18, 0.26, 2.2, 6)
    for (let i = 0; i < this.riverSamples.length; i += 2) {
      for (const side of [-1, 1]) {
        if (rand() < 0.45) continue
        const p = this.riverSamples[i]
        const next = this.riverSamples[Math.min(i + 1, this.riverSamples.length - 1)]
        const dir = next.clone().sub(p).normalize()
        const off = 7 + rand() * 6
        const x = p.x - dir.z * off * side + (rand() - 0.5) * 3
        const z = p.z + dir.x * off * side + (rand() - 0.5) * 3
        if (z < 24) continue // mantém faixa livre ao sul da usina
        const s = 1.4 + rand() * 1.6
        const tr = new THREE.Mesh(trunk, trunkMat)
        tr.position.set(x, 1.1 * s * 0.8, z)
        tr.scale.setScalar(s * 0.8)
        const cr = new THREE.Mesh(crown, leafMats[Math.floor(rand() * 3)])
        cr.position.set(x, 2.4 * s, z)
        cr.scale.set(1.6 * s, 1.4 * s, 1.6 * s)
        tr.castShadow = cr.castShadow = true
        this.scene.add(tr, cr)
      }
    }

    const sprite = createLabelSprite(label, { color: '#d8f0ff', background: 'rgba(20,60,80,0.75)', scale: 0.8 })
    const at = this.riverCurve.getPoint(0.47)
    sprite.position.set(at.x, 3.5, at.z)
    this.scene.add(sprite)
    return tex
  }

  private tablePosition(tableIndex: number) {
    const { pitchM, columnGapM } = this.plant.layout
    const col = tableIndex < 4 ? -1 : 1
    const row = tableIndex % 4
    return {
      x: col * (this.tableWidth / 2 + columnGapM / 2),
      z: -1.5 * pitchM + row * pitchM - 1.6,
    }
  }

  private buildTables() {
    const { module } = this.plant
    const cellTex = createCellTexture()
    const moduleGeo = new THREE.BoxGeometry(module.widthM, 0.04, module.lengthM)
    const frameMat = new THREE.MeshStandardMaterial({ color: '#b8c0c8', metalness: 0.7, roughness: 0.35 })
    const legGeo = new THREE.BoxGeometry(0.09, 1, 0.09)

    for (const s of this.plant.strings) {
      const { x, z } = this.tablePosition(s.tableIndex)
      const pivot = new THREE.Group()
      pivot.position.set(x, 0, z)
      const holder = new THREE.Group() // gira com a inclinação
      pivot.add(holder)

      const material = new THREE.MeshStandardMaterial({
        map: cellTex,
        color: 0xffffff,
        metalness: 0.35,
        roughness: 0.28,
        emissive: new THREE.Color(0x000000),
      })
      const sideMat = frameMat
      // Faces do Box: +x,-x,+y,-y,+z,-z → célula só no topo
      const mats = [sideMat, sideMat, material, sideMat, sideMat, sideMat]

      const { modulesAcross, modulesHigh } = this.plant.layout
      for (let i = 0; i < modulesAcross; i++) {
        for (let j = 0; j < modulesHigh; j++) {
          const m = new THREE.Mesh(moduleGeo, mats)
          m.position.set(
            (i - (modulesAcross - 1) / 2) * (module.widthM + 0.02),
            0,
            (j - (modulesHigh - 1) / 2) * (module.lengthM + 0.02),
          )
          m.castShadow = true
          m.receiveShadow = true
          m.userData.pickId = s.id
          holder.add(m)
          this.pickables.push(m)
        }
      }
      // Trilhos da estrutura sob os módulos
      for (const zOff of [-this.tableLength / 4, this.tableLength / 4]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(this.tableWidth, 0.06, 0.08), frameMat)
        rail.position.set(0, -0.06, zOff)
        rail.castShadow = true
        holder.add(rail)
      }

      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(this.tableWidth + 0.3, 0.12, this.tableLength + 0.3)),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
      )
      holder.add(outline)

      const legsFront: THREE.Mesh[] = []
      const legsBack: THREE.Mesh[] = []
      for (const lx of [-0.45, -0.15, 0.15, 0.45]) {
        const f = new THREE.Mesh(legGeo, frameMat)
        const b = new THREE.Mesh(legGeo, frameMat)
        f.position.x = b.position.x = lx * this.tableWidth
        f.castShadow = b.castShadow = true
        pivot.add(f, b)
        legsFront.push(f)
        legsBack.push(b)
      }

      const label = createLabelSprite(s.id, { scale: 0.75 })
      pivot.add(label)

      this.scene.add(pivot)
      this.tables.set(s.id, { pivot, holder, material, outline, legsFront, legsBack, label })
    }
  }

  private buildInverterHouse() {
    const house = new THREE.Group()
    house.position.set(this.tableWidth + 10, 0, -22)
    const walls = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 3.6), new THREE.MeshStandardMaterial({ color: '#d9d2c3', roughness: 0.9 }))
    walls.position.y = 1.5
    const roof = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.2, 4.4), new THREE.MeshStandardMaterial({ color: '#7a3d2a', roughness: 0.8 }))
    roof.position.y = 3.15
    roof.rotation.x = -0.08
    walls.castShadow = roof.castShadow = true
    walls.receiveShadow = true
    house.add(walls, roof)

    // Inversores na parede oeste (voltada para a usina)
    this.plant.inverters.forEach((inv, i) => {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 1.1, 0.8),
        new THREE.MeshStandardMaterial({ color: '#eef1f4', roughness: 0.5, metalness: 0.1 }),
      )
      box.position.set(-2.7, 1.6, -0.8 + i * 1.6)
      box.castShadow = true
      box.userData.pickId = inv.id
      this.pickables.push(box)
      this.inverterBoxes.set(inv.id, box)
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshBasicMaterial({ color: STATUS_LED.producing }))
      led.position.set(-2.9, 1.95, -0.8 + i * 1.6)
      this.inverterLeds.set(inv.id, led)
      const lbl = createLabelSprite(inv.id, { scale: 0.65 })
      lbl.position.set(-3.4, 3.2 + i * 2.2, -0.8 + i * 1.6)
      house.add(box, led, lbl)
    })

    // Cabos (eletrocalha) da usina até a casa
    const tray = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: '#555d66', metalness: 0.5, roughness: 0.6 }))
    tray.position.set(this.tableWidth + 3.6, 0.1, -22)
    // Poste com transformador da distribuidora (padrão de entrada rural)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 9, 8), new THREE.MeshStandardMaterial({ color: '#9aa0a6' }))
    pole.position.set(this.tableWidth + 17, 4.5, -26)
    const trafo = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.2, 12), new THREE.MeshStandardMaterial({ color: '#7d8791', metalness: 0.4 }))
    trafo.position.set(this.tableWidth + 17.6, 6.2, -26)
    pole.castShadow = trafo.castShadow = true
    this.scene.add(house, tray, pole, trafo)
  }

  private buildFence() {
    const { pitchM, columnGapM } = this.plant.layout
    const halfW = this.tableWidth + columnGapM / 2 + 4
    const zMin = -2 * pitchM - 5
    const zMax = 2 * pitchM + 2
    const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.6, 5)
    const postMat = new THREE.MeshStandardMaterial({ color: '#7b6a54' })
    const corners: [number, number][] = [[-halfW, zMin], [halfW, zMin], [halfW, zMax], [-halfW, zMax], [-halfW, zMin]]
    const linePts: THREE.Vector3[] = []
    for (let c = 0; c < 4; c++) {
      const [x1, z1] = corners[c]
      const [x2, z2] = corners[c + 1]
      const len = Math.hypot(x2 - x1, z2 - z1)
      const n = Math.ceil(len / 3)
      for (let i = 0; i < n; i++) {
        const f = i / n
        const post = new THREE.Mesh(postGeo, postMat)
        post.position.set(x1 + (x2 - x1) * f, 0.8, z1 + (z2 - z1) * f)
        this.scene.add(post)
      }
      for (const h of [0.6, 1.2]) linePts.push(new THREE.Vector3(x1, h, z1), new THREE.Vector3(x2, h, z2))
    }
    const wire = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePts), new THREE.LineBasicMaterial({ color: 0x9ca3af, transparent: true, opacity: 0.6 }))
    this.scene.add(wire)
  }

  private buildCompass(north: string) {
    const g = new THREE.Group()
    g.position.set(-this.tableWidth - 12, 0.05, -20)
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.5, 48), new THREE.MeshBasicMaterial({ color: 0xe6ebf1, transparent: true, opacity: 0.7 }))
    ring.rotation.x = -Math.PI / 2
    const arrowShape = new THREE.Shape()
    arrowShape.moveTo(0, 3)
    arrowShape.lineTo(0.8, 0)
    arrowShape.lineTo(0, 0.5)
    arrowShape.lineTo(-0.8, 0)
    arrowShape.closePath()
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: 0xd03b3b }))
    arrow.rotation.x = -Math.PI / 2 // forma aponta para +y → após rotação aponta para −z (norte)
    arrow.position.y = 0.01
    const label = createLabelSprite(north, { color: '#ffffff', background: 'rgba(208,59,59,0.9)', scale: 0.9 })
    label.position.set(0, 1.2, -4.6)
    g.add(ring, arrow, label)
    this.scene.add(g)
  }

  // ---------------------------------------------------------------- atualização

  update(state: SceneState) {
    this.applyTilt(state.tiltDeg)
    this.setRain(state.rain)
    this.applySun(state.sun.azimuth, state.sun.elevation)
    this.applySunPath(state.sunPath)
    this.applyHealth(state)
  }

  private applyTilt(tiltDeg: number) {
    const t = THREE.MathUtils.degToRad(tiltDeg)
    const half = this.tableLength / 2
    const clearance = this.plant.layout.clearanceM
    const centerY = clearance + half * Math.sin(t)
    for (const tb of this.tables.values()) {
      // Face voltada ao norte: a borda norte (−z) fica baixa, a borda sul alta
      tb.holder.rotation.x = -t
      tb.holder.position.y = centerY
      const zFront = -half * Math.cos(t) * 0.85
      const zBack = half * Math.cos(t) * 0.85
      const hFront = clearance + half * 0.15 * Math.sin(t)
      const hBack = centerY + half * 0.85 * Math.sin(t)
      tb.legsFront.forEach((l) => {
        l.scale.y = hFront
        l.position.set(l.position.x, hFront / 2, zFront)
      })
      tb.legsBack.forEach((l) => {
        l.scale.y = hBack
        l.position.set(l.position.x, hBack / 2, zBack)
      })
      tb.label.position.set(0, centerY + half * Math.sin(t) + 1.4, 0)
    }
  }

  private applySun(azimuth: number, elevation: number) {
    const [x, y, z] = sunVector(azimuth, elevation)
    const dir = new THREE.Vector3(x, y, z)
    this.sunLight.position.copy(dir.clone().multiplyScalar(80))
    this.sunLight.target.position.set(0, 0, 0)
    this.sunMesh.position.copy(dir.clone().multiplyScalar(SUN_DISTANCE))
    this.sunMesh.visible = elevation > -2

    const el = Math.max(-10, elevation)
    const dayFactor = THREE.MathUtils.smoothstep(el, -4, 18)
    const duskFactor = 1 - Math.min(1, Math.abs(el - 4) / 14)
    const overcast = this.rainIntensity
    this.sunLight.intensity = 3 * THREE.MathUtils.smoothstep(el, -1, 12) * (1 - 0.8 * overcast)
    this.sunLight.color.set(0xffffff).lerp(new THREE.Color(0xff9a5a), duskFactor * 0.7)
    this.hemi.intensity = (0.32 + 0.45 * dayFactor) * (1 - 0.15 * overcast)

    const sky = this.skyNight
      .clone()
      .lerp(this.skyDay, dayFactor)
      .lerp(this.skyDusk, duskFactor * 0.55 * (1 - overcast))
      .lerp(this.skyRain.clone().multiplyScalar(0.25 + 0.75 * dayFactor), overcast * 0.85)
    const fog = this.scene.fog as THREE.Fog
    fog.near = 120 - 40 * overcast
    fog.far = 260 - 70 * overcast
    this.sunMesh.visible = this.sunMesh.visible && overcast < 0.5
    this.scene.background = sky
    ;(this.scene.fog as THREE.Fog).color.copy(sky)
    ;(this.sunMesh.material as THREE.MeshBasicMaterial).color.set(0xffe08a).lerp(new THREE.Color(0xff8a4a), duskFactor)
  }

  private applySunPath(path: [number, number][]) {
    const pts = path
      .filter(([, el]) => el > -1)
      .map(([az, el]) => new THREE.Vector3(...sunVector(az, el)).multiplyScalar(SUN_DISTANCE))
    this.sunPathLine.geometry.dispose()
    this.sunPathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts)
    this.sunPathLine.computeLineDistances()
  }

  private applyHealth(state: SceneState) {
    for (const [id, tb] of this.tables) {
      const health = state.stringHealth[id] ?? 'ok'
      const highlight = state.heatmap && health !== 'ok' && health !== 'info'
      tb.material.emissive.setHex(state.heatmap ? HEALTH_EMISSIVE[health] : 0x000000)
      tb.material.emissiveIntensity = highlight ? 0.55 : state.heatmap ? 0.12 : 0
      const sel = state.selected === id || state.selected === this.plant.strings.find((s) => s.id === id)?.inverterId
      const hov = this.hovered === id
      const outlineMat = tb.outline.material as THREE.LineBasicMaterial
      outlineMat.opacity = sel ? 1 : hov ? 0.55 : 0
      outlineMat.color.setHex(sel ? 0xffd36b : 0xffffff)
    }
    for (const [id, led] of this.inverterLeds) {
      const st = state.inverterStatus[id] ?? 'offline'
      ;(led.material as THREE.MeshBasicMaterial).color.setHex(STATUS_LED[st])
      const box = this.inverterBoxes.get(id)!
      ;(box.material as THREE.MeshStandardMaterial).emissive.setHex(state.selected === id ? 0x806010 : 0x000000)
    }
    this.lastState = state
  }

  private lastState: SceneState | null = null

  // ---------------------------------------------------------------- chuva

  private buildRain() {
    const positions = new Float32Array(RAIN_DROPS * 6)
    this.rainSpeed = new Float32Array(RAIN_DROPS)
    for (let i = 0; i < RAIN_DROPS; i++) {
      const x = (Math.random() * 2 - 1) * RAIN_BOX.x
      const z = (Math.random() * 2 - 1) * RAIN_BOX.z + 4
      const y = Math.random() * RAIN_BOX.top
      const len = 0.9 + Math.random() * 0.8
      positions.set([x, y, z, x + 0.12, y + len, z - 0.05], i * 6)
      this.rainSpeed[i] = 26 + Math.random() * 12
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.LineBasicMaterial({ color: 0xc9dcef, transparent: true, opacity: 0.55, depthWrite: false })
    this.rainMesh = new THREE.LineSegments(geo, mat)
    this.rainMesh.frustumCulled = false
    this.scene.add(this.rainMesh)
  }

  private setRain(intensity: number) {
    this.rainIntensity = Math.max(0, Math.min(1, intensity))
    if (this.rainIntensity > 0 && !this.rainMesh) this.buildRain()
    if (this.rainMesh) {
      this.rainMesh.visible = this.rainIntensity > 0
      this.rainMesh.geometry.setDrawRange(0, Math.round(RAIN_DROPS * (0.25 + 0.75 * this.rainIntensity)) * 2)
      ;(this.rainMesh.material as THREE.LineBasicMaterial).opacity = 0.3 + 0.35 * this.rainIntensity
    }
  }

  private animateRain(dt: number) {
    if (!this.rainMesh || !this.rainSpeed || this.rainIntensity <= 0) return
    const attr = this.rainMesh.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    const step = Math.min(dt, 0.05)
    for (let i = 0; i < RAIN_DROPS; i++) {
      const o = i * 6
      const dy = this.rainSpeed[i] * step
      arr[o + 1] -= dy
      arr[o + 4] -= dy
      arr[o] -= dy * 0.12
      arr[o + 3] -= dy * 0.12
      if (arr[o + 1] < 0) {
        const len = arr[o + 4] - arr[o + 1]
        const x = (Math.random() * 2 - 1) * RAIN_BOX.x
        arr[o] = x
        arr[o + 3] = x + 0.12
        arr[o + 1] = RAIN_BOX.top
        arr[o + 4] = RAIN_BOX.top + len
      }
    }
    attr.needsUpdate = true
  }

  // ---------------------------------------------------------------- interação

  private pick(e: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0]
    return (hit?.object.userData.pickId as string | undefined) ?? null
  }

  private downAt: { x: number; y: number } | null = null

  private handlePointerDown = (e: PointerEvent) => {
    this.downAt = { x: e.clientX, y: e.clientY }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointerup', up)
      // Clique (não arraste de órbita)
      if (this.downAt && Math.hypot(ev.clientX - this.downAt.x, ev.clientY - this.downAt.y) < 5) {
        this.onPick(this.pick(ev))
      }
      this.downAt = null
    }
    window.addEventListener('pointerup', up)
  }

  private handlePointerMove = (e: PointerEvent) => {
    if (this.downAt) return
    const id = this.pick(e)
    if (id !== this.hovered) {
      this.hovered = id
      this.renderer.domElement.style.cursor = id ? 'pointer' : 'grab'
      if (this.lastState) this.applyHealth(this.lastState)
    }
  }

  private resize() {
    const w = this.container.clientWidth
    const h = Math.max(1, this.container.clientHeight)
    const aspect = w / h
    // Desloca o enquadramento para a esquerda quando os controles sobrepõem a direita
    const shift = w > 760 ? this.frustum * aspect * 0.22 : 0
    this.camera.left = -this.frustum * aspect + shift
    this.camera.right = this.frustum * aspect + shift
    this.camera.top = this.frustum
    this.camera.bottom = -this.frustum
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
  }

  dispose() {
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    this.resizeObserver.disconnect()
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.removeEventListener('pointermove', this.handlePointerMove)
    this.controls.dispose()
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      mesh.geometry?.dispose?.()
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat?.dispose?.()
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

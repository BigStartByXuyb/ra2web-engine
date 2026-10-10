import { RA2_ISO_VIEW, cellToScreen } from '@ra2web/render'
import { readMap, readMixEntry, readMixIndex, type MapFile } from '@ra2web/formats'
import { TICKS_PER_SECOND, enqueueCommand, fromFixed, step, type Cell } from '@ra2web/sim'
import { createBattle, createDemoBattle, type Battle } from './battle.js'
import { MIN_ZOOM, canvasToCell, canvasToWorld, createCamera, viewScale, zoomAt, type Camera } from './camera.js'
import { drawScene } from './draw.js'
import { createHud } from './hud.js'
import { buildMapPreview, type MapPreview } from './map-preview.js'
import { openTileLayer } from './tile-layer.js'
import { pickUnit } from './picking.js'
import { facingFromDelta, buildDemoUnitArt, loadUnitArt, type UnitArt } from './unit-art.js'

/**
 * 战场入口：一局可玩的切片。
 *
 * 模拟按 15 tick/秒推进（`TICKS_PER_SECOND`），渲染每帧只读一次状态；
 * 每次右键都进 `sim` 的指令队列，等价于将来联机里的一个输入包。
 */

const VIEW = RA2_ISO_VIEW
const TICK_MS = 1000 / TICKS_PER_SECOND
const MAX_CATCH_UP_TICKS = 5
const MAP_SIZE = { width: 32, height: 32 }
const OWNER_TINT = ['rgba(90, 150, 255, 0.35)', 'rgba(255, 90, 90, 0.35)']

const BATTLE_SPAWNS = [
  { unitId: 'HTNK', owner: 0, cell: { x: 3, y: 3 } },
  { unitId: 'HTNK', owner: 0, cell: { x: 3, y: 6 } },
  { unitId: 'SMCV', owner: 0, cell: { x: 5, y: 4 } },
  { unitId: 'MTNK', owner: 1, cell: { x: 28, y: 28 } },
  { unitId: 'MTNK', owner: 1, cell: { x: 26, y: 30 } },
  { unitId: 'HTNK', owner: 1, cell: { x: 29, y: 25 } },
]

interface PanDrag {
  readonly pointerId: number
  readonly clientX: number
  readonly clientY: number
  readonly cameraX: number
  readonly cameraY: number
}

const canvas = document.getElementById('stage') as HTMLCanvasElement
const mixInput = document.getElementById('mix-file') as HTMLInputElement
const demoButton = document.getElementById('demo-battle') as HTMLButtonElement
const mapInput = document.getElementById('map-file') as HTMLInputElement
const fitButton = document.getElementById('fit-map') as HTMLButtonElement
const status = document.getElementById('status')!
const hud = createHud({
  tick: document.getElementById('hud-tick')!,
  fps: document.getElementById('hud-fps')!,
  zoom: document.getElementById('hud-zoom')!,
  cell: document.getElementById('hud-cell')!,
  selected: document.getElementById('hud-selected')!,
  units: document.getElementById('hud-units')!,
})

const camera: Camera = createCamera()
const lastPosition: Array<{ x: number; y: number } | undefined> = []
let battle: Battle | undefined
let mapPreview: MapPreview | undefined
let gameArchive: Uint8Array | undefined
let artByUnit: readonly (UnitArt | undefined)[] = []
let accumulator = 0
let lastFrameAt = 0
let hoverCell: Cell | undefined
let pan: PanDrag | undefined

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  canvas.setPointerCapture(event.pointerId)
  pan = undefined
  const index = battle ? pickUnit(battle, artByUnit, VIEW, pointerWorld(event)) : undefined
  if (battle && index !== undefined) {
    battle.selectedIndex = index
    return
  }
  pan = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    cameraX: camera.x,
    cameraY: camera.y,
  }
})

canvas.addEventListener('pointermove', (event) => {
  hoverCell = canvasToCell(camera, VIEW, ...pointerCanvas(event))
  if (!pan || pan.pointerId !== event.pointerId) return
  camera.x = pan.cameraX - (event.clientX - pan.clientX) / camera.zoom
  camera.y = pan.cameraY - (event.clientY - pan.clientY) / camera.zoom
})

canvas.addEventListener('pointerup', (event) => {
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  const wasPanning = pan !== undefined
  pan = undefined
  if (wasPanning || event.button !== 0 || !battle) return
  battle.selectedIndex = pickUnit(battle, artByUnit, VIEW, pointerWorld(event))
})

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  const selected = battle?.selectedIndex
  if (!battle || selected === undefined) return
  const unit = battle.world.units[selected]
  if (!unit) return
  const target = canvasToCell(camera, VIEW, ...pointerCanvas(event))
  enqueueCommand(battle.world, battle.world.tick, {
    kind: 'move',
    unitId: unit.id,
    target: { x: Math.round(target.x), y: Math.round(target.y) },
  })
})

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    zoomAt(camera, ...pointerCanvas(event), event.deltaY < 0 ? 1.15 : 1 / 1.15)
  },
  { passive: false },
)

window.addEventListener('resize', resizeCanvas)

demoButton.addEventListener('click', () => {
  const created = createDemoBattle()
  artByUnit = buildArt(created, undefined)
  activate(created, '内置示例战场：合成模型 + 固定数值（不是原版数值）')
})

mapInput.addEventListener('change', () => {
  const file = mapInput.files?.[0]
  if (!file) return
  status.textContent = `读取 ${file.name}…`
  void file.arrayBuffer().then(
    (buffer) => {
      try {
        const bytes = new Uint8Array(buffer)
        const map = /\.map$/i.test(file.name) ? readMap(bytes) : readFirstMap(bytes)
        const tileLayer = gameArchive && map.theater ? openTileLayer(gameArchive, map.theater) : undefined
        mapPreview = buildMapPreview(map, tileLayer)
        battle = undefined
        artByUnit = []
        status.textContent = tileLayer
          ? `地图 ${map.width}×${map.height}（${map.theater}），地形记录 ${map.cells.length} 条 —— 地块美术已从剧场档案加载`
          : `地图 ${map.width}×${map.height}（${map.theater ?? '未知剧场'}），地形记录 ${map.cells.length} 条 —— 先在上面选 RA2.MIX 才能加载地块美术（现在按 z 高度着色）`
        // 默认 1:1（原版像素尺寸）：整张地图约 5000×2500 像素，整幅看会很小，想看全局再点"整幅显示"
        camera.zoom = 1
        centerOn(map.width / 2, map.height / 2)
        startLoop()
      } catch (error) {
        status.textContent = error instanceof Error ? `失败：${error.message}` : '失败'
      }
    },
    (error: unknown) => {
      status.textContent = `读取失败：${String(error)}`
    },
  )
})

fitButton.addEventListener('click', () => {
  const preview = mapPreview
  if (!preview) return
  fitOn(preview.width, preview.height)
})

mixInput.addEventListener('change', () => {
  const file = mixInput.files?.[0]
  if (!file) return
  status.textContent = `读取 ${file.name}…`
  void file.arrayBuffer().then(
    (buffer) => {
      const bytes = new Uint8Array(buffer)
      gameArchive = bytes
      try {
        const created = createBattle(bytes, {
          ...MAP_SIZE,
          blocked: buildBlockedCells(),
          spawns: BATTLE_SPAWNS,
          seed: 20261010,
        })
        artByUnit = buildArt(created, bytes)
        activate(created, `已装载 ${created.world.units.length} 个单位：数值来自 rules.ini，美术来自 <单位>.vxl`)
      } catch (error) {
        battle = undefined
        artByUnit = []
        status.textContent = error instanceof Error ? `失败：${error.message}` : '失败'
      }
    },
    (error: unknown) => {
      status.textContent = `读取失败：${String(error)}`
    },
  )
})

/** 装入一局：接上美术、把镜头对准己方第一辆车、开始循环。 */
function activate(created: Battle, message: string): void {
  battle = created
  mapPreview = undefined
  lastPosition.length = 0
  status.textContent = message
  const first = created.world.units[0]
  centerOn(first ? fromFixed(first.x) : 3, first ? fromFixed(first.y) : 3)
  startLoop()
}

function startLoop(): void {
  if (!lastFrameAt) {
    lastFrameAt = performance.now()
    requestAnimationFrame(frame)
  }
}

/** 地图档案里条目顺序不保证都是地图：取前几条里第一个能解析成地图的。 */
function readFirstMap(bytes: Uint8Array): MapFile {
  const index = readMixIndex(bytes)
  for (const entry of index.entries) {
    try {
      return readMap(readMixEntry(bytes, index, entry))
    } catch {
      // 不是地图就试下一条；全都不是时由下面的报错说明
    }
  }
  throw new Error('档案里没有可解析的地图')
}

/** 真实战场按类型取原版 VXL；示例战场用合成模型并按阵营着色。 */
function buildArt(created: Battle, archiveBytes: Uint8Array | undefined): readonly (UnitArt | undefined)[] {
  const cache = new Map<string, UnitArt | undefined>()
  return created.world.units.map((unit, index) => {
    const typeId = created.typeByUnit[index] ?? 'unknown'
    const key = `${typeId}:${unit.owner}`
    if (!cache.has(key)) {
      const tint = OWNER_TINT[unit.owner % OWNER_TINT.length]
      cache.set(key, archiveBytes ? loadUnitArt(archiveBytes, typeId) : buildDemoUnitArt(typeId, tint))
    }
    return cache.get(key)
  })
}

function frame(now: number): void {
  const elapsed = now - lastFrameAt
  lastFrameAt = now
  accumulator = Math.min(accumulator + elapsed, TICK_MS * MAX_CATCH_UP_TICKS)
  if (battle) {
    while (accumulator >= TICK_MS) {
      updateFacings(battle)
      step(battle.world)
      accumulator -= TICK_MS
    }
  }
  drawScene({ canvas, camera, battle, mapPreview, artByUnit, hoverCell })
  hud.update(now, { battle, mapPreview, camera, hoverCell })
  requestAnimationFrame(frame)
}

/** 朝向取自两帧之间的位移：模拟只推进位置，朝向属于表现层。 */
function updateFacings(active: Battle): void {
  active.world.units.forEach((unit, index) => {
    const x = fromFixed(unit.x)
    const y = fromFixed(unit.y)
    const previous = lastPosition[index]
    if (previous && (previous.x !== x || previous.y !== y)) {
      active.facingByUnit[index] = facingFromDelta(x - previous.x, y - previous.y)
    }
    lastPosition[index] = { x, y }
  })
}

function centerOn(cellX: number, cellY: number): void {
  const point = cellToScreen(VIEW, { x: cellX, y: cellY })
  const scale = viewScale(camera)
  camera.x = point.x - canvas.width / scale / 2
  camera.y = point.y - canvas.height / scale / 2
}

/** 把整张地图放进画布：按投影后的包围盒算缩放，再让地图中心对准画布中心。 */
function fitOn(width: number, height: number): void {
  // 等距投影下，W×H 的地图投影宽高都是 (W+H) 的一半格 | 半格
  const worldWidth = (width + height) * (VIEW.cellWidth / 2)
  const worldHeight = (width + height) * (VIEW.cellHeight / 2)
  const fit = Math.min(canvas.width / worldWidth, canvas.height / worldHeight)
  camera.zoom = Math.max(MIN_ZOOM, Math.min(1, fit))
  centerOn(width / 2, height / 2)
}

function resizeCanvas(): void {
  camera.pixelRatio = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.floor(window.innerWidth * camera.pixelRatio))
  canvas.height = Math.max(1, Math.floor(window.innerHeight * camera.pixelRatio))
}

function pointerCanvas(event: MouseEvent): [number, number] {
  return [event.offsetX * camera.pixelRatio, event.offsetY * camera.pixelRatio]
}

function pointerWorld(event: MouseEvent): { x: number; y: number } {
  return canvasToWorld(camera, ...pointerCanvas(event))
}

/** 32×32 的占位战场：一道带缺口的岩石带 + 两块掩体。 */
function buildBlockedCells(): readonly Cell[] {
  const blocked: Cell[] = []
  for (let y = 6; y < 26; y++) {
    if (y === 15 || y === 16) continue
    blocked.push({ x: 16, y })
  }
  for (let x = 20; x < 24; x++) {
    for (let y = 8; y < 11; y++) blocked.push({ x, y })
  }
  for (let x = 9; x < 12; x++) {
    for (let y = 22; y < 25; y++) blocked.push({ x, y })
  }
  return blocked
}

resizeCanvas()

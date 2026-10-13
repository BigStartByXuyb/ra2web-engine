import { RA2_ISO_VIEW, cellToScreen } from '@ra2web/render'
import { openTheater, type AssetOverride } from '@ra2web/assets'
import { readMap, readMixEntry, readMixIndex, type MapFile } from '@ra2web/formats'
import { TICKS_PER_SECOND, dirFromFacing, enqueueCommand, fromFixed, step, type Cell } from '@ra2web/sim'
import { createBattle, createDemoBattle, type Battle } from './battle.js'
import { planMapBattle } from './map-battle.js'
import { MIN_ZOOM, canvasToCell, canvasToWorld, createCamera, viewScale, zoomAt, type Camera } from './camera.js'
import { drawScene } from './draw.js'
import { createHud } from './hud.js'
import { buildMapPreview, type MapPreview } from './map-preview.js'
import { openOverlayLayer } from './overlay-layer.js'
import { waterFrameAt, waterTileRange } from './water-animation.js'
import { drawOfficialPreview } from './official-preview.js'
import { openStructureLayer } from './structure-layer.js'
import { openTileLayer } from './tile-layer.js'
import { loadHdTiles } from './hd-tiles.js'
import { pickUnit } from './picking.js'
import { createGlTileLayer, type GlTileLayer } from './webgl-tile-layer.js'
import { buildDemoUnitArt, loadUnitArt, type QualityPreset, type UnitArt } from './unit-art.js'

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
const glCanvas = document.getElementById('stage-gl') as HTMLCanvasElement
const mixInput = document.getElementById('mix-file') as HTMLInputElement
const demoButton = document.getElementById('demo-battle') as HTMLButtonElement
const mapInput = document.getElementById('map-file') as HTMLInputElement
const mapIndexInput = document.getElementById('map-index') as HTMLInputElement
const fitButton = document.getElementById('fit-map') as HTMLButtonElement
const mapBattleButton = document.getElementById('battle-on-map') as HTMLButtonElement
const qualitySelect = document.getElementById('quality') as HTMLSelectElement
const units3dSelect = document.getElementById('units3d') as HTMLSelectElement
const packInput = document.getElementById('pack-file') as HTMLInputElement
const status = document.getElementById('status')!
const notice = document.getElementById('notice') as HTMLDivElement
const previewBox = document.getElementById('official-preview-box') as HTMLDivElement
const previewCanvas = document.getElementById('official-preview') as HTMLCanvasElement
const hud = createHud({
  tick: document.getElementById('hud-tick')!,
  fps: document.getElementById('hud-fps')!,
  zoom: document.getElementById('hud-zoom')!,
  cell: document.getElementById('hud-cell')!,
  selected: document.getElementById('hud-selected')!,
  units: document.getElementById('hud-units')!,
})

const camera: Camera = createCamera()
let battle: Battle | undefined
let mapPreview: MapPreview | undefined
let gameArchive: Uint8Array | undefined
let loadedMap: MapFile | undefined
/** 当前地图档案（`.mix` 里有多张地图，切序号时直接用它重新读一张） */
let mapArchive: { readonly name: string; readonly bytes: Uint8Array } | undefined
let artByUnit: readonly (UnitArt | undefined)[] = []
/** 画质预设：影响单位体素的着色与超采样，也决定画布用什么方式放大 */
let quality: QualityPreset = 'pixel'
/** `?renderer=webgl` 时把地块层交给 WebGL 画（换渲染后端 spike） */
let glTiles: GlTileLayer | undefined
/** 实时阴影开关（重制版增强，默认关闭）：`?shadows=1` */
let shadows = false
/** 大气雾开关（重制版增强，默认关闭）：`?fog=1` */
let fogEffect = false
/** 湿地面倒影开关（重制版增强，默认关闭）：`?reflect=1` */
let reflections = false
/** 泛光开关（重制版增强，默认关闭）：`?bloom=1` */
let bloom = false
/** 真 3D 单位（B 路，默认关闭）：`?units3d=1`，模型从 `/packs/units3d/<单位>.glb` 取 */
let units3d = false
/** 水面动画（原版水面本来就动）；`?anim=0` 关掉，用于逐像素比对 */
let animateWater = true
/** 覆盖素材包（写实/超清包）：按次序优先命中，空数组就是纯原版 */
let overrides: readonly AssetOverride[] = []
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
  clampCameraToMap()
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

demoButton.addEventListener('click', async () => {
  const created = createDemoBattle()
  artByUnit = await buildArt(created, undefined)
  showPlaceholderNotice()
  activate(created, '内置示例战场：合成模型 + 固定数值（不是原版数值）')
})

mapInput.addEventListener('change', () => {
  const file = mapInput.files?.[0]
  if (!file) return
  status.textContent = `读取 ${file.name}…`
  void file.arrayBuffer().then(
    (buffer) => void openMapArchive(file.name, new Uint8Array(buffer), Number(mapIndexInput.value) || 0),
    (error: unknown) => {
      status.textContent = `读取失败：${String(error)}`
    },
  )
})

/** 打开一份地图档案：`.mix` 记住用于切序号，`.map` 是单张地图。 */
async function openMapArchive(fileName: string, bytes: Uint8Array, entryIndex: number): Promise<void> {
  mapArchive = /\.map$/i.test(fileName) ? undefined : { name: fileName, bytes }
  await showMap(bytes, fileName, entryIndex)
}

// 改序号就换地图：重选一次文件才能换图太别扭
mapIndexInput.addEventListener('change', () => {
  if (!mapArchive) return
  void showMap(mapArchive.bytes, mapArchive.name, Number(mapIndexInput.value) || 0)
})

// 换预设要重画单位美术（着色与超采样都在这一步决定），有战局时立刻重画
qualitySelect.addEventListener('change', async () => {
  quality = toQualityPreset(qualitySelect.value)
  if (battle) artByUnit = await buildArt(battle, gameArchive)
})

function toQualityPreset(value: string): QualityPreset {
  return value === 'hd' || value === 'wetNight' ? value : 'pixel'
}

// 单位画法：3D 模型 ↔ 原版 8 朝向贴图。开着时缺模型的类型照样退回贴图，所以这是个纯开关。
units3dSelect.addEventListener('change', () => {
  units3d = units3dSelect.value === '3d'
  // 3D 单位走 WebGL 单位层：非 WebGL 渲染器下选「3D 模型」时自动切渲染器并重载，
  // 不允许静默无效（总工 2026-10-12；此前开关变了画面毫无反应）。
  if (units3d && !glTiles) {
    const params = new URLSearchParams(location.search)
    params.set('renderer', 'webgl')
    params.set('units3d', '3d')
    location.search = params.toString()
    return
  }
  if (units3d && battle) void loadUnit3dModels(battle)
})

// 素材包：换包就重新装载当前地图（地块/覆盖物/建筑都要按新包重取）
packInput.addEventListener('change', () => {
  const files = [...(packInput.files ?? [])]
  if (files.length === 0) return
  void Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })))
    .then((packed) => {
      overrides = packed
      reloadCurrentMap()
      status.textContent = `已挂载覆盖素材包：${packed.map((pack) => pack.name).join('、')}`
    })
    .catch((error: unknown) => {
      status.textContent = `素材包读取失败：${String(error)}`
    })
})

/** 有地图档案就按当前素材包重装一遍；没有就什么都不做。 */
function reloadCurrentMap(): void {
  if (!mapArchive) return
  void showMap(mapArchive.bytes, mapArchive.name, Number(mapIndexInput.value) || 0)
}

/** 装载一张地图：接上地块/覆盖物美术与官方预览图，并把镜头对准地图中心。 */
async function showMap(bytes: Uint8Array, fileName: string, entryIndex: number): Promise<void> {
  try {
    const map = /\.map$/i.test(fileName) ? readMap(bytes) : readFirstMap(bytes, entryIndex)
    loadedMap = map
    // 高清地块也是真彩位图，同样要先解码
    const theater = gameArchive && map.theater ? openTheater(gameArchive, map.theater, overrides) : undefined
    const hdTiles = await loadHdTiles(theater, overrides)
    const tileLayer =
      gameArchive && map.theater ? openTileLayer(gameArchive, map.theater, overrides, hdTiles) : undefined
    const overlayLayer = gameArchive && map.theater ? openOverlayLayer(gameArchive, map.theater, overrides) : undefined
    // 素材包里的真彩贴图要先解码，所以建筑层这一步是异步的
    const structureLayer =
      gameArchive && map.theater
        ? await openStructureLayer(
            gameArchive,
            map.theater,
            overrides,
            map.placements.filter((placement) => placement.kind === 'structure').map((placement) => placement.type),
          )
        : undefined
    mapPreview = buildMapPreview(
      map,
      tileLayer,
      overlayLayer,
      structureLayer,
      theater ? waterTileRange(theater.ini) : undefined,
    )
    drawOfficialPreview(previewBox, previewCanvas, map)
    notice.hidden = true
    battle = undefined
    artByUnit = []
    const overlayCount = new Set(map.cells.map((cell) => cell.overlay?.id).filter((id) => id !== undefined)).size
    const structureCount = map.placements.filter((placement) => placement.kind === 'structure').length
    const mapLabel = mapArchive ? `${mapArchive.name} 第 ${entryIndex} 张` : fileName
    const terrainNote = tileLayer
      ? `地块与覆盖物美术已从剧场档案加载`
      : `先在上面选 RA2.MIX 才能加载地块美术（现在按 z 高度着色）`
    status.textContent =
      `${mapLabel}：地图 ${map.width}×${map.height}（${map.theater ?? '未知剧场'}）` +
      `，地形记录 ${map.cells.length} 条，覆盖物 ${overlayCount} 种 —— ${terrainNote}。` +
      `建筑 ${structureCount} 个（画出 ${mapPreview.structures.length} 个）。` +
      `现在是 1:1 原版像素尺寸，屏幕只装得下一部分：拖动平移、滚轮缩放，或点「整幅显示」看全图`
    // 默认 1:1（原版像素尺寸）：整张地图约 5000×2500 像素，整幅看会很小，想看全局再点"整幅显示"
    camera.zoom = 1
    centerOn(map.cellBounds.right / 2, map.cellBounds.bottom / 2)
    startLoop()
  } catch (error) {
    status.textContent = error instanceof Error ? `失败：${error.message}` : '失败'
  }
}

fitButton.addEventListener('click', () => {
  const preview = mapPreview
  if (!preview) return
  fitOn(preview.width, preview.height)
})

mapBattleButton.addEventListener('click', () => void startBattleOnMap())

/** 在当前地图上开战：按地块类型与高度差判定通行性，双方各找一个落脚点。 */
async function startBattleOnMap(): Promise<void> {
  if (!gameArchive) {
    status.textContent = '先选 RA2.MIX：单位数值与地块美术都在里面'
    return
  }
  if (!loadedMap) {
    status.textContent = '先选一张地图（地图档案或 .map）'
    return
  }
  const terrain = mapPreview
  const setup = planMapBattle(gameArchive, loadedMap)
  if (!setup || setup.spawns.length === 0) {
    status.textContent = '这张地图上找不到可通行的落脚点'
    return
  }
  if (setup.missingArt.cells > 0) {
    const where = [...setup.missingArt.bySet]
      .sort((left, right) => right[1] - left[1])
      .map(([name, count]) => `${name} ${count} 格`)
      .join('、')
    status.textContent =
      `这张图用到了本机资产里没有的地块图形：共 ${setup.missingArt.cells} 格缺图（${where}）。` +
      `原版客户端在这些格上会直接报"地块／子块找不到"，所以这里也不开这一局 —— 换一张图，或补上缺的那几个地块包。`
    return
  }
  try {
    const created = createBattle(gameArchive, {
      width: setup.width,
      height: setup.height,
      blocked: setup.blocked,
      blockedSteps: setup.blockedSteps,
      terrainSpeed: setup.terrainSpeed,
      heights: setup.heights,
      ...(spawnHealthPercent !== undefined ? { spawnHealthPercent } : {}),
      spawns: setup.spawns,
      seed: 20261010,
    })
    artByUnit = await buildArt(created, gameArchive)
    const unknownNote =
      setup.unknownTerrainTypes.length > 0
        ? `；有 ${setup.unknownTerrainTypes.length} 种未认识的 TMP 地形类型（${setup.unknownTerrainTypes.join('/')}）按不可通行处理`
        : ''
    activate(
      created,
      `官方地图开战：${setup.width}×${setup.height}，不可通行格 ${setup.blocked.length}` +
        `（按地块类型判定：${setup.landTypeSummary}），高度差不小于 2 的相邻格不能迈过去；` +
        `单位 ${setup.spawns.length} 辆${unknownNote}` +
        (spawnHealthPercent !== undefined
          ? `；上阵血量 ${spawnHealthPercent}%（伤车验证：血量 ≤ ConditionYellow 移速 ×0.75）`
          : ''),
      terrain,
    )
  } catch (error) {
    status.textContent = error instanceof Error ? `失败：${error.message}` : '失败'
  }
}

mixInput.addEventListener('change', () => {
  const file = mixInput.files?.[0]
  if (!file) return
  status.textContent = `读取 ${file.name}…`
  void file.arrayBuffer().then(
    (buffer) => loadGameArchive(new Uint8Array(buffer)),
    (error: unknown) => {
      status.textContent = `读取失败：${String(error)}`
    },
  )
})

/**
 * 装入原版档案：建一局内置示例战场（数值来自 rules.ini、美术来自 `<单位>.vxl`）。
 * 再选一张地图档案就会换成原版地形。
 */
async function loadGameArchive(bytes: Uint8Array): Promise<void> {
  gameArchive = bytes
  try {
    const created = createBattle(bytes, {
      ...MAP_SIZE,
      blocked: buildBlockedCells(),
      spawns: BATTLE_SPAWNS,
      seed: 20261010,
    })
    artByUnit = await buildArt(created, bytes)
    showPlaceholderNotice()
    activate(
      created,
      `已装载 ${created.world.units.length} 个单位：数值来自 rules.ini，美术来自 <单位>.vxl；` +
        `地形是内置示例战场 —— 再选一张地图档案就会换成原版地形`,
    )
  } catch (error) {
    battle = undefined
    artByUnit = []
    status.textContent = error instanceof Error ? `失败：${error.message}` : '失败'
  }
}

/** 装入一局：接上美术、把镜头对准己方第一辆车、开始循环。 */
function activate(created: Battle, message: string, terrain: MapPreview | undefined = undefined): void {
  battle = created
  mapPreview = terrain
  status.textContent = message
  void loadUnit3dModels(created)
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

/** 内置示例战场用的是合成地形：明说一句，别让人以为原版素材是灰的、糊的。 */
function showPlaceholderNotice(): void {
  notice.hidden = false
  notice.textContent = '当前地形是内置示例战场（合成地形，不是原版素材）：选一张地图档案，就会换成原版 TMP 地块'
}

/** 地图档案里条目顺序不保证都是地图：先试给定序号，失败再顺序找第一个能解析的。 */
function readFirstMap(bytes: Uint8Array, entryIndex: number): MapFile {
  const index = readMixIndex(bytes)
  const ordered = [index.entries[entryIndex], ...index.entries].filter(
    (entry): entry is NonNullable<typeof entry> => !!entry,
  )
  for (const entry of ordered) {
    try {
      return readMap(readMixEntry(bytes, index, entry))
    } catch {
      // 不是地图就试下一条；全都不是时由下面的报错说明
    }
  }
  throw new Error('档案里没有可解析的地图')
}

/** 真实战场按类型取原版 VXL（或素材包里的写实贴图）；示例战场用合成模型并按阵营着色。 */
async function buildArt(
  created: Battle,
  archiveBytes: Uint8Array | undefined,
): Promise<readonly (UnitArt | undefined)[]> {
  const cache = new Map<string, UnitArt | undefined>()
  const art = await Promise.all(
    created.world.units.map(async (unit, index) => {
      const typeId = created.typeByUnit[index] ?? 'unknown'
      const key = `${typeId}:${unit.owner}`
      if (!cache.has(key)) {
        const tint = OWNER_TINT[unit.owner % OWNER_TINT.length]
        cache.set(
          key,
          archiveBytes
            ? await loadUnitArt(archiveBytes, typeId, quality, overrides)
            : buildDemoUnitArt(typeId, tint, quality),
        )
      }
      return cache.get(key)
    }),
  )
  return art
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
  drawScene({
    canvas,
    camera,
    battle,
    mapPreview,
    artByUnit,
    hoverCell,
    quality,
    time: now,
    glTiles,
    glCanvas,
    shadows,
    fog: fogEffect,
    reflections,
    bloom,
    unit3d: (typeId) => (units3d ? glTiles?.unit3d(typeId) : undefined),
    waterFrame: waterFrameAt(now, mapPreview?.water, animateWater),
  })
  hud.update(now, { battle, mapPreview, camera, hoverCell })
  requestAnimationFrame(frame)
}

/** 朝向读模拟层的 facing（16 位角顺时针 0=北），折成渲染帧序号。 */
function updateFacings(active: Battle): void {
  active.world.units.forEach((unit, index) => {
    const dir = dirFromFacing(unit.facing)
    // sim 的 0 = 北；渲染器的帧 0 = 模型前方 +x（东）。北=帧 6、东=帧 0，故 +6 对齐。
    // 这个偏移对应渲染器的自定约定（原版 HVA 朝向编号对应关系未核，见 render 包 README）。
    active.facingByUnit[index] = (dir + 6) % 8
  })
}

function centerOn(cellX: number, cellY: number): void {
  const point = cellToScreen(VIEW, { x: cellX, y: cellY })
  const scale = viewScale(camera)
  camera.x = point.x - canvas.width / scale / 2
  camera.y = point.y - canvas.height / scale / 2
  clampCameraToMap()
}

/**
 * 相机夹取：可见视口不许拖出地图的世界包围盒。
 *
 * 地图在投影里是块菱形、格空间是 `MapPreview` 的 `width`×`height`（= `map.cellBounds`），
 * 所以包围盒由菱形四角决定：`worldX = (x − y)·30`、`worldY = (x + y)·15`。
 * 视口比地图大时居中，否则贴边 —— 原版同样拖不出地图，否则会看到菱形外那圈空白。
 */
function clampCameraToMap(): void {
  const preview = mapPreview
  if (!preview || preview.width <= 0 || preview.height <= 0) return
  const halfWidth = VIEW.cellWidth / 2
  const halfHeight = VIEW.cellHeight / 2
  const minX = -(preview.height - 1) * halfWidth - halfWidth
  const maxX = (preview.width - 1) * halfWidth + halfWidth
  const minY = -halfHeight
  const maxY = (preview.width - 1 + preview.height - 1) * halfHeight + halfHeight
  const scale = viewScale(camera)
  const viewWidth = canvas.width / scale
  const viewHeight = canvas.height / scale
  camera.x =
    maxX - minX <= viewWidth ? (minX + maxX - viewWidth) / 2 : Math.min(Math.max(camera.x, minX), maxX - viewWidth)
  camera.y =
    maxY - minY <= viewHeight ? (minY + maxY - viewHeight) / 2 : Math.min(Math.max(camera.y, minY), maxY - viewHeight)
  // 再夹一层"菱形"：地图真正的格集是斜置的菱形，`x + y` 落在 [cellSumMin, cellSumMax] 里，而 worldY = (x + y) · 15，
  // 所以只夹**相机中心的世界 Y** 就能把可玩区域收进菱形（角上那圈空拖不出来了）。
  const centerY = camera.y + viewHeight / 2
  camera.y =
    Math.min(Math.max(centerY, preview.cellSumMin * halfHeight), preview.cellSumMax * halfHeight) - viewHeight / 2
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
  glTiles?.resize(canvas.width, canvas.height)
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
startLoop()
if (new URLSearchParams(location.search).get('renderer') === 'webgl') {
  glTiles = createGlTileLayer(glCanvas)
  if (!glTiles) status.textContent = 'WebGL 不可用：仍在用 2D 画布渲染'
  else glTiles.resize(canvas.width, canvas.height)
}
shadows = new URLSearchParams(location.search).get('shadows') === '1'
fogEffect = new URLSearchParams(location.search).get('fog') === '1'
reflections = new URLSearchParams(location.search).get('reflect') === '1'
bloom = new URLSearchParams(location.search).get('bloom') === '1'
// 3D 单位默认开：重制画面就是默认档，模型缺失的类型自动退回 8 朝向贴图。
// 要比对"原版精灵"那条线（两条绘制路径逐像素一致、逐帧位置判据）时用 `?units3d=0`。
units3d = new URLSearchParams(location.search).get('units3d') !== '0'
// 水面动画默认开（原版水面本来就在动）。要逐像素比对（同一机位两次运行一致）时用 `?anim=0` ——
// 动画是按墙钟推进的，开着就不可能跨次截图逐像素相同。
animateWater = new URLSearchParams(location.search).get('anim') !== '0'
/** `?hp=45`：上阵单位按该百分比血量生成（伤车减速的人工验证入口，满血对照用 `?hp=100`）。
 *  只在 1..100 才生效，缺省满血。 */
const spawnHealthPercent = (() => {
  const raw = Number(new URLSearchParams(location.search).get('hp'))
  return Number.isFinite(raw) && raw >= 1 && raw <= 100 ? raw : undefined
})()
units3dSelect.value = units3d ? '3d' : '2d'
void autoLoadFromQuery()

/**
 * 3D 单位的模型槽位：`/packs/units3d/<单位>.glb` 是"最好的一版"，
 * `<单位>-voxel.glb` 是从原版 `<单位>.vxl` 直接转出来的体素版（形体与原版一致、面数少）。
 * 两档都按顺序试，谁先有就用谁 —— 素材包只要把模型放进这两个名字里，换模型不用改引擎。
 *
 * 找不到模型的类型什么都不做：它继续走 8 朝向贴图或原版体素，三种来源逐单位混用。
 */
const UNIT3D_SLOTS = ['', '-voxel'] as const

async function loadUnit3dModels(created: Battle): Promise<void> {
  if (!units3d || !glTiles) return
  for (const typeId of new Set(created.typeByUnit)) {
    if (glTiles.unit3d(typeId)) continue
    for (const slot of UNIT3D_SLOTS) {
      const url = `/packs/units3d/${typeId.toLowerCase()}${slot}.glb`
      try {
        const response = await fetch(url)
        if (!response.ok) continue
        glTiles.loadUnit3d(typeId, await response.arrayBuffer())
        console.info(`[3D] ${typeId} ← ${url}`)
        break
      } catch (error) {
        console.info(
          `[3D] ${typeId} 读 ${url} 失败（${error instanceof Error ? error.message : String(error)}），换下一个槽位`,
        )
      }
    }
  }
}

/**
 * 从 URL 参数自动装载，省掉每次手选档案：
 *
 * ```
 * game.html?mix=/pack/RA2.MIX&map=/pack/Maps01.mix&index=0&battle=1
 * ```
 *
 * `npm run game:serve` 会把原版档案目录挂到 `/pack/` 下，本地一条链接直接进战场。
 * 参数缺省时什么都不做，页面照旧走"手选文件"那条路。
 */
async function autoLoadFromQuery(): Promise<void> {
  const params = new URLSearchParams(location.search)
  const mixUrl = params.get('mix')
  const mapUrl = params.get('map')
  const packUrls = (params.get('pack') ?? '').split(',').filter((url) => url !== '')
  if (!mixUrl && !mapUrl && packUrls.length === 0) return
  try {
    if (packUrls.length > 0) {
      status.textContent = `读取素材包…`
      overrides = await Promise.all(
        packUrls.map(async (url) => ({ name: fileNameOf(url), bytes: await fetchBytes(url) })),
      )
    }
    if (mixUrl) {
      status.textContent = `读取 ${mixUrl}…`
      loadGameArchive(await fetchBytes(mixUrl))
    }
    if (mapUrl) {
      status.textContent = `读取 ${mapUrl}…`
      const index = Number(params.get('index')) || 0
      mapIndexInput.value = String(index)
      await openMapArchive(fileNameOf(mapUrl), await fetchBytes(mapUrl), index)
      if (params.get('battle') === '1') await startBattleOnMap()
    }
  } catch (error) {
    status.textContent = `自动装载失败：${error instanceof Error ? error.message : String(error)}`
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

function fileNameOf(url: string): string {
  const clean = url.split('?')[0] ?? url
  return clean.slice(clean.lastIndexOf('/') + 1) || 'map.mix'
}

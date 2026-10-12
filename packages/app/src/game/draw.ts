import { RA2_ISO_VIEW, cellToScreen } from '@ra2web/render'
import { fromFixed, isExplored, isVisible, unitCell } from '@ra2web/sim'
import type { Battle } from './battle.js'
import { viewScale, visibleCellRange, type Camera } from './camera.js'
import { drawMapPreview, type MapPreview } from './map-preview.js'
import { HOVER_COLOR, SELECTED_COLOR, drawTerrain, strokeCell } from './terrain.js'
import { blitFogCell, createFogSprites, type FogSprites } from './fog-layer.js'
import { BLOOM, applyBloom, applyWetNightGrade, drawWetReflection } from './post-process.js'
import type { GlTileLayer } from './webgl-tile-layer.js'
import type { GlUnitQuad } from './webgl-tile-layer.js'
import { isWetNight, type QualityPreset, type UnitArt } from './unit-art.js'

/**
 * 画面：每帧只读一次状态，不写任何模拟数据。
 *
 * 战争迷雾画在地形、覆盖物、建筑、单位**之上**：没探索过的格子铺黑；
 * 敌方单位只有落在本地玩家的**当前视野**里才画（地形一旦探索过就永久可见，这是原版行为）。
 */

/** 本地玩家：迷雾与敌方单位的可见性按它算 */
export const LOCAL_OWNER = 0
const SHROUD_COLOR = '#05060a'
/** 迷雾贴图按需生成一次（要 DOM canvas） */
let fogSprites: FogSprites | undefined

export interface Scene {
  readonly canvas: HTMLCanvasElement
  readonly camera: Camera
  readonly battle: Battle | undefined
  readonly mapPreview: MapPreview | undefined
  readonly artByUnit: readonly (UnitArt | undefined)[]
  readonly hoverCell: { x: number; y: number } | undefined
  /** 画质预设：`hd` 时画布用平滑放大（写实预设的一部分） */
  readonly quality: QualityPreset
  /** 帧时间戳（毫秒），雨夜预设的雨丝靠它推进 */
  readonly time: number
  /** 给了就把地块层交给 WebGL 画（换渲染后端 spike），2D 只画其余层 */
  readonly glTiles?: GlTileLayer | undefined
  /** WebGL 层的画布：雨夜后处理要作用于整幅画面时得把它搬回 2D 画布 */
  readonly glCanvas?: HTMLCanvasElement | undefined
  /** 实时阴影（重制版增强，默认关闭）：只对 WebGL 路径有效 */
  readonly shadows?: boolean
  /** 大气雾（重制版增强，默认关闭）：只对 WebGL 路径有效 */
  readonly fog?: boolean
  /** 湿地面倒影（重制版增强，默认关闭）：只对 WebGL 路径有效 */
  readonly reflections?: boolean
  /** 泛光：亮部溢出（重制版增强，默认关闭） */
  readonly bloom?: boolean
}

const VIEW = RA2_ISO_VIEW

export function drawScene(scene: Scene): void {
  const context = scene.canvas.getContext('2d')
  if (!context) return

  const scale = viewScale(scene.camera)
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, scene.canvas.width, scene.canvas.height)
  context.setTransform(scale, 0, 0, scale, -scene.camera.x * scale, -scene.camera.y * scale)
  // 原版地块是 60×30 像素一格：放大时用最近邻，像素边界才是硬的；
  // 缩到 1 倍以下时改平滑降采样，否则直接抽点会把草地的 1 像素质感整片丢掉、显得糊。
  // 高清写实预设始终平滑放大 —— 那一档要的正是没有硬像素边的观感。
  context.imageSmoothingEnabled = scene.quality === 'hd' || scale < 1

  const battle = scene.battle
  const range = visibleCellRange(scene.camera, VIEW, scene.canvas.width, scene.canvas.height)
  const isEmpty = !battle && !scene.mapPreview
  const wet = isWetNight(scene.quality)
  if (scene.glTiles && scene.mapPreview) {
    const preview = scene.mapPreview
    const glContext = {
      preview,
      camera: scene.camera,
      range,
      view: VIEW,
      tileCanvasAt: (tileIndex: number, subTile: number) => preview.tileLayer?.canvasAt(tileIndex, subTile),
      units: scene.battle ? collectUnits(scene.battle, scene.artByUnit) : [],
    }
    // 图层次序由 GL 层排定：清屏 → 地面 → 倒影 → 阴影 → 物体 → 雾
    scene.glTiles.render(glContext, {
      reflections: scene.reflections,
      shadows: scene.shadows,
      fog: scene.fog,
    })
  }
  // 2D 后处理（泛光、雨夜那套调色/雨丝/暗角）画在 2D 画布上，而 GPU 层是另一块画布：
  // 先把它搬进来，后处理才作用于整幅画面；否则那层半透明叠加会把 GPU 层整块盖住。
  // 只在真要叠后处理时搬，平时省掉这一次全屏拷贝。
  if ((wet || scene.bloom) && scene.glCanvas) {
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.drawImage(scene.glCanvas, 0, 0)
    context.setTransform(scale, 0, 0, scale, -scene.camera.x * scale, -scene.camera.y * scale)
  }
  if (isEmpty) drawCanvasHint(context, scene.canvas, '先在上面选「RA2.MIX」与地图档案，或点「内置示例战场」')
  if (!battle && scene.mapPreview) {
    drawMapPreview(context, scene.mapPreview, VIEW, range, { drawTiles: scene.glTiles === undefined })
    if (scene.hoverCell) strokeCell(context, VIEW, scene.hoverCell, HOVER_COLOR)
  }
  if (battle) {
    // 有官方地图时就画真实地块，否则退回占位网格
    if (scene.mapPreview) {
      drawMapPreview(context, scene.mapPreview, VIEW, range, { drawTiles: scene.glTiles === undefined })
    } else drawTerrain(context, battle.world.grid, VIEW, range)
    if (scene.hoverCell) strokeCell(context, VIEW, scene.hoverCell, HOVER_COLOR)
    const selected = battle.selectedIndex === undefined ? undefined : battle.world.units[battle.selectedIndex]
    if (selected) {
      strokeCell(context, VIEW, { x: fromFixed(selected.x), y: fromFixed(selected.y) }, SELECTED_COLOR)
      drawPath(context, selected.path.slice(selected.pathIndex))
    }
    // 单位交给 GPU 时 2D 这层只画迷雾/选中框；否则照旧在 2D 上画
    if (!scene.glTiles) drawUnits(context, battle, scene.artByUnit, wet)
    drawShroud(context, battle, VIEW, range)
  }
  if (wet) {
    context.setTransform(1, 0, 0, 1, 0, 0)
    applyWetNightGrade(context, scene.canvas, { time: scene.time, scale })
  } else if (scene.bloom) {
    // 亮部溢出：只提亮亮部，不整体压暗（雨夜预设自带泛光，所以两条不叠加）
    applyBloom(context, scene.canvas, BLOOM.standaloneAlpha)
  }
  context.setTransform(1, 0, 0, 1, 0, 0)
}

/** 没探索过的格子铺黑，边界按邻格是否已探索做抖动柔化。只画镜头内的格子。 */
function drawShroud(
  context: CanvasRenderingContext2D,
  battle: Battle,
  view: typeof VIEW,
  range: ReturnType<typeof visibleCellRange>,
): void {
  fogSprites ??= createFogSprites(view, SHROUD_COLOR)
  const sprites = fogSprites
  const isExploredAt = (x: number, y: number) => isExplored(battle.world.shroud, LOCAL_OWNER, x, y)
  for (let y = range.minY; y <= range.maxY; y++) {
    for (let x = range.minX; x <= range.maxX; x++) {
      if (isExploredAt(x, y)) continue
      const center = cellToScreen(view, { x, y })
      blitFogCell(
        context,
        sprites,
        { x, y },
        center.x - view.cellWidth / 2,
        center.y - view.cellHeight / 2,
        isExploredAt,
      )
    }
  }
}

/** 画布提示条：空画布时说明该做什么，免得留一片黑。 */
function drawCanvasHint(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, text: string): void {
  context.setTransform(1, 0, 0, 1, 0, 0)
  const ratio = window.devicePixelRatio || 1
  context.font = `${Math.round(13 * ratio)}px "Microsoft YaHei", sans-serif`
  context.textAlign = 'center'
  const centerX = canvas.width / 2
  const baseline = canvas.height / 2
  const halfWidth = context.measureText(text).width / 2 + 10 * ratio
  context.fillStyle = 'rgba(12, 16, 20, 0.82)'
  context.fillRect(centerX - halfWidth, baseline - 17 * ratio, halfWidth * 2, 25 * ratio)
  context.fillStyle = 'rgba(230, 237, 245, 0.92)'
  context.fillText(text, centerX, baseline)
}

/** 选中单位的剩余路径：原版也用它表示"已接受这条移动指令"。 */
function drawPath(context: CanvasRenderingContext2D, path: readonly { x: number; y: number }[]): void {
  if (path.length === 0) return
  context.save()
  context.strokeStyle = SELECTED_COLOR
  context.lineWidth = 3
  context.beginPath()
  path.forEach((cell, index) => {
    const center = cellToScreen(VIEW, cell)
    if (index === 0) context.moveTo(center.x, center.y)
    else context.lineTo(center.x, center.y)
  })
  context.stroke()
  context.restore()
}

/** 按 (x+y) 升序画，保证近处单位盖住远处的。 */
/**
 * 收集要交给 GPU 的单位：只挑活着的、且对本地玩家可见的，按 (x+y) 升序
 * （与 2D 路径同一套判据），坐标换算成世界坐标里的贴地锚点。
 */
function collectUnits(battle: Battle, artByUnit: readonly (UnitArt | undefined)[]): readonly GlUnitQuad[] {
  const order = battle.world.units
    .map((unit, index) => ({ unit, index }))
    .filter(({ unit }) => unit.health > 0)
    .filter(({ unit }) => {
      if (unit.owner === LOCAL_OWNER) return true
      const cell = unitCell(unit)
      return isVisible(battle.world.shroud, LOCAL_OWNER, cell.x, cell.y)
    })
    .sort((left, right) => left.unit.x + left.unit.y - (right.unit.x + right.unit.y))

  const quads: GlUnitQuad[] = []
  for (const { unit, index } of order) {
    const art = artByUnit[index]
    if (!art) continue
    const frame = art.frames[battle.facingByUnit[index] ?? 0]!
    const ground = cellToScreen(VIEW, { x: fromFixed(unit.x), y: fromFixed(unit.y) })
    quads.push({
      source: frame.canvas,
      anchorX: frame.anchorX,
      anchorY: frame.anchorY,
      worldX: ground.x,
      worldY: ground.y,
    })
  }
  return quads
}

function drawUnits(
  context: CanvasRenderingContext2D,
  battle: Battle,
  artByUnit: readonly (UnitArt | undefined)[],
  wet: boolean,
): void {
  const order = battle.world.units
    .map((unit, index) => ({ unit, index }))
    .sort((left, right) => left.unit.x + left.unit.y - (right.unit.x + right.unit.y))

  for (const { unit, index } of order) {
    if (unit.health <= 0) continue
    // 敌方单位只有在自己或盟友的当前视野内才可见
    if (unit.owner !== LOCAL_OWNER) {
      const cell = unitCell(unit)
      if (!isVisible(battle.world.shroud, LOCAL_OWNER, cell.x, cell.y)) continue
    }
    const ground = cellToScreen(VIEW, { x: fromFixed(unit.x), y: fromFixed(unit.y) })
    const art = artByUnit[index]
    if (!art) {
      context.fillStyle = unit.owner === 0 ? '#60a5fa' : '#f87171'
      context.fillRect(ground.x - 4, ground.y - 12, 8, 8)
      continue
    }
    const frame = art.frames[battle.facingByUnit[index] ?? 0]!
    const left = ground.x - frame.anchorX
    const top = ground.y - frame.anchorY
    if (wet) drawWetReflection(context, frame.canvas, left, top, frame.anchorY, VIEW)
    context.drawImage(frame.canvas, left, top)
  }
}

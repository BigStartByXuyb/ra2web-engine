import { RA2_ISO_VIEW, cellToScreen, compareDepthOrder, footprintDepth, snapSpriteOrigin } from '@ra2web/render'
import { fromFixed, fromFixedExact, isExplored, isVisible, unitCell, type Unit } from '@ra2web/sim'
import type { Battle } from './battle.js'
import { viewScale, visibleCellRange, type Camera } from './camera.js'
import { drawMapPreview, sortedStructures, structureDepth, structureOrigin, type MapPreview } from './map-preview.js'
import { HOVER_COLOR, SELECTED_COLOR, drawTerrain, strokeCell, strokeUnitBrackets } from './terrain.js'
import { blitFogCell, createFogSprites, type FogSprites } from './fog-layer.js'
import { BLOOM, applyBloom, applyWetNightGrade, drawWetReflection } from './post-process.js'
import type { GlTileLayer } from './webgl-tile-layer.js'
import type { GlUnitQuad } from './webgl-tile-layer.js'
import type { Unit3dModel } from './webgl-unit3d.js'
import type { Terrain3dScene } from './webgl-terrain3d.js'
import { TERRAIN_Z_STEP_PX } from './terrain3d-zstep.js'
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
  /** 单位有 3D 模型时用实时 3D 画（B 路）；没有的类型照旧走精灵 */
  readonly unit3d?: ((typeId: string) => Unit3dModel | undefined) | undefined
  /**
   * 回退精灵的直立修正角（本项目自定，`?freecam=1` 用）：自由视角是纯 CSS rotate+scaleY，
   * 回退贴图会被连地面转倒；GL 层按这个角绕贴地中点反转单位精灵抵消它。缺省 0 = 恒等。
   */
  readonly spriteYaw?: number | undefined
  /** 地貌线 terrain3d 场景（`?terrain3d=1`）：给了就由 PBR 地形画地面，地块 quads 交空 */
  readonly terrain3d?: Terrain3dScene | undefined
  /** 水面动画当前帧（`MapPreview.water` 给范围；两条绘制路径共用同一个帧号） */
  readonly waterFrame?: number | undefined
}

const VIEW = RA2_ISO_VIEW

/**
 * 选中角括号往里收多少像素。
 *
 * 单位精灵画布比车身略大（四周各留了一点空边），不往里收的话括号会浮在车身外一两个像素。
 */
const UNIT_BRACKET_INSET = 3

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
      // terrain3d 模式下地块/地面交给 PBR 地形 pass 画：这里交空图，tile 层自然一个 quad 都不产生
      tileCanvasAt: scene.terrain3d
        ? () => undefined
        : (tileIndex: number, subTile: number) => preview.tileLayer?.canvasAt(tileIndex, subTile),
      groundCanvas: scene.terrain3d ? undefined : preview.tileLayer?.groundCanvas(),
      units: scene.battle ? collectUnits(scene.battle, scene.artByUnit, scene.unit3d) : [],
      waterFrame: scene.waterFrame,
    }
    // 图层次序由 GL 层排定：清屏 → [terrain3d 地面] → 地面 → 倒影 → 阴影 → 物体 → 雾
    scene.glTiles.render(glContext, {
      reflections: scene.reflections,
      shadows: scene.shadows,
      fog: scene.fog,
      spriteYaw: scene.spriteYaw,
      terrain3d: scene.terrain3d
        ? {
            // 传当前水面帧号 + 本帧要盖痕的单位贴地坐标（任务 4 车辙/踩痕，本项目自定）
            drawGround: () =>
              scene.terrain3d!.render(
                scene.camera,
                scene.canvas.width,
                scene.canvas.height,
                scene.waterFrame ?? 0,
                glContext.units.map((unit) => ({ x: unit.worldX, y: unit.worldY })),
              ),
            zStep: TERRAIN_Z_STEP_PX,
          }
        : undefined,
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
    drawMapPreview(context, scene.mapPreview, VIEW, range, {
      drawTiles: scene.glTiles === undefined,
      waterFrame: scene.waterFrame,
    })
    if (scene.hoverCell) strokeCell(context, VIEW, scene.hoverCell, HOVER_COLOR)
  }
  if (battle) {
    // 有官方地图时就画真实地块，否则退回占位网格
    if (scene.mapPreview) {
      // 建筑不在这里画：它要和单位按同一个等距深度混排，交给下面的 drawObjects
      drawMapPreview(context, scene.mapPreview, VIEW, range, {
        drawTiles: scene.glTiles === undefined,
        drawStructures: false,
        waterFrame: scene.waterFrame,
      })
    } else drawTerrain(context, battle.world.grid, VIEW, range)
    if (scene.hoverCell) strokeCell(context, VIEW, scene.hoverCell, HOVER_COLOR)
    const selectedIndex = battle.selectedIndex
    const selected = selectedIndex === undefined ? undefined : battle.world.units[selectedIndex]
    if (selected !== undefined && selectedIndex !== undefined) {
      // 位置取精确值（与单位本体同一处），不取整 —— 取整会让框滞后单位最多一格
      const ground = cellToScreen(VIEW, { x: fromFixedExact(selected.x), y: fromFixedExact(selected.y) })
      const frame = scene.artByUnit[selectedIndex]?.frames[battle.facingByUnit[selectedIndex] ?? 0]
      if (frame) {
        strokeUnitBrackets(
          context,
          {
            left: ground.x - frame.anchorX,
            top: ground.y - frame.anchorY,
            right: ground.x - frame.anchorX + frame.canvas.width,
            bottom: ground.y - frame.anchorY + frame.canvas.height,
          },
          UNIT_BRACKET_INSET,
          SELECTED_COLOR,
        )
      } else {
        strokeCell(context, VIEW, { x: fromFixed(selected.x), y: fromFixed(selected.y) }, SELECTED_COLOR)
      }
      drawPath(context, selected.path.slice(selected.pathIndex))
    }
    // 单位交给 GPU 时 2D 这层只画迷雾/选中框；否则照旧在 2D 上画
    if (!scene.glTiles) drawObjects(context, scene.mapPreview, battle, scene.artByUnit, wet)
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

/**
 * 活着的、对本地玩家可见的单位（敌方要落在自己或盟友的当前视野里），按贴地坐标升序。
 * 2D 路径与 GPU 路径共用这一处判据，两条路才不会挑出不同的单位来。
 */
function visibleUnits(battle: Battle): readonly { readonly unit: Unit; readonly index: number }[] {
  return battle.world.units
    .map((unit, index) => ({ unit, index }))
    .filter(({ unit }) => unit.health > 0)
    .filter(({ unit }) => {
      if (unit.owner === LOCAL_OWNER) return true
      const cell = unitCell(unit)
      return isVisible(battle.world.shroud, LOCAL_OWNER, cell.x, cell.y)
    })
    .sort(
      (left, right) =>
        fromFixedExact(left.unit.x) +
        fromFixedExact(left.unit.y) -
        (fromFixedExact(right.unit.x) + fromFixedExact(right.unit.y)),
    )
}

/**
 * 收集要交给 GPU 的单位：坐标换算成世界坐标里的贴地锚点，并带上与建筑同一个等距深度键，
 * 上层就能把建筑与单位排进同一条序列。
 */
function collectUnits(
  battle: Battle,
  artByUnit: readonly (UnitArt | undefined)[],
  unit3d: ((typeId: string) => Unit3dModel | undefined) | undefined,
): readonly GlUnitQuad[] {
  const quads: GlUnitQuad[] = []
  for (const { unit, index } of visibleUnits(battle)) {
    const art = artByUnit[index]
    if (!art) continue
    const frame = art.frames[battle.facingByUnit[index] ?? 0]!
    // 贴地锚点取定点坐标的精确值：截断成整格会让单位只在跨格线那一个 tick 动一下
    const x = fromFixedExact(unit.x)
    const y = fromFixedExact(unit.y)
    const ground = cellToScreen(VIEW, { x, y })
    quads.push({
      source: frame.canvas,
      anchorX: frame.anchorX,
      anchorY: frame.anchorY,
      worldX: ground.x,
      worldY: ground.y,
      depth: footprintDepth(x, y),
      model: unit3d?.(battle.typeByUnit[index] ?? ''),
      // 朝向直接照 `facingByUnit`：它是从"两帧之间的位移"算出来的，精灵帧与 3D 模型共用同一份。
      // 曾经在这里补过 π 想对齐精灵帧，结果移动时车头全反了 —— 静帧上看"炮管朝哪边"受机位遮挡影响，
      // 不能拿它当一个帧的判据。
      facing: (battle.facingByUnit[index] ?? 0) * (Math.PI / 4),
      // 炮塔朝向：sim 的 16 位角（turretFacing − facing = 相对车体的偏转），换算成弧度
      // 叠在车体朝向上。分件模型的炮塔/炮管组用它做独立偏转（本项目自定，原版口径归战斗线）。
      turretFacing:
        (battle.facingByUnit[index] ?? 0) * (Math.PI / 4) +
        (((unit.turretFacing - unit.facing + 32768) % 65536) - 32768) * ((Math.PI * 2) / 65536),
    })
  }
  return quads
}

/** 一个要画的物体：等距深度 + 画法。建筑与单位混在同一条序列里，所以统一成这个形状。 */
interface Drawable {
  readonly depth: number
  readonly isUnit: boolean
  readonly draw: () => void
}

/**
 * 建筑与单位按**同一个等距深度**混排后逐个画。
 *
 * 原版是物体按 Y 排序、依次画，站在楼后面的单位因此被楼挡住；分成"建筑一批、单位一批"
 * 就没有这个效果 —— 单位永远盖在楼上。2D 与 WebGL 两条路都走这一条序列，逐像素比对才继续成立。
 */
function drawObjects(
  context: CanvasRenderingContext2D,
  preview: MapPreview | undefined,
  battle: Battle,
  artByUnit: readonly (UnitArt | undefined)[],
  wet: boolean,
): void {
  const drawables: Drawable[] = []
  if (preview) {
    for (const sprite of sortedStructures(preview)) {
      const { canvas } = sprite
      const origin = structureOrigin(VIEW, sprite)
      drawables.push({
        depth: structureDepth(sprite),
        isUnit: false,
        draw: () => context.drawImage(canvas, origin.x, origin.y),
      })
    }
  }
  for (const { unit, index } of visibleUnits(battle)) {
    const x = fromFixedExact(unit.x)
    const y = fromFixedExact(unit.y)
    const ground = cellToScreen(VIEW, { x, y })
    const depth = footprintDepth(x, y)
    const art = artByUnit[index]
    if (!art) {
      drawables.push({
        depth,
        isUnit: true,
        draw: () => {
          context.fillStyle = unit.owner === LOCAL_OWNER ? '#60a5fa' : '#f87171'
          context.fillRect(ground.x - 4, ground.y - 12, 8, 8)
        },
      })
      continue
    }
    const frame = art.frames[battle.facingByUnit[index] ?? 0]!
    const origin = snapSpriteOrigin(ground.x - frame.anchorX, ground.y - frame.anchorY)
    drawables.push({
      depth,
      isUnit: true,
      draw: () => {
        if (wet) drawWetReflection(context, frame.canvas, origin.x, origin.y, frame.anchorY, VIEW)
        context.drawImage(frame.canvas, origin.x, origin.y)
      },
    })
  }
  drawables.sort(compareDepthOrder)
  for (const drawable of drawables) drawable.draw()
}

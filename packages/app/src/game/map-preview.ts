import { cellToScreen, footprintDepth, snapSpriteOrigin, type IsoView, type ScreenPoint } from '@ra2web/render'
import type { MapCell, MapFile } from '@ra2web/formats'
import type { CellRange } from './camera.js'
import type { OverlayLayer } from './overlay-layer.js'
import type { StructureLayer, StructureSprite } from './structure-layer.js'
import type { TileLayer } from './tile-layer.js'
import { animatedTileIndex, type WaterTileRange } from './water-animation.js'

/**
 * 官方地图预览：在还没有 TMP 地块美术之前，用 `z`（高度）着色画出地图的**形状**。
 *
 * 地图包里每个方格正好一条记录（其余是同格的另一半菱形位置），这里按方格建索引。
 */

export interface MapPreview {
  /** 地图**声明**尺寸（`[Map] Size`），用于界面显示；格空间范围是 `width`×`height`，两者不是一回事 */
  readonly declaredWidth: number
  readonly declaredHeight: number
  /**
   * 格坐标之和的范围（含端点）。地图在格空间里是块**斜置的菱形**：`x + y` 落在这个区间里，
   * 而 `worldY = (x + y) · 15`，所以"把可玩区域收成菱形"只需夹相机中心的世界 Y。
   */
  readonly cellSumMin: number
  readonly cellSumMax: number
  readonly width: number
  readonly height: number
  readonly theater: string | undefined
  readonly zMin: number
  readonly zMax: number
  /** 键 = cellY × width + cellX */
  readonly cellByIndex: ReadonlyMap<number, MapCell>
  /** 有地块美术时画真实地形；没有则退化成 z 高度着色 */
  readonly tileLayer: TileLayer | undefined
  /** 覆盖物层（石头、枯树、桥板…）；没有时只画地块 */
  readonly overlayLayer: OverlayLayer | undefined
  /** 地图预置的建筑；没有美术的已被过滤掉 */
  readonly structures: readonly StructureSprite[]
  /** 水面地块集的范围：有它才播水面动画（见 `water-animation.ts`） */
  readonly water: WaterTileRange | undefined
}

export function buildMapPreview(
  map: MapFile,
  tileLayer: TileLayer | undefined = undefined,
  overlayLayer: OverlayLayer | undefined = undefined,
  structureLayer: StructureLayer | undefined = undefined,
  water: WaterTileRange | undefined = undefined,
): MapPreview {
  const cellByIndex = new Map<number, MapCell>()
  let zMin = Number.POSITIVE_INFINITY
  let zMax = Number.NEGATIVE_INFINITY
  let sumMin = Number.POSITIVE_INFINITY
  let sumMax = Number.NEGATIVE_INFINITY
  for (const cell of map.cells) {
    if (cell.cellX < 0 || cell.cellY < 0 || cell.cellX >= map.cellBounds.right || cell.cellY >= map.cellBounds.bottom)
      continue
    cellByIndex.set(cell.cellY * map.cellBounds.right + cell.cellX, cell)
    if (cell.z < zMin) zMin = cell.z
    if (cell.z > zMax) zMax = cell.z
    sumMin = Math.min(sumMin, cell.cellX + cell.cellY)
    sumMax = Math.max(sumMax, cell.cellX + cell.cellY)
  }
  return {
    declaredWidth: map.width,
    declaredHeight: map.height,
    cellSumMin: Number.isFinite(sumMin) ? sumMin : 0,
    cellSumMax: Number.isFinite(sumMax) ? sumMax : 0,
    width: map.cellBounds.right,
    height: map.cellBounds.bottom,
    theater: map.theater,
    zMin: Number.isFinite(zMin) ? zMin : 0,
    zMax: Number.isFinite(zMax) ? zMax : 0,
    cellByIndex,
    tileLayer,
    overlayLayer,
    structures: structureLayer
      ? map.placements
          .filter((placement) => {
            if (placement.kind !== 'structure') return false
            // 只画"格存在"的对象：原版判定能不能放东西看的是**这一格在不在**（地形流里有记录即可），
            // 不看有没有地块 —— 地图自带的装饰（油井、路灯、雕像）本来就有一批放在未上色的格上
            // （实测 11 张图的 76 个这种对象全部落在有记录、`TILE_NONE` 的格上，没有一个落在无记录的格上）。
            return cellByIndex.get(placement.cellY * map.cellBounds.right + placement.cellX) !== undefined
          })
          .map((placement) => structureLayer.spriteAt(placement))
          .filter((sprite): sprite is StructureSprite => sprite !== undefined)
      : [],
    water,
  }
}

export function drawMapPreview(
  context: CanvasRenderingContext2D,
  preview: MapPreview,
  view: IsoView,
  range: CellRange,
  options: {
    readonly drawTiles?: boolean
    readonly drawStructures?: boolean
    readonly waterFrame?: number | undefined
  } = {},
): void {
  // 静态地图层（地块 + 覆盖物 + 建筑）交给 WebGL 时整层都不画，避免两层叠着对不齐
  if (options.drawTiles === false) return
  // 地面块先整层垫一遍，再画地块与覆盖物 —— **与 WebGL 路径的批次顺序一致**（那边是"所有地面 → 所有地块"）。
  // 逐格"地面 → 地块"会让后一格的垫底盖住前一格伸出来的美术边，两条路径因此在接缝上错开一像素。
  // 地面块补的是坡道一类"只画了半个菱形"的地块美术；倍率只由宽度定（标准格宽 → 一格宽），
  // 高度照同一倍率：原版 60×30 是 1:1、高清包 2× 是 0.5，比一格更高的崖壁因此不会被压扁。
  const ground = preview.tileLayer?.groundCanvas()
  const groundScale = ground === undefined ? 1 : view.cellWidth / ground.width
  context.lineWidth = 1
  const hasCell = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < preview.width && y < preview.height && preview.cellByIndex.has(y * preview.width + x)
  if (ground) {
    for (let y = range.minY; y <= range.maxY; y++) {
      for (let x = range.minX; x <= range.maxX; x++) {
        if (!hasCell(x, y)) continue
        const center = cellToScreen(view, { x, y })
        context.drawImage(
          ground,
          center.x - view.cellWidth / 2,
          center.y - view.cellHeight / 2,
          ground.width * groundScale,
          ground.height * groundScale,
        )
      }
    }
  }
  for (let y = range.minY; y <= range.maxY; y++) {
    for (let x = range.minX; x <= range.maxX; x++) {
      if (!hasCell(x, y)) continue
      const cell = preview.cellByIndex.get(y * preview.width + x)!
      const center = cellToScreen(view, { x, y })
      const painted = preview.tileLayer?.canvasAt(
        animatedTileIndex(cell.tileIndex, preview.water, options.waterFrame ?? 0),
        cell.subTile,
      )
      if (painted) {
        const scale = view.cellWidth / painted.width
        context.drawImage(
          painted,
          center.x - view.cellWidth / 2,
          center.y - view.cellHeight / 2,
          painted.width * scale,
          painted.height * scale,
        )
      } else if (preview.tileLayer === undefined) {
        // 只有"完全没装剧场档案"才退化成高度着色；单格没有地块（`0xFFFF`）就只留地面垫底，
        // 与 WebGL 路径同一判据，否则两条路径会在这些格上不一致。
        traceDiamond(context, center, view)
        context.fillStyle = colorForHeight(preview, cell.z)
        context.fill()
        context.strokeStyle = 'rgba(0, 0, 0, 0.22)'
        context.stroke()
      }
      // 覆盖物跟在它所属那一格的地块之后画：近处的格子会盖住它伸出去的边
      const overlay = preview.overlayLayer?.canvasAt(cell.overlay)
      if (overlay) {
        const origin = snapSpriteOrigin(center.x - overlay.width / 2, center.y - overlay.height / 2)
        context.drawImage(overlay, origin.x, origin.y)
      }
    }
  }
  // 建筑与单位要按同一个等距深度混排（见 `structureDepth`），所以调用方要混排时把这一遍关掉，
  // 由它自己按序画 —— 关掉时这一层仍旧只画地块与覆盖物。
  if (options.drawStructures === false) return
  for (const sprite of sortedStructures(preview)) {
    const origin = structureOrigin(view, sprite)
    context.drawImage(sprite.canvas, origin.x, origin.y)
  }
}

/**
 * 建筑在等距绘制顺序里的位置：按**地基最前行**排，再加 art.ini 的 `YSortAdjust`。
 *
 * 建筑与单位混在同一条序列里，所以这个键与落位只有这一处算，2D 与 WebGL 两条路都取它。
 */
export function structureDepth(sprite: StructureSprite): number {
  const { placement, foundationWidth, foundationHeight, ySortAdjust } = sprite
  return footprintDepth(placement.cellX, placement.cellY, foundationWidth, foundationHeight, ySortAdjust)
}

/** 地图预置建筑按等距深度升序：远的先画，近的盖住远的。 */
export function sortedStructures(preview: MapPreview): readonly StructureSprite[] {
  return [...preview.structures].sort((left, right) => structureDepth(left) - structureDepth(right))
}

/** 建筑贴图左上角的整数像素落位：按**地基中心**对齐格中心。 */
export function structureOrigin(view: IsoView, sprite: StructureSprite): ScreenPoint {
  const { placement, canvas, foundationWidth, foundationHeight } = sprite
  const anchor = cellToScreen(view, {
    x: placement.cellX + (foundationWidth - 1) / 2,
    y: placement.cellY + (foundationHeight - 1) / 2,
  })
  return snapSpriteOrigin(anchor.x - canvas.width / 2, anchor.y - canvas.height / 2)
}

export function previewCellAt(preview: MapPreview, cell: { x: number; y: number }): MapCell | undefined {
  return preview.cellByIndex.get(cell.y * preview.width + cell.x)
}

function colorForHeight(preview: MapPreview, z: number): string {
  const span = Math.max(1, preview.zMax - preview.zMin)
  const light = Math.round(28 + ((z - preview.zMin) / span) * 44)
  return `rgb(${light + 12}, ${light + 20}, ${light + 8})`
}

function traceDiamond(context: CanvasRenderingContext2D, center: { x: number; y: number }, view: IsoView): void {
  const halfWidth = view.cellWidth / 2
  const halfHeight = view.cellHeight / 2
  context.beginPath()
  context.moveTo(center.x, center.y - halfHeight)
  context.lineTo(center.x + halfWidth, center.y)
  context.lineTo(center.x, center.y + halfHeight)
  context.lineTo(center.x - halfWidth, center.y)
  context.closePath()
}

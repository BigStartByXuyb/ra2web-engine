import { cellToScreen, type IsoView } from '@ra2web/render'
import type { MapCell, MapFile } from '@ra2web/formats'
import type { CellRange } from './camera.js'
import type { OverlayLayer } from './overlay-layer.js'
import type { StructureLayer, StructureSprite } from './structure-layer.js'
import type { TileLayer } from './tile-layer.js'

/**
 * 官方地图预览：在还没有 TMP 地块美术之前，用 `z`（高度）着色画出地图的**形状**。
 *
 * 地图包里每个方格正好一条记录（其余是同格的另一半菱形位置），这里按方格建索引。
 */

export interface MapPreview {
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
}

export function buildMapPreview(
  map: MapFile,
  tileLayer: TileLayer | undefined = undefined,
  overlayLayer: OverlayLayer | undefined = undefined,
  structureLayer: StructureLayer | undefined = undefined,
): MapPreview {
  const cellByIndex = new Map<number, MapCell>()
  let zMin = Number.POSITIVE_INFINITY
  let zMax = Number.NEGATIVE_INFINITY
  for (const cell of map.cells) {
    if (cell.cellX < 0 || cell.cellY < 0 || cell.cellX >= map.width || cell.cellY >= map.height) continue
    cellByIndex.set(cell.cellY * map.width + cell.cellX, cell)
    if (cell.z < zMin) zMin = cell.z
    if (cell.z > zMax) zMax = cell.z
  }
  return {
    width: map.width,
    height: map.height,
    theater: map.theater,
    zMin: Number.isFinite(zMin) ? zMin : 0,
    zMax: Number.isFinite(zMax) ? zMax : 0,
    cellByIndex,
    tileLayer,
    overlayLayer,
    structures: structureLayer
      ? map.placements
          .filter(
            (placement) =>
              placement.kind === 'structure' &&
              placement.cellX >= 0 &&
              placement.cellY >= 0 &&
              placement.cellX < map.width &&
              placement.cellY < map.height,
          )
          .map((placement) => structureLayer.spriteAt(placement))
          .filter((sprite): sprite is StructureSprite => sprite !== undefined)
      : [],
  }
}

export function drawMapPreview(
  context: CanvasRenderingContext2D,
  preview: MapPreview,
  view: IsoView,
  range: CellRange,
  options: { readonly drawTiles?: boolean } = {},
): void {
  // 静态地图层（地块 + 覆盖物 + 建筑）交给 WebGL 时整层都不画，避免两层叠着对不齐
  if (options.drawTiles === false) return
  // 地面块先垫一层：坡道一类的地块美术只画了半个菱形，下面是地面（与 WebGL 路径同一判据）
  const ground = preview.tileLayer?.groundCanvas()
  context.lineWidth = 1
  for (let y = range.minY; y <= range.maxY; y++) {
    for (let x = range.minX; x <= range.maxX; x++) {
      if (x < 0 || y < 0 || x >= preview.width || y >= preview.height) continue
      const cell = preview.cellByIndex.get(y * preview.width + x)
      if (!cell) continue
      const center = cellToScreen(view, { x, y })
      // 世界尺寸一律按格子走：地块画布可能来自高清素材包，分辨率与原版一格不同
      if (ground) {
        context.drawImage(
          ground,
          center.x - view.cellWidth / 2,
          center.y - view.cellHeight / 2,
          view.cellWidth,
          view.cellHeight,
        )
      }
      const painted = preview.tileLayer?.canvasAt(cell.tileIndex, cell.subTile)
      if (painted) {
        context.drawImage(
          painted,
          center.x - view.cellWidth / 2,
          center.y - view.cellHeight / 2,
          view.cellWidth,
          view.cellHeight,
        )
      } else {
        traceDiamond(context, center, view)
        context.fillStyle = colorForHeight(preview, cell.z)
        context.fill()
        context.strokeStyle = 'rgba(0, 0, 0, 0.22)'
        context.stroke()
      }
      // 覆盖物跟在它所属那一格的地块之后画：近处的格子会盖住它伸出去的边
      const overlay = preview.overlayLayer?.canvasAt(cell.overlay)
      if (overlay) context.drawImage(overlay, center.x - overlay.width / 2, center.y - overlay.height / 2)
    }
  }
  // 建筑单独一遍，按 (x+y) 升序：近处的房子盖住远处的
  for (const sprite of [...preview.structures].sort(
    (left, right) => left.placement.cellX + left.placement.cellY - (right.placement.cellX + right.placement.cellY),
  )) {
    const { placement, canvas, foundationWidth, foundationHeight } = sprite
    const anchor = cellToScreen(view, {
      x: placement.cellX + (foundationWidth - 1) / 2,
      y: placement.cellY + (foundationHeight - 1) / 2,
    })
    context.drawImage(canvas, anchor.x - canvas.width / 2, anchor.y - canvas.height / 2)
  }
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

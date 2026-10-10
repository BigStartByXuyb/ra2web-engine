import { cellToScreen, type IsoView } from '@ra2web/render'
import type { MapCell, MapFile } from '@ra2web/formats'
import type { CellRange } from './camera.js'

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
}

export function buildMapPreview(map: MapFile): MapPreview {
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
  }
}

export function drawMapPreview(
  context: CanvasRenderingContext2D,
  preview: MapPreview,
  view: IsoView,
  range: CellRange,
): void {
  context.lineWidth = 1
  for (let y = range.minY; y <= range.maxY; y++) {
    for (let x = range.minX; x <= range.maxX; x++) {
      if (x < 0 || y < 0 || x >= preview.width || y >= preview.height) continue
      const cell = preview.cellByIndex.get(y * preview.width + x)
      if (!cell) continue
      traceDiamond(context, cellToScreen(view, { x, y }), view)
      context.fillStyle = colorForHeight(preview, cell.z)
      context.fill()
      context.strokeStyle = 'rgba(0, 0, 0, 0.22)'
      context.stroke()
    }
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

import { cellToScreen, type IsoView } from '@ra2web/render'
import { isBlocked, type Grid } from '@ra2web/sim'
import type { CellRange } from './camera.js'

/**
 * 占位地形：等距菱形铺格，只区分可走/不可走。
 *
 * 有原版地图时画的是真实 TMP 地块（见 `map-preview.ts` + `tile-layer.ts`）；
 * 这份合成场地只在没有地图时使用，让单位、相机与指令有个可用的场地。
 */

const FREE_FILL = '#39412f'
const BLOCKED_FILL = '#4d4033'
const GRID_LINE = 'rgba(0, 0, 0, 0.18)'
const HOVER_STROKE = 'rgba(230, 237, 245, 0.55)'
const SELECT_STROKE = '#f5c542'

export function drawTerrain(context: CanvasRenderingContext2D, grid: Grid, view: IsoView, range: CellRange): void {
  context.lineWidth = 1
  for (let y = range.minY; y <= range.maxY; y++) {
    for (let x = range.minX; x <= range.maxX; x++) {
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue
      traceDiamond(context, cellToScreen(view, { x, y }), view)
      context.fillStyle = isBlocked(grid, x, y) ? BLOCKED_FILL : FREE_FILL
      context.fill()
      context.strokeStyle = GRID_LINE
      context.stroke()
    }
  }
}

/** 高亮一个格子：悬停用白描边，选中用金描边。 */
export function strokeCell(
  context: CanvasRenderingContext2D,
  view: IsoView,
  cell: { x: number; y: number },
  color: string,
): void {
  context.save()
  context.lineWidth = 2
  context.strokeStyle = color
  traceDiamond(context, cellToScreen(view, cell), view)
  context.stroke()
  context.restore()
}

export const HOVER_COLOR = HOVER_STROKE
export const SELECTED_COLOR = SELECT_STROKE

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

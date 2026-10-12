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

/**
 * 选中指示：围着单位画**四个角括号**，不是整格菱形。
 *
 * 两条理由：
 *
 * - 单位比格子大（一格 60×30 像素，犀牛 75×47、基地车 93×64），画整格菱形会让单位看着"跑出框外"；
 * - 框原先画在 `fromFixed` 取整后的格上，而单位画在 `fromFixedExact` 的精确位置 —— 单位走到半格时
 *   框还留在格心，看着就是"单位偏离自己的格子"。围着单位画就没有这个滞后。
 *
 * `rect` 给的是单位在屏幕上的包围盒；`inset` 往里收一点，括号才贴着车身而不是外框。
 */
export function strokeUnitBrackets(
  context: CanvasRenderingContext2D,
  rect: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number },
  inset: number,
  color: string,
): void {
  const left = rect.left + inset
  const top = rect.top + inset
  const right = rect.right - inset
  const bottom = rect.bottom - inset
  // 括号臂长取短边的三分之一：原版的角括号不长于单位本身的一半
  const arm = Math.max(3, Math.min(right - left, bottom - top) / 3)
  context.save()
  context.lineWidth = 2
  context.strokeStyle = color
  context.beginPath()
  for (const [x, y, dx, dy] of [
    [left, top, 1, 1],
    [right, top, -1, 1],
    [right, bottom, -1, -1],
    [left, bottom, 1, -1],
  ] as const) {
    context.moveTo(x + dx * arm, y)
    context.lineTo(x, y)
    context.lineTo(x, y + dy * arm)
  }
  context.stroke()
  context.restore()
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

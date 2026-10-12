/**
 * 等距投影：格坐标 ↔ 屏幕像素。
 *
 * 地图地块与单位精灵共用这一份投影，否则地块与单位会各算一套、画出来对不上。
 *
 * 未核对：cellWidth / cellHeight 是原版渲染管线的像素常数，这里先按经典 2:1 等距比例取值，
 * 需要从 GAME.EXE 的绘制函数或原版截图逐格测量后回填（见 README「未核对项」）。
 */

export interface IsoView {
  readonly cellWidth: number
  readonly cellHeight: number
}

export const RA2_ISO_VIEW: IsoView = { cellWidth: 60, cellHeight: 30 }

export interface CellPoint {
  readonly x: number
  readonly y: number
}

export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

/** 格中心 → 屏幕像素。 */
export function cellToScreen(view: IsoView, cell: CellPoint): ScreenPoint {
  return {
    x: ((cell.x - cell.y) * view.cellWidth) / 2,
    y: ((cell.x + cell.y) * view.cellHeight) / 2,
  }
}

/**
 * 精灵落位取整：`left`/`top` 是贴图左上角的浮点屏幕像素，返回它落到的那个整数像素。
 *
 * 原版精灵本来就画在整数像素上。不取整时 2D 路径按次像素做双线性插值、WebGL 走 NEAREST
 * 采样，两条路径会在精灵边缘错开一像素（覆盖物宽高为奇数时最明显）。地块之外的精灵落位
 * ——覆盖物、建筑、单位——都走这一处，任何一条绘制路径都不再自己取整。
 */
export function snapSpriteOrigin(left: number, top: number): ScreenPoint {
  return { x: Math.round(left), y: Math.round(top) }
}

/** 屏幕像素 → 最近的格（拾取用）。 */
export function screenToCell(view: IsoView, point: ScreenPoint): CellPoint {
  const diagonal = (point.x * 2) / view.cellWidth
  const sum = (point.y * 2) / view.cellHeight
  return { x: Math.round((sum + diagonal) / 2), y: Math.round((sum - diagonal) / 2) }
}

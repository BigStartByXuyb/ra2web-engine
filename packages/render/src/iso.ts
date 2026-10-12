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
 * 等距绘制深度：`(格 x + 格 y) + 修正`，越小越远、越先画，近处的后画盖住远处的。
 *
 * 地块与覆盖物用它们所在的那一格；**物体用自己占地的"最前行"** —— 建筑压着一片地基，
 * 取 `cellX + 宽 − 1 + cellY + 高 − 1`，站在楼后面的单位深度比它小、先画，于是被楼挡住；
 * 站在楼前面的深度比它大、后画，于是盖住楼。按地基的起始角排就没有这个效果：
 * 整栋楼会排到所有单位前面去。
 *
 * 建筑与单位因此可以在同一条序列里排，不需要分成两批各画一遍。
 */
export function footprintDepth(cellX: number, cellY: number, width = 1, height = 1, adjust = 0): number {
  return cellX + width - 1 + (cellY + height - 1) + adjust
}

/** 等距绘制序列里的一个物体：深度 + 它是单位还是建筑。 */
export interface DepthOrdered {
  readonly depth: number
  /** true = 单位。深度相同时单位排在建筑之后 */
  readonly isUnit: boolean
}

/**
 * 建筑与单位混排的比较器：远的先画，近的后画。
 *
 * 深度相同时**单位在后** —— 站在楼正面那一行上的单位该盖住楼的裙边，而不是被楼的贴图吃掉。
 */
export function compareDepthOrder(left: DepthOrdered, right: DepthOrdered): number {
  return left.depth - right.depth || Number(left.isUnit) - Number(right.isUnit)
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

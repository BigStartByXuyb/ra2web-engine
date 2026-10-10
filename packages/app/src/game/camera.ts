import { screenToCell, type IsoView } from '@ra2web/render'

/**
 * 摄像机：视口左上角在投影坐标里的位置 + 缩放。
 *
 * 画布用 `setTransform` 承载缩放与平移，绘制代码因此始终用投影坐标（1 格 = 60×30 像素）。
 */

export interface Camera {
  x: number
  y: number
  zoom: number
  /** 画布后备像素与 CSS 像素之比：指针坐标进入投影前必须乘它 */
  pixelRatio: number
}

export const MIN_ZOOM = 0.15
export const MAX_ZOOM = 3

export interface CellRange {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 1, pixelRatio: 1 }
}

/** 画布像素 → 投影坐标的缩放系数（绘制变换与反投影必须用同一个）。 */
export function viewScale(camera: Camera): number {
  return camera.zoom * camera.pixelRatio
}

export function canvasToWorld(camera: Camera, canvasX: number, canvasY: number): { x: number; y: number } {
  const scale = viewScale(camera)
  return { x: canvasX / scale + camera.x, y: canvasY / scale + camera.y }
}

export function canvasToCell(
  camera: Camera,
  view: IsoView,
  canvasX: number,
  canvasY: number,
): { x: number; y: number } {
  const world = canvasToWorld(camera, canvasX, canvasY)
  return screenToCell(view, world)
}

/** 以光标为锚点缩放：缩放前后光标下的位置不变。 */
export function zoomAt(camera: Camera, canvasX: number, canvasY: number, factor: number): void {
  const before = canvasToWorld(camera, canvasX, canvasY)
  camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor))
  const after = canvasToWorld(camera, canvasX, canvasY)
  camera.x += before.x - after.x
  camera.y += before.y - after.y
}

/** 画布四角反投影出的格子范围，用于只画可见地块。 */
export function visibleCellRange(camera: Camera, view: IsoView, canvasWidth: number, canvasHeight: number): CellRange {
  const corners = [
    canvasToCell(camera, view, 0, 0),
    canvasToCell(camera, view, canvasWidth, 0),
    canvasToCell(camera, view, 0, canvasHeight),
    canvasToCell(camera, view, canvasWidth, canvasHeight),
  ]
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  return {
    minX: Math.floor(Math.min(...xs)) - 1,
    maxX: Math.ceil(Math.max(...xs)) + 1,
    minY: Math.floor(Math.min(...ys)) - 1,
    maxY: Math.ceil(Math.max(...ys)) + 1,
  }
}

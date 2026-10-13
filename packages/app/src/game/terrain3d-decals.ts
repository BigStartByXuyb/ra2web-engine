/**
 * 地貌细节贴花缓冲（任务 4，本项目自定）：车辙/雪地踩痕的"盖章"层。
 *
 * 纯逻辑（不碰 DOM）：世界坐标 → 缓冲像素坐标换算、盖章半径/强度、脏位管理。
 * 实际像素写入由调用方注入的 `stampPixels` 完成（生产=画到 canvas 再上传纹理，测试=记录调用）。
 * 痕迹单调累积由绘制实现保证（source-over 叠加），本模块只保证"盖在哪、盖多大"。
 */

export interface DecalBufferOptions {
  /** 覆盖范围的世界坐标（像素）左上角 */
  readonly minX: number
  readonly minY: number
  /** 覆盖范围的世界尺寸（像素） */
  readonly width: number
  readonly height: number
  /** 每格（60×30 世界像素）折几个缓冲像素 */
  readonly pixelsPerCell: number
}

export interface DecalBuffer {
  /** 有未上传的盖章 */
  readonly dirty: boolean
  /** 在世界坐标盖一枚软痕；越界返回 false（不回调、不置脏） */
  stampWorld(worldX: number, worldY: number): boolean
  /** 读取并清脏位（渲染器每帧问它决定是否上传纹理） */
  takeDirty(): boolean
}

/** 痕迹半径（格）：1.6 格 —— 比一辆坦克略宽，自定观感参数。 */
const TRACK_RADIUS_CELLS = 1.6
/** 单枚痕迹强度（0..1，自定）：多次经过自然加深。 */
const TRACK_STRENGTH = 0.35
/** 世界像素 → 格：RA2 一格宽 60 世界像素（`RA2_ISO_VIEW.cellWidth`）。 */
const WORLD_PIXELS_PER_CELL = 60

export function createDecalBuffer(
  options: DecalBufferOptions,
  stampPixels: (px: number, py: number, radius: number, strength: number) => void,
): DecalBuffer {
  const bufferWidth = Math.round((options.width / WORLD_PIXELS_PER_CELL) * options.pixelsPerCell)
  const bufferHeight = Math.round((options.height / WORLD_PIXELS_PER_CELL) * options.pixelsPerCell)
  const radius = TRACK_RADIUS_CELLS * options.pixelsPerCell
  let dirty = false
  return {
    get dirty(): boolean {
      return dirty
    },
    stampWorld(worldX, worldY) {
      const px = ((worldX - options.minX) / options.width) * bufferWidth
      const py = ((worldY - options.minY) / options.height) * bufferHeight
      if (px < 0 || py < 0 || px > bufferWidth || py > bufferHeight) return false
      stampPixels(px, py, radius, TRACK_STRENGTH)
      dirty = true
      return true
    },
    takeDirty() {
      const wasDirty = dirty
      dirty = false
      return wasDirty
    },
  }
}

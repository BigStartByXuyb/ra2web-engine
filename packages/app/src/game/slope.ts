import { TERRAIN_Z_STEP_PX } from './terrain3d-zstep.js'

/**
 * 坡度俯仰（**本项目自定增强**）：3D 单位模型在坡面上倾斜贴合地形。
 * 原版精灵不倾斜（贴图没有坡面姿态），所以这是重制画面的增强而非原版口径。
 *
 * 几何（与等距投影同一套，见 `webgl-unit3d` 顶点着色器）：
 *
 * - 屏幕 = `(x − y, (x + y) / 2 − z)`，体素 z 直接减在屏幕 y 上（1 体素 = 1 像素）；
 * - 1 格 = 60px 宽 = **30 体素-x**（体素 x 映射到屏幕 (+1, +0.5)，横跨 30 体素够 1 格）；
 * - 1 级高度 = `TERRAIN_Z_STEP_PX`（10.546875，与地形抬升同一常量）。
 *
 * 沿格 x 每级坡的倾角 = `atan(10.546875 / 30)` ≈ 19.38°。坡度取**中心差分**，
 * 边界退化为单侧差分；越界/退化网格返回 0。倾角夹在 ±45°（高度数据异常时的防御）。
 */

/** 一格的横向尺寸（体素-x）：等距投影下 1 格 = 60px 宽 = 30 体素 */
export const SLOPE_CELL_VOXELS = 30

/** 防御性上限：±45°（正常地形每格级差 ≤2，真实上限 ≈35°） */
const MAX_TILT = Math.PI / 4

export interface SlopeTilt {
  /** 绕体素 y 轴的俯仰（沿格 x 方向的坡；正 = 格 x+ 侧抬升） */
  readonly pitch: number
  /** 绕体素 x 轴的侧倾（沿格 y 方向的坡；正 = 格 y+ 侧抬升） */
  readonly roll: number
}

const ZERO: SlopeTilt = { pitch: 0, roll: 0 }

function levelAt(heights: Int8Array, width: number, height: number, x: number, y: number): number | undefined {
  if (x < 0 || y < 0 || x >= width || y >= height) return undefined
  return heights[y * width + x] ?? undefined
}

export function slopeTiltOf(
  heights: Int8Array,
  width: number,
  height: number,
  cellX: number,
  cellY: number,
): SlopeTilt {
  const center = levelAt(heights, width, height, cellX, cellY)
  if (center === undefined) return ZERO
  const left = levelAt(heights, width, height, cellX - 1, cellY)
  const right = levelAt(heights, width, height, cellX + 1, cellY)
  const up = levelAt(heights, width, height, cellX, cellY - 1)
  const down = levelAt(heights, width, height, cellX, cellY + 1)
  // 中心差分；缺一侧用单侧差分；两侧都缺（1 格宽/高）→ 0
  const dx =
    left !== undefined && right !== undefined
      ? (right - left) / 2
      : right !== undefined
        ? right - center
        : left !== undefined
          ? center - left
          : 0
  const dy =
    up !== undefined && down !== undefined
      ? (down - up) / 2
      : down !== undefined
        ? down - center
        : up !== undefined
          ? center - up
          : 0
  const perLevel = TERRAIN_Z_STEP_PX / SLOPE_CELL_VOXELS
  const clamp = (angle: number): number => Math.max(-MAX_TILT, Math.min(MAX_TILT, angle))
  return { pitch: clamp(Math.atan(dx * perLevel)), roll: clamp(Math.atan(dy * perLevel)) }
}

import type { Rgb } from '@ra2web/formats'

/**
 * 体素着色：法线索引 → 方向向量 → 定向光漫反射。
 *
 * 未核对：原版按 VXL 的 normalsMode 选择法线表（6 面 / 更细的球面表），
 * 这里先用 36 个球面均匀方向的近似表；着色系数同样是预览校准值，不是原版常数。
 */

export interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export const DEFAULT_LIGHT: Vec3 = { x: -0.35, y: 0.55, z: 0.75 }

export const SHADE_BASE = 0.55
export const SHADE_RANGE = 0.75
export const SHADE_MINIMUM_DIFFUSE = 0.35

export const APPROXIMATE_NORMALS: readonly Vec3[] = buildApproximateNormals(36)

/** 球面均匀取向：黄金角螺旋，保证同一索引永远得到同一方向。 */
function buildApproximateNormals(count: number): readonly Vec3[] {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  const normals: Vec3[] = []
  for (let index = 0; index < count; index++) {
    const y = count > 1 ? 1 - (index / (count - 1)) * 2 : 0
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    normals.push({ x: Math.cos(goldenAngle * index) * radius, y, z: Math.sin(goldenAngle * index) * radius })
  }
  return normals
}

/** 按法线做定向光漫反射，返回着色后的颜色。 */
export function shadeColor(base: Rgb, normalIndex: number, light: Vec3 = DEFAULT_LIGHT): Rgb {
  const normal = APPROXIMATE_NORMALS[normalIndex % APPROXIMATE_NORMALS.length]!
  const diffuse = Math.max(SHADE_MINIMUM_DIFFUSE, normal.x * light.x + normal.y * light.y + normal.z * light.z)
  const scale = SHADE_BASE + SHADE_RANGE * diffuse
  return {
    r: Math.min(255, Math.round(base.r * scale)),
    g: Math.min(255, Math.round(base.g * scale)),
    b: Math.min(255, Math.round(base.b * scale)),
  }
}

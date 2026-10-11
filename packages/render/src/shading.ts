import type { Rgb } from '@ra2web/formats'

/**
 * 体素着色：法线索引 → 方向向量 → 定向光漫反射。
 *
 * 未核对：原版按 VXL 的 normalsMode 选择法线表（6 面 / 更细的球面表），
 * 这里先用 36 个球面均匀方向的近似表；着色系数同样是预览校准值，不是原版常数。
 *
 * 提供两套模型：
 *
 * - `PIXEL_STYLE`：原版像素风用的纯漫反射（默认）；
 * - `METALLIC_STYLE`：写实预设用的漫反射 + Blinn-Phong 高光 + 冷色环境反射 ——
 *   高光方向与视角固定（等距视角的视线方向就是 (1,1,1)，因为三个可见面正是 +x/+y/+z）。
 *   **这是引擎侧的着色模型，与素材无关**：换成高清/写实材质后同一套参数作用在新贴图上，
 *   不需要改渲染管线。
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

export interface ShadingStyle {
  readonly id: string
  /** 漫反射下限，避免背光面全黑 */
  readonly minimumDiffuse: number
  readonly base: number
  readonly range: number
  /** 高光强度（0 = 无高光） */
  readonly specular: number
  /** 高光锐度：越大越像抛光金属 */
  readonly shininess: number
  /** 金属度：0 = 纯漫反射，1 = 高光带基调色、整体压暗 */
  readonly metallic: number
}

/** 原版像素风（当前默认）：只有漫反射。 */
export const PIXEL_STYLE: ShadingStyle = {
  id: 'pixel',
  minimumDiffuse: SHADE_MINIMUM_DIFFUSE,
  base: SHADE_BASE,
  range: SHADE_RANGE,
  specular: 0,
  shininess: 8,
  metallic: 0,
}

/** 写实预设（测试用）：压暗基调色 + 冷色高光 + 环境反射，做出金属光泽。 */
export const METALLIC_STYLE: ShadingStyle = {
  id: 'metallic',
  minimumDiffuse: 0.24,
  base: 0.46,
  range: 0.62,
  specular: 1.25,
  shininess: 16,
  metallic: 0.55,
}

/**
 * 等距视角的视线方向（从物体指向观察者）。
 * 投影是 `screenX = x − y`、`screenY = (x + y)/2 − z`，满足这两个式子不变的只有 (1,1,1) 方向，
 * 也就是可见面正好是 +x、+y、+z 三面。
 */
export const VIEW_DIRECTION: Vec3 = (() => {
  const length = Math.sqrt(3)
  return { x: 1 / length, y: 1 / length, z: 1 / length }
})()

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

/** 按法线着色，返回着色后的颜色。默认是原版像素风的纯漫反射。 */
export function shadeColor(
  base: Rgb,
  normalIndex: number,
  light: Vec3 = DEFAULT_LIGHT,
  style: ShadingStyle = PIXEL_STYLE,
): Rgb {
  const normal = APPROXIMATE_NORMALS[normalIndex % APPROXIMATE_NORMALS.length]!
  const lambert = Math.max(0, normal.x * light.x + normal.y * light.y + normal.z * light.z)
  const diffuse = Math.max(style.minimumDiffuse, lambert)

  // 金属：基调色压暗，高光带基调色；非金属：高光取白色
  const dim = 1 - style.metallic * 0.35
  const scale = (style.base + style.range * diffuse) * dim
  let red = base.r * scale
  let green = base.g * scale
  let blue = base.b * scale

  if (style.specular > 0) {
    // Blinn-Phong：L 是光线方向，V 是视线方向，取半程向量
    const halfX = light.x + VIEW_DIRECTION.x
    const halfY = light.y + VIEW_DIRECTION.y
    const halfZ = light.z + VIEW_DIRECTION.z
    const length = Math.hypot(halfX, halfY, halfZ) || 1
    const dot = Math.max(0, (normal.x * halfX + normal.y * halfY + normal.z * halfZ) / length)
    const highlight = Math.pow(dot, style.shininess) * style.specular
    const tint = 1 - style.metallic * 0.45
    red += 255 * highlight * (0.35 + tint)
    green += 255 * highlight * (0.4 + tint)
    blue += 255 * highlight * (0.5 + tint)
    // 天光反射：朝上的面吃一点冷色环境光，金属感主要来自这一项与高光的对比
    const sky = Math.max(0, normal.z) * style.metallic * 0.45
    red += 255 * sky * 0.35
    green += 255 * sky * 0.45
    blue += 255 * sky * 0.62
  }

  return {
    r: Math.min(255, Math.round(red)),
    g: Math.min(255, Math.round(green)),
    b: Math.min(255, Math.round(blue)),
  }
}

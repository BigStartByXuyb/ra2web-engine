/**
 * 定点数：1 格 = 2^SHIFT 个单位。
 *
 * 位置、速度、路径推进全部用整数运算，避免浮点在跨平台/跨引擎下的舍入差异 ——
 * 这是"逐 tick 状态一致"的前提。
 */

export const FIXED_SHIFT = 8

/** 1 格的定点表示 */
export const ONE = 1 << FIXED_SHIFT

/** 只用于把脚本里的整数格坐标转成定点，不用于浮点运算。 */
export function toFixed(value: number): number {
  return Math.trunc(value) * ONE
}

export function fromFixed(value: number): number {
  return Math.trunc(value / ONE)
}

/**
 * 定点坐标 → 格坐标的精确值（保留小数）。
 *
 * 只给绘制用：模拟层的坐标一律是定点整数，绘制时再折成格坐标。判断"在哪一格"用
 * `fromFixed`（截断），取贴图落位用这一个 —— 截断会让单位只在跨越格线的那个 tick 才动一下，
 * 看上去就是一格一格跳。
 */
export function fromFixedExact(value: number): number {
  return value / ONE
}

/** 定点乘法：先乘后右移，结果截断（不做四舍五入，保证可复现）。 */
export function fixedMul(a: number, b: number): number {
  return Math.trunc((a * b) / ONE)
}

/** 定点除法：被除数先左移，截断。 */
export function fixedDiv(a: number, b: number): number {
  if (b === 0) throw new Error('fixedDiv by zero')
  return Math.trunc((a * ONE) / b)
}

export function absFixed(value: number): number {
  return value < 0 ? -value : value
}

/** 整数平方根，用于长度比较时避免浮点。 */
export function isqrt(value: number): number {
  if (value < 0) throw new Error('isqrt of negative')
  if (value < 2) return value
  let x = value
  let y = Math.trunc((x + 1) / 2)
  while (y < x) {
    x = y
    y = Math.trunc((x + Math.trunc(value / x)) / 2)
  }
  return x
}

/** 定点长度（欧氏距离的定点近似，全部整数运算）。 */
export function fixedLength(dx: number, dy: number): number {
  return isqrt(dx * dx + dy * dy)
}

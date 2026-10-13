/**
 * Bullet 飞行体纯逻辑（阶段 3「弹道」）。
 *
 * 原版证据（work/decompiled/ra2-engine/fn-47f9b0.c + fn-47f8b0.c + 头部汇编字节级核对）：
 * - **已确证**：45° 分支常量 = double 0x3fe921d9f4d37c12 = 0.78538225 rad（44.9991°）；
 *   参数物理布局 = `ret 0x14`（int, int, int, **double**, 输出指针）；输出为 16 位朝向角
 *   （fn-47f8b0 的 ftol+CONCAT22）；双调用二次验证（dist+1）。
 * - **未闭合（record_unknown）**：主分支公式的物理参数化——Ghidra 表达式在所有 24 种
 *   简单物理量映射（d/z/g/v/v²）下都不等于教科书抛物线式，说明存在额外变换或非教科书
 *   形式。**精确语义待汇编级参数追踪**。
 *
 * 因此本模块分两层：
 * - `solveArcAngle`：**本项目用标准抛物线双解建模**（物理自洽、可交叉验证）——
 *   属自定近似，参数化与 fn-47f9b0 的严格对齐待重核，**不是"原版如此"**；
 * - `solveArcAngleRomTranscription`：fn-47f9b0 表达式的 1:1 字节级转写（保留供未来
 *   拼图/对照），**未验证、勿依赖**。
 */

/** 原版固定角常量：double 0x3fe921d9f4d37c12 = 0.78538225 rad（44.9991°，非精确 π/4）。 */
export const ARC_FIXED_ANGLE = 0.78538225

/**
 * 抛物线抛射角（**本项目自定：标准式建模**，见模块注释；原版精确参数化待核）。
 *
 * 标准式：`tanθ = (v² ± √(v⁴ − g(g·d² + 2·dz·v²))) / (g·d)`（高抛取 +，低抛取 −）。
 * 无解（判别式 < 0）返回 null。
 *
 * @param horizontalDist 水平距离 d
 * @param heightDiff 目标高差 dz（+ = 目标更高）
 * @param gravity 重力 g（原版 rules+0x1320）
 * @param projectileSpeed 弹速 v
 *
 * **注意：原版 fn-47f9b0 的输入不含弹速（2026-10-14 定案，提交 6356bbf）**——
 * 本函数的"含弹速标准式"是本项目对弧线武器的**自定建模**，勿当作原版公式。
 */
export function solveArcAngle(
  horizontalDist: number,
  heightDiff: number,
  gravity: number,
  projectileSpeed: number,
  highArc: boolean,
): number | null {
  if (gravity === 0 || horizontalDist === 0) return null
  const v2 = projectileSpeed * projectileSpeed
  const disc =
    v2 * v2 - gravity * (gravity * horizontalDist * horizontalDist + 2 * heightDiff * v2)
  if (disc < 0) return null
  const root = Math.sqrt(disc)
  const tanTheta = (v2 + (highArc ? root : -root)) / (gravity * horizontalDist)
  return Math.atan(tanTheta)
}

/**
 * fn-47f9b0 主分支的 1:1 转写（变量名 = Ghidra 输出，参数按 Ghidra 位置 p2..p5）。
 *
 * **2026-10-14 注**：字节级定案——物理参数三要素 = **(水平距离, 高差, 重力 Gravity)**，
 * 不含弹速（转写式中无弹速项 ⇒ 原版非"给定弹速求发球角"）；45° 门控 = **Gravity > 0**
 * （`[ebp+0xc]` = 栈上 Gravity double 的高 dword 判正）。**本转写仅作形态参照**，
 * 变量到物理参数的逐项映射仍待最后一层（record_unknown）。
 *
 * **未验证、勿依赖**：转写忠实于 Ghidra 表达式（见 fn-47f9b0.c），但物理参数语义
 * 未闭合（对上文 record_unknown）。保留此函数供未来与汇编级参数追踪拼图。
 * `g > 0` 分支同样返回固定角（原版行为）。
 */
export function solveArcAngleRomTranscription(
  p2: number,
  p3: number,
  p4: number,
  p5: number,
  highArc: boolean,
): number | null {
  if (p4 > 0) return ARC_FIXED_ANGLE
  if (p2 === 0) return null
  const h = p3 === 0 ? 0 : p3
  const d2 = p2 * p2
  const v1 = d2 - p4 * p5
  const h2 = h * h
  let disc = d2 * p2 * p2 - d2 * p4 * p5 * 2 - p5 * p5 * h2
  let denom = (p4 * p4) / h2 + 1.0
  denom = denom + denom
  if (disc < 0 || !Number.isFinite(denom) || denom === 0) return null
  let root = Math.sqrt(disc)
  root = highArc ? root + v1 : v1 - root
  root = root / denom
  if (!(root >= 0)) return null
  const theta = Math.atan(Math.sqrt(root) / p2)
  return Number.isFinite(theta) ? theta : null
}

/** 16 位角 → 弧度换算（原版 _DAT_0079b620 = −9.587672516830327e-05，负号=顺时针约定）。 */
export const ANGLE16_TO_RADIANS = -9.587672516830327e-05

/**
 * 弹道散布：按 BallisticScatter 随机偏移落点（**原版口径，fn-6ca890:191-234 解码**）。
 *
 * 原版机制（分支 B，随距离加权）：
 * - 偏移半径 `r = RNG(0, BallisticScatter) × 距离 / 射程`（**越远越不准**，ptol 取整）；
 * - 随机角 `θ = (RNG(0, 0x7ffffffe) − 0x3fff) × |0x79b620|`（16 位角中心化 → 弧度）；
 * - 落点 = 目标点 + r·(cosθ, sinθ)（fn-6ca890 尾部的分量合成）。
 * 相关门控（原版 fn-6ca890:191-194）：`BulletType+0x272`（可散布标志）且 `+0x26b`，
 * 且（`+0x273 == 0` 或 `+0x26e != 0`）——**精确分流条件与分支 A（`RNG(scatter/2,scatter)`
 * 变体）的适用语义待核（record_unknown）**；本函数落分支 B。
 *
 * `rand` 为注入的 [0,1) 确定性随机源（world.rng 惯例，禁 Math.random 照 sim 规范）。
 * 三角函数用 Math（**原版走 500 项 sin 查表，步长 0.125 rad，表值=ftol(sin)——本项目
 * 自定直算，潜在末位差异已标注**）。
 *
 * @param targetX 目标点 X（lepton）
 * @param targetY 目标点 Y（lepton）
 * @param dist 发射点到目标的 3D 距离
 * @param range 当前武器射程（原版虚 +0x154）
 * @param ballisticScatter rules+0x139c（BallisticScatter，int）
 */
export function scatterShot(
  targetX: number,
  targetY: number,
  dist: number,
  range: number,
  ballisticScatter: number,
  rand: () => number,
): { readonly x: number; readonly y: number } {
  if (ballisticScatter <= 0 || range <= 0) return { x: targetX, y: targetY }
  const r = Math.trunc((rand() * ballisticScatter * dist) / range)
  const theta = (rand() * 2 - 1) * Math.PI // 中心化 [−π, π)
  return {
    x: targetX + Math.trunc(r * Math.cos(theta)),
    y: targetY + Math.trunc(r * Math.sin(theta)),
  }
}

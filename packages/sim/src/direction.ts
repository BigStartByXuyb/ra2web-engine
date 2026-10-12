/**
 * 八方向与朝向口径 —— 全部来自原版 `GAME.EXE` 证据。
 *
 * 证据：`docs/ENGINE-MAP.md`「单位移动核心」。
 *
 * - 格步进表与 lepton 步进表：原版初始化器 `0x491620`（short）与 `0x4916d0`（int）
 *   手工反汇编读出（两张表在 BSS，文件里没有值）。次序为顺时针、从北起。
 * - 朝向是 16 位角，顺时针，0 = 北，每 45° = 8192（推进核心 `0x4a2670` 里 `方向 << 13`）。
 * - 由朝向取方向的原版式子：`dir = ((facing >> 12) + 1) >> 1 & 7`（`0x4b8be0` 调用处），
 *   即每方向占 ±22.5° 的扇区。
 */

/** 原版格步进表 `0x851a70`：每方向一格的 (dx, dy)。 */
export const CELL_STEPS: readonly { readonly x: number; readonly y: number }[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
]

/** 方向数（8） */
export const DIRECTION_COUNT = CELL_STEPS.length

/** 原版 lepton 步进表 `0x851ac0`：每方向到下一格心的 lepton 偏移。斜向 (±256,±256)。 */
export const LEPTON_STEPS: readonly { readonly x: number; readonly y: number }[] = [
  { x: 0, y: -256 },
  { x: 256, y: -256 },
  { x: 256, y: 0 },
  { x: 256, y: 256 },
  { x: 0, y: 256 },
  { x: -256, y: 256 },
  { x: -256, y: 0 },
  { x: -256, y: -256 },
]

/** 每 45° 的朝向单位数（推进核心 `方向 << 13`） */
export const FACING_PER_STEP = 8192

/** 8 个方向 */
export const FACING_STEPS = 8

/** 全圆朝向单位数（16 位角） */
export const FACING_FULL = FACING_PER_STEP * FACING_STEPS

/** 寻路/邻格用的方向表（与格步进表同一份）。 */
export const DIRECTIONS = CELL_STEPS

/** 原版式：16 位朝向角 → 方向下标。 */
export function dirFromFacing(facing: number): number {
  return ((facing >> 12) + 1) >> 1 & 7
}

/** 方向下标 → 该方向中心角的 16 位朝向角。 */
export function facingFromDir(dir: number): number {
  return ((dir % DIRECTION_COUNT) + DIRECTION_COUNT) % DIRECTION_COUNT * FACING_PER_STEP
}

/** 位移方向（按符号）→ 方向下标；零向量返回 0。 */
export function dirFromDelta(dx: number, dy: number): number {
  if (dx > 0) return dy < 0 ? 1 : dy > 0 ? 3 : 2
  if (dx < 0) return dy < 0 ? 7 : dy > 0 ? 5 : 6
  return dy < 0 ? 0 : dy > 0 ? 4 : 0
}

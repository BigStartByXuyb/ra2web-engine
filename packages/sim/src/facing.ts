import { FACING_FULL } from './direction.js'

/**
 * FacingClass（原版朝向插值结构，战斗线取证）：ENGINE-MAP「炮塔」节 —
 *   `{+0x00 当前朝向 short, +0x04 目标朝向 short, +0x08 起始帧 int(−1=静止),
 *     +0x10 时长帧 int, +0x14 每帧转量 short}`（24 字节）；
 *   **车体实例 @ techno+0x2e0、炮塔实例 @ techno+0x2f8**。
 *   插值器三件：`0x4b8a30` 起步打点 / `0x4b8b10` 按全局帧计数（DAT_00a40d2c）推进，
 *   到达即"静止化"（起始帧=当前帧、时长为 0）/ `0x4b8be0` 读取。
 *
 * sim 口径（本项目自定处已标注）：
 * - 帧 = tick（sim 的固定步进就是原版的帧）；
 * - 恒速段用"每 tick 转 `rate`、`|Δ| ≤ rate` 时一步到点"实现——与既有转向行为**逐位一致**
 *   （`packages/sim/src/unit.ts` 原有的 rotateToward 口径，转向时序已按 fn-4a2670 取证）；
 *   0x4b8b10 的帧算术（由剩余帧数反推）与恒速步进的精确差异记台账，不影响恒速结果；
 * - 炮塔转速键 **`TurretRate` 在原版不存在**（战斗线全文件扫描），追随速率取本项目自定常量，
 *   标注见 `TURRET_FOLLOW_RATE`。
 */
export interface FacingState {
  /** 当前朝向（16 位角，顺时针 0=北），恒在 [0, FACING_FULL) */
  current: number
  /** 目标朝向（16 位角） */
  target: number
  /** 本段插值起始 tick；−1 = 静止（对应 +0x08 起始帧 −1 的"无插值在跑"） */
  startTick: number
  /** 本段总帧数 = ⌈|起点−目标| / rate⌉（对应 +0x10 时长帧） */
  duration: number
  /** 每 tick 转量（16 位角单位；对应 +0x14，原版为每帧转量） */
  rate: number
}

/**
 * 炮塔无战斗目标时追随车体的转速（16 位角/tick）。
 *
 * **本项目自定**：原版 `TurretRate` 键不存在（战斗线扫全文件无串），转速来源待核
 * （候选：与车体 ROT 共用或硬编码）。取 4096（= 45° 的一半）让追随明显滞后于车体、
 * 肉眼可辨——战斗线瞄准口径回收后替换为精确值。
 */
export const TURRET_FOLLOW_RATE = 4096

export function normalizeFacing(angle: number): number {
  return ((angle % FACING_FULL) + FACING_FULL) % FACING_FULL
}

/** 两个朝向之间的最短带符号差（环形，结果落在 (−32768, 32768]） */
export function facingDelta(from: number, to: number): number {
  let diff = (((to - from + FACING_FULL / 2) % FACING_FULL) + FACING_FULL) % FACING_FULL
  diff -= FACING_FULL / 2
  return diff
}

/** 建一份朝向状态；初始即静止（+0x08 的 −1 缺省）。 */
export function createFacing(facing = 0, rate = 0): FacingState {
  const current = normalizeFacing(facing)
  return { current, target: current, startTick: -1, duration: 0, rate }
}

export function facingIsIdle(state: FacingState): boolean {
  return state.startTick === -1 || state.rate <= 0 || state.current === state.target
}

/**
 * 设定目标朝向并打点（对应 0x4b8a30）：记起始 tick、算时长；目标与当前一致时保持静止。
 */
export function setFacingTarget(state: FacingState, target: number, rate: number, tick: number): void {
  const normalized = normalizeFacing(target)
  if (normalized === state.current) {
    state.target = state.current
    state.startTick = -1
    state.duration = 0
    state.rate = rate
    return
  }
  state.target = normalized
  state.rate = rate
  state.startTick = tick
  state.duration = rate > 0 ? Math.max(1, Math.ceil(Math.abs(facingDelta(state.current, normalized)) / rate)) : 0
}

/**
 * 推进一帧（对应 0x4b8b10）：静止段不动；否则按 rate 朝目标转，到点收敛并"静止化"。
 */
export function advanceFacing(state: FacingState, tick: number): void {
  if (state.rate <= 0 || state.current === state.target) return
  const diff = facingDelta(state.current, state.target)
  if (Math.abs(diff) <= state.rate) {
    state.current = state.target
    // 到达分支：起始帧 = 当前帧、时长/转量归零（0x4b8b10 的静止化）
    state.startTick = tick
    state.duration = 0
    state.rate = 0
    return
  }
  state.current = normalizeFacing(state.current + Math.sign(diff) * state.rate)
}

/** 朝向换算成渲染用弧度（16 位角 → 弧度，供渲染层读） */
export function facingRadians(facing: number): number {
  return (facing * (Math.PI * 2)) / FACING_FULL
}

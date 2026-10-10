/**
 * 原版速度值 → 每 tick 定点位移的换算。
 *
 * 原版以"lepton"为最小位移单位，256 lepton = 1 格；`rules.ini` 里
 * `[<Unit>] Speed=` 的单位即 lepton/tick（15 tick/秒）。
 *
 * 本项目的定点基也是 1 格 = 256（`ONE`），因此换算系数为 1：Speed 值直接等于每 tick 位移。
 *
 * ⚠ 待核对：这个等价关系来自对原版单位的读法，尚未与原版引擎中处理 Speed 的函数逐条对齐。
 * 核对方式见 `docs/ENGINE-MAP.md` 的"待核对"清单；核对前不要据此调数值平衡。
 */

/** 1 格包含的 lepton 数（原版单位制） */
export const LEPTONS_PER_CELL = 256

/** 逻辑帧率：原版为 15 tick/秒 */
export const TICKS_PER_SECOND = 15

/** 把 rules.ini 里的 Speed 值换算为每 tick 的定点位移。 */
export function speedToMovementPerTick(rawSpeed: number): number {
  if (!Number.isFinite(rawSpeed) || rawSpeed <= 0) return 0
  return Math.round(rawSpeed)
}

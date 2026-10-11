/**
 * 原版速度值 → 每 tick 定点位移的换算。
 *
 * 原版以"lepton"为最小位移单位，256 lepton = 1 格，逻辑帧 15 帧/秒；
 * `rules.ini` 里 `[<Unit>] Speed=` 不是 lepton/tick，而是**百分比**：
 *
 * ```
 * 每 tick 位移（lepton）= min( min(Speed, 100) * 256 / 100, 255 )
 * ```
 *
 * 判定依据：ModEnc 的 `Speed` 条目写明程序用这条式子算实际速度
 * （"The program calculates the actual speed using the formula min( (min(Speed, 100) * 256 / 100), 255 )"），
 * 并说明实际速度还要再乘地块类型的 SpeedType 系数（本层只算基准值）。
 * 官方网页客户端（Chrono Divide）的 `BASE_TICKS_PER_SECOND` 同样是 15，
 * 但它对车/船/超时空用 `256 × Speed / 65`、其余用 `/100` —— 车辆比这条原版式子快 1.54 倍，
 * 属于那个客户端自己的取值，本项目按原版式子实现。
 *
 * 未实现（原版还有的两条，都在 ModEnc 同一条目里）：步兵爬行 2/3、行走 3/2 速度；
 * 车辆被击伤（crippled）后 3/4 速度。
 */

/** 1 格包含的 lepton 数（原版单位制） */
export const LEPTONS_PER_CELL = 256

/** 逻辑帧率：原版为 15 tick/秒 */
export const TICKS_PER_SECOND = 15

/** `Speed=` 的上限：超过 100 按 100 算 */
export const MAX_INI_SPEED = 100

/** 每 tick 位移的上限（原版式子的 255，比 1 格少 1 lepton） */
export const MAX_MOVEMENT_PER_TICK = 255

/** 把 rules.ini 里的 Speed 值换算为每 tick 的定点位移。 */
export function speedToMovementPerTick(rawSpeed: number): number {
  if (!Number.isFinite(rawSpeed) || rawSpeed <= 0) return 0
  const capped = Math.min(rawSpeed, MAX_INI_SPEED)
  return Math.min(Math.round((capped * LEPTONS_PER_CELL) / 100), MAX_MOVEMENT_PER_TICK)
}

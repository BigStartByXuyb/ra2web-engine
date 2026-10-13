/**
 * 战斗计算：Warhead→Armor 伤害修正（阶段 2「Verses 应用侧」）。
 *
 * 原版口径（docs/ENGINE-MAP.md「武器与弹头」「开火判定链」节，证据见
 * work/decompiled/ra2-engine/fn-7204e0.md / fn-47e2c0.c / fn-6c1380.c / fn-6d3400.c）：
 * - 弹头对护甲表 Verses：11×double @ WarheadTypeClass+0xa0，INI `Verses=` 逗号切分
 *   循环 11 次，`%` 项 ×0.01，缺省全 1.0（缺省串 0x7fb1e0 = "100%%," ×11）。
 * - 目标护甲：Armor 枚举 0..10 存于 TechnoTypeClass+0x9c（int；0x47e2c0 收集器下游与
 *   fn-6d7550 的 `+0xa0 + armor*8` 取 double 均以它为下标；枚举序见 packages/rules
 *   armor-type.ts，指针表 0x79ddf8 逐项核对）。
 * - 有效性：目标选择按 `Verses[armor] != 0.0` 判"武器对该护甲是否有效"
 *   （fn-6c1380/fn-6d3400 两处比较，==0 视为无效不作为目标）。
 * - 乘法为 double（原版 x87 fmul 读 qword）；**取整时点未核**（伤害落到扣血在
 *   阶段 4「伤害结算」取证），本模块不做取整。
 *
 * 距离衰减（fn-47e1c0：距离 × Warhead+0x12c float，上限 rules+0x1330）的精确语义
 * 归阶段 4，这里不实现。本模块保持纯函数、不依赖任何其它包（照 sim 包零依赖惯例，
 * 数据由调用方从 packages/rules 解析结果传入）。
 */

/** Verses 项数；与 packages/rules `VERSES_COUNT` 一致（原版解析循环恰好 11 次）。 */
export const VERSES_COUNT = 11

/**
 * 取目标护甲对应的 Verses 乘数。
 *
 * 下标越界时返回 1.0：原版 Armor 恒存 0..10（int @+0x9c），越界只可能来自
 * 上游数据错误，按恒等修正处理并交由调用方告警——这是本项目自定的防御口径，
 * 原版无此分支（越界读未定义）。
 */
export function versesMultiplier(verses: readonly number[], armorIndex: number): number {
  if (armorIndex < 0 || armorIndex >= verses.length) return 1
  const value = verses[armorIndex]
  return value === undefined ? 1 : value
}

/**
 * 伤害乘 Verses：`damage × Warhead.Verses[targetArmor]`。
 *
 * double 语义直接用 JS number（同为 IEEE-754 double，fmul 结果位一致）。
 * 不取整（见模块注释：取整时点归阶段 4）。
 */
export function applyVerses(damage: number, verses: readonly number[], armorIndex: number): number {
  return damage * versesMultiplier(verses, armorIndex)
}

/**
 * 武器对该护甲是否有效：`Verses[armor] != 0.0`。
 *
 * 原版证据：目标选择按此比较排除无效目标（fn-6c1380.c:53/56、fn-6d3400.c:120/194，
 * `_DAT_0079b610` = 0.0）。越界下标照 `versesMultiplier` 的自定防御口径视为无效
 * 之外的恒等——这里保守返回 false 吗？不：与乘数口径一致返回 true（=1.0 可伤），
 * 保持两函数对同一输入的结论一致（本项目自定）。
 */
export function canDamage(verses: readonly number[], armorIndex: number): boolean {
  return versesMultiplier(verses, armorIndex) !== 0
}

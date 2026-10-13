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

/**
 * 武器射程口径（阶段 3「开火判定」）。
 *
 * 原版证据（fn-6c4bb0.c，0x6c4bb0 = In_Range；Range/MinRange 偏移见 fn-733220.md）：
 * - `Range == -512` 哨兵 → 无限程直通；
 * - 目标在空中（虚 +0x54）→ Range += TechnoType+0x5b4（对空射程加成，键名待核）；
 * - `MinRange（+0xb8）> 3D 距离` → 拒发（太近打不了）；
 * - 距离为 3D 欧氏（dx²+dy²+dz² 取整，fn-6c4bb0 的 FUN_004ba410+FUN_0077f110）。
 * 本函数由调用方传入已算好的 3D 距离；比较用 `<=`（原版上限比较的相等分支归属
 * 未逐指令核对，取含等号口径——本项目自定）。
 */

/** 无限射程哨兵（fn-6c4bb0：Range == -0x200 直通）。 */
export const UNLIMITED_RANGE = -512

export interface WeaponRange {
  /** WeaponType+0xb4，格 */
  readonly range: number
  /** WeaponType+0xb8，格 */
  readonly minRange: number
}

/** 目标是否在武器射程内（0x6c4bb0 口径）。`airRangeBonus` = TechnoType+0x5b4。 */
export function isInRange(
  weapon: WeaponRange,
  dist3D: number,
  airborne: boolean,
  airRangeBonus: number,
): boolean {
  if (weapon.range === UNLIMITED_RANGE) return true
  const maxRange = weapon.range + (airborne ? airRangeBonus : 0)
  if (dist3D < weapon.minRange) return false
  return dist3D <= maxRange
}

/**
 * 爆炸承载（Anim 系统，阶段 3）。
 *
 * 原版证据（fn-421710.c AnimClass::AI 爆炸分支 + fn-70e470.c AnimTypeClass::Read_INI）：
 * - **AnimType+0x2c8 ← Warhead=**（按名 → WarheadType\*，Warhead 真身）；
 * - **AnimType+0x2c4 ← DamageRadius（int）**；爆炸分支门控 = `DamageRadius != 0`
 *   （0x4219fc-0x421a04 TEST/JZ，与 Read_INI 双源印证）；
 * - 引爆走 FUN_0047e2c0（AoE：CellSpread 半径收集目标 → 逐目标伤害）。
 * 伤害计算 = 本模块 `applyVerses`（Warhead 的 Verses 表 × 基础伤害）。
 * **距离衰减（fn-47e1c0）与 CellSpread 半径筛选的精确口径归阶段 4**，未落。
 */

/** 爆炸动画承载的伤害三件套（AnimType 字段的 sim 投影）。 */
export interface ExplosionAnim {
  /** Warhead 的 Verses 表（WarheadType+0xa0，11 项） */
  readonly verses: readonly number[]
  /** AnimType+0x2c4；0 = 该动画不造成伤害 */
  readonly damageRadius: number
}

/** 该爆炸动画是否造成伤害（fn-421710 的 DamageRadius != 0 门控）。 */
export function hasDamage(an: ExplosionAnim): boolean {
  return an.damageRadius !== 0
}

/**
 * 爆炸对每个目标结算 Verses 修正伤害。
 *
 * `targets` 由调用方按 CellSpread 半径筛好（半径筛选口径归阶段 4，未落）；
 * 顺序与输入一致，逐目标 `applyVerses`（不取整，见模块头注释）。
 */
export function applyExplosion(
  an: ExplosionAnim,
  damageBase: number,
  targets: readonly { readonly armorIndex: number }[],
): number[] {
  return targets.map((target) => applyVerses(damageBase, an.verses, target.armorIndex))
}

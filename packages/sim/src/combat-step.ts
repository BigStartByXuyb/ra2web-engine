import { applyVerses, type UnitWeapon } from './combat.js'
import { dirFromDelta, facingFromDir } from './direction.js'
import { facingDelta, setFacingTarget, TURRET_FOLLOW_RATE } from './facing.js'
import { isqrt, ONE } from './fixed.js'
import { nextBelow, type RngState } from './rng.js'
import type { Unit } from './unit.js'

/**
 * 战斗步进（阶段 3 集成：挂进 world.step）。
 *
 * 链路口径（全部来自战斗线取证，见 docs/COMBAT-STAGE3-CLOSURE.md 与 ENGINE-MAP）：
 *   目标检查（存活 + 射程 0x6c4bb0）→ 炮塔瞄准（FacingClass 第二份 @+0x2f8，
 *   接口 = facing.ts 的 setFacingTarget/advanceFacing）→ 对齐判定（到点收敛）→
 *   开火（0x6ca890 语义：ROF 冷却 + 发射）→ 弹体（0x7213a0 散布口径：发射时定终点
 *   0x4616b0）→ 定时插值（visible shell = 直线演出，非积分——终十七定案）→
 *   到达引爆（0x462110 → 0x47e2c0 AoE）→ Verses 修正伤害扣血。
 *
 * **本项目自定处（原版口径未核，已标注）**：
 * - 炮塔瞄准速率 `TURRET_AIM_RATE`（原版 TurretRate 键不存在；追随车体速率另见 facing.ts）；
 * - 弹体飞行时长 `SHELL_FLIGHT_TICKS`（原版时长换算 0x47fb70×1.2 与 fn-461c10 的时间耗尽
 *   判定待精确核）；
 * - 对齐判定 = 炮塔到点收敛（`turret.current === 目标角`，advanceFacing 的到点语义）；
 * - 伤害取整时点：`Math.round`（原版未核，阶段 4 清算）；
 * - 射程外行为：不瞄不开火（原版走位搜索 0x4c4c30 未集成，见结项报告开放项）。
 */

/** 炮塔瞄准转速（16 位角/tick）。**本项目自定**：原版 TurretRate 键不存在，取与追随同值。 */
export const TURRET_AIM_RATE = TURRET_FOLLOW_RATE

/** 弹体飞行时长（tick）。**本项目自定**：原版 0x47fb70（×1.2）与 0x461c10 时间耗尽待核。 */
export const SHELL_FLIGHT_TICKS = 6

/**
 * 弹体：发射时定死起点/终点/时长（原版 FUN_004616b0 口径，散布在发射时应用），
 * 飞行 = 定时直线插值（visible shell 非积分架构，终十七定案）。
 */
export interface Shell {
  readonly ownerId: number
  /** 起点（lepton，3D） */
  readonly x0: number
  readonly y0: number
  readonly z0: number
  /** 终点（lepton，3D；散布已应用） */
  readonly x1: number
  readonly y1: number
  readonly z1: number
  readonly startTick: number
  readonly duration: number
  /** 到达时的 AoE 参数（发射时定死：0x4616b0 的"终点+载荷"模式） */
  readonly damage: number
  readonly verses: readonly number[]
  readonly cellSpread: number
}

/** 3D 距离（lepton，整数 isqrt——原版 0x4ba410 sqrt 近似的 sim 投影）。 */
function dist3D(a: Unit, b: Unit): number {
  return isqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) + (a.z - b.z) * (a.z - b.z))
}

/** [0,1) 确定性随机（world.rng 为唯一随机源；scatterShot 的注入形态）。 */
function rand01(rng: RngState): number {
  return nextBelow(rng, 0x10000) / 0x10000
}

/** 散布偏移落点（原版 BallisticScatter 口径：r = RNG(0,scatter)×dist/range + 随机角）。 */
function scatterTarget(
  tx: number,
  ty: number,
  distCells: number,
  range: number,
  scatter: number,
  rng: RngState,
): { x: number; y: number } {
  if (scatter <= 0 || range <= 0) return { x: tx, y: ty }
  const r = Math.trunc((rand01(rng) * scatter * distCells) / range)
  const theta = (rand01(rng) * 2 - 1) * Math.PI
  return { x: tx + Math.trunc(r * Math.cos(theta)), y: ty + Math.trunc(r * Math.sin(theta)) }
}

/** 在 [0,1) 上探测落点是否落在两单位间（供 AoE 收集，单位判据按中心距离 ≤ 半径）。 */
function unitInSpread(unit: Unit, cx: number, cy: number, radiusLepton: number): boolean {
  const dx = unit.x - cx
  const dy = unit.y - cy
  return dx * dx + dy * dy <= radiusLepton * radiusLepton
}

/**
 * 单位瞄准：有有效攻击目标且在射程内 → 炮塔瞄准目标；否则交由 world 的追随逻辑
 * （引擎线的"无目标追随车体"口径）。返回本 tick 是否处于"有目标在射程内"状态。
 */
export function combatAim(unit: Unit, target: Unit | undefined, airborne: boolean, tick: number): boolean {
  if (!target || unit.weapon === undefined || unit.health <= 0 || target.health <= 0) return false
  const dx = target.x - unit.x
  const dy = target.y - unit.y
  if (dx === 0 && dy === 0) return false
  const dist = dist3D(unit, target)
  const bonus = unit.weapon.airRangeBonus ?? 0
  const maxRange = unit.weapon.range + (airborne ? bonus : 0)
  if (dist < unit.weapon.minRange || dist > maxRange * ONE) return false
  const aimFacing = facingFromDir(dirFromDelta(dx, dy))
  setFacingTarget(unit.turret, aimFacing, TURRET_AIM_RATE, tick)
  return true
}

/**
 * 开火判定（在 advanceFacing 之后调用）：冷却归零且炮塔对齐 → 生成弹体。
 * 对齐 = 炮塔 current == target（advanceFacing 的到点收敛态）。
 */
export function combatFire(
  unit: Unit,
  target: Unit | undefined,
  tick: number,
  rng: RngState,
  ballisticScatter: number,
): Shell | undefined {
  if (!target || unit.weapon === undefined || unit.health <= 0 || target.health <= 0) return undefined
  if (unit.cooldown > 0) return undefined
  if (unit.turret.current !== unit.turret.target) return undefined
  const weapon: UnitWeapon = unit.weapon
  const dist = dist3D(unit, target)
  const aimed = scatterTarget(
    target.x,
    target.y,
    dist / ONE,
    weapon.range,
    ballisticScatter,
    rng,
  )
  unit.cooldown = weapon.rof
  return {
    ownerId: unit.id,
    x0: unit.x,
    y0: unit.y,
    z0: unit.z,
    x1: aimed.x,
    y1: aimed.y,
    z1: target.z,
    startTick: tick,
    duration: SHELL_FLIGHT_TICKS,
    damage: weapon.damage,
    verses: weapon.verses,
    cellSpread: weapon.cellSpread,
  }
}

/** 弹体推进一 tick：到点引爆（AoE → Verses → 扣血）。返回仍在飞的弹体。 */
export function advanceShells(shells: Shell[], units: readonly Unit[], tick: number): Shell[] {
  const flying: Shell[] = []
  for (const shell of shells) {
    const elapsed = tick - shell.startTick
    if (elapsed < shell.duration) {
      flying.push(shell)
      continue
    }
    // 引爆：0x47e2c0 AoE（半径 = cellSpread 格）+ 逐目标 Verses（applyVerses）
    const radius = shell.cellSpread * ONE
    for (const unit of units) {
      if (unit.health <= 0 || unit.id === shell.ownerId) continue
      if (!unitInSpread(unit, shell.x1, shell.y1, radius)) continue
      const damage = applyVerses(shell.damage, shell.verses, unit.armorIndex)
      // 扣血取整：本项目自定 Math.round（原版取整时点阶段 4 清算）
      unit.health = Math.max(0, unit.health - Math.round(damage))
    }
  }
  return flying
}

/** 两单位间是否"瞄准线可用"的占位（原版视线 0x47f8b0；地形遮挡归后续）。 */
export function hasLineOfSight(): boolean {
  return true
}

/** 朝向差（供外部对齐查询/渲染用，facingDelta 的再导出语义包装）。 */
export function turretAimError(unit: Unit, target: Unit): number {
  const aim = facingFromDir(dirFromDelta(target.x - unit.x, target.y - unit.y))
  return facingDelta(unit.turret.current, aim)
}

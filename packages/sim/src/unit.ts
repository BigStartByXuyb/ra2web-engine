import { dirFromDelta, facingFromDir, FACING_FULL, FACING_PER_STEP } from './direction.js'
import { isqrt, ONE } from './fixed.js'
import type { Cell } from './grid.js'

/**
 * 单位：位置与推进全部定点整数（1 格 = 256，即原版的 1 格 = 256 lepton）。
 *
 * 移动口径来自原版证据（docs/ENGINE-MAP.md「单位移动核心」）：
 * 位置沿"到下一格心的直线"推进（原版 lepton 步进表斜向 (±256,±256)，速度按平欧氏距离
 * 消耗）；单位有朝向，16 位角顺时针 0 = 北，转向按 tick 渐进（原版 `0x4b8be0` 为插值器）。
 */

/** 单位：位置与推进全部定点整数。 */
export interface Unit {
  readonly id: number
  readonly owner: number
  /** 定点坐标（1 格 = ONE）。z 是 lepton（一级高度 = 90，见 `heights`）。 */
  x: number
  y: number
  z: number
  health: number
  /** 每 tick 推进的定点距离（lepton） */
  readonly speed: number
  /** 视野半径（格）；迷雾按它揭开 */
  readonly sight: number
  /** 朝向：16 位角，顺时针，0 = 北，每 45° = 8192 */
  facing: number
  /** 每 tick 最大转向量（16 位角单位）。原版转速与 rules `ROT=` 的换算未核，此默认值是本项目自定。 */
  readonly turnRate: number
  /** 满血值（原版单位类型的 Strength）；伤车判定用它算血量百分比。缺省按创建时的 health。 */
  readonly maxHealth: number
  /** 坡度乘数选组（fn-4a2670 按 techno+0x5a4==1 选 Tracked 组）；缺省 other 组 */
  slopeClass: 'track' | 'other' | undefined
  /** 剩余路径（格子），空表示无移动任务 */
  path: Cell[]
  pathIndex: number
  /** 移动命令的最终目的地；无移动任务时为 undefined */
  target: Cell | undefined
  /** 连续被挡的 tick 数（碰撞等待计数） */
  blockedTicks: number
}

/** 默认每 tick 转向量：45°/tick（本项目自定；原版转速与 rules `ROT=` 的换算未核，待对齐）。 */
export const DEFAULT_TURN_RATE = FACING_PER_STEP

export function createUnit(
  id: number,
  owner: number,
  cell: Cell,
  speed: number,
  health: number,
  sight: number,
  facing = 0,
  turnRate = DEFAULT_TURN_RATE,
  maxHealth = 0,
  z = 0,
): Unit {
  return {
    id,
    owner,
    x: cell.x * ONE + (ONE >> 1),
    y: cell.y * ONE + (ONE >> 1),
    z,
    health,
    speed,
    sight,
    facing: ((facing % FACING_FULL) + FACING_FULL) % FACING_FULL,
    turnRate,
    maxHealth: maxHealth > 0 ? maxHealth : health,
    slopeClass: undefined,
    path: [],
    pathIndex: 0,
    target: undefined,
    blockedTicks: 0,
  }
}

/** 单位中心所在的格子。 */
export function unitCell(unit: Unit): Cell {
  return { x: Math.trunc(unit.x / ONE), y: Math.trunc(unit.y / ONE) }
}

/** 朝向向目标角转一格（最短方向，环形），最多 rate。 */
function rotateToward(facing: number, target: number, rate: number): number {
  let diff = (((target - facing + FACING_FULL / 2) % FACING_FULL) + FACING_FULL) % FACING_FULL
  diff -= FACING_FULL / 2
  if (Math.abs(diff) <= rate) return ((target % FACING_FULL) + FACING_FULL) % FACING_FULL
  return (((facing + Math.sign(diff) * rate) % FACING_FULL) + FACING_FULL) % FACING_FULL
}

/**
 * 朝当前路径点直线推进一 tick。
 *
 * 距离是 **x/y/z 同权的 3D 欧氏**（原版证据：fn-4c3000 的 dx²+dy²+dz²、
 * ENGINE-MAP「运动逻辑里的距离是平的欧氏距离」）——上/下坡时 3D 路程更长，
 * 同速下格子耗时按比例变长。全程整数运算，不产生浮点、跨平台结果一致。
 * 剩余速度不跨段结转（本项目自定，原版结转口径未核）。
 * `effectiveSpeed` 由 world 给（地表/坡度系数折算后的本 tick 速度），缺省用 unit.speed。
 * `heights` 提供每格高度级（一级 = 90 lepton）；不给就按平地（z 不变）。
 */
export function advanceAlongPath(unit: Unit, effectiveSpeed: number = unit.speed, zOf?: (cell: Cell) => number): void {
  let budget = effectiveSpeed
  while (budget > 0 && unit.pathIndex < unit.path.length) {
    const waypoint = unit.path[unit.pathIndex]!
    const targetX = waypoint.x * ONE + (ONE >> 1)
    const targetY = waypoint.y * ONE + (ONE >> 1)
    const targetZ = zOf !== undefined ? zOf(waypoint) : unit.z
    const dx = targetX - unit.x
    const dy = targetY - unit.y
    const dz = targetZ - unit.z
    if (dx === 0 && dy === 0 && dz === 0) {
      unit.pathIndex++
      continue
    }
    // 朝向先转：目标角 = 段方向的中心角（渐进，不瞬变；朝向只看平面分量）
    if (dx !== 0 || dy !== 0) {
      unit.facing = rotateToward(unit.facing, facingFromDir(dirFromDelta(dx, dy)), unit.turnRate)
    }

    const dist = isqrt(dx * dx + dy * dy + dz * dz)
    const advance = Math.min(budget, dist)
    const moveX = advance === dist ? dx : Math.trunc((dx * advance) / dist)
    const moveY = advance === dist ? dy : Math.trunc((dy * advance) / dist)
    const moveZ = advance === dist ? dz : Math.trunc((dz * advance) / dist)
    unit.x += moveX
    unit.y += moveY
    unit.z += moveZ
    budget -= advance
    if (unit.x === targetX && unit.y === targetY && unit.z === targetZ) unit.pathIndex++
  }
  if (unit.pathIndex >= unit.path.length) {
    unit.path = []
    unit.pathIndex = 0
  }
}

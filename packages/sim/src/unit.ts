import { dirFromDelta, facingFromDir, FACING_FULL, FACING_PER_STEP } from './direction.js'
import { fixedLength, ONE } from './fixed.js'
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
  /** 定点坐标（1 格 = ONE） */
  x: number
  y: number
  health: number
  /** 每 tick 推进的定点距离（lepton） */
  readonly speed: number
  /** 视野半径（格）；迷雾按它揭开 */
  readonly sight: number
  /** 朝向：16 位角，顺时针，0 = 北，每 45° = 8192 */
  facing: number
  /** 每 tick 最大转向量（16 位角单位）。原版转速与 rules `ROT=` 的换算未核，此默认值是本项目自定。 */
  readonly turnRate: number
  /** 剩余路径（格子），空表示无移动任务 */
  path: Cell[]
  pathIndex: number
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
): Unit {
  return {
    id,
    owner,
    x: cell.x * ONE + (ONE >> 1),
    y: cell.y * ONE + (ONE >> 1),
    health,
    speed,
    sight,
    facing: ((facing % FACING_FULL) + FACING_FULL) % FACING_FULL,
    turnRate,
    path: [],
    pathIndex: 0,
  }
}

/** 单位中心所在的格子。 */
export function unitCell(unit: Unit): Cell {
  return { x: Math.trunc(unit.x / ONE), y: Math.trunc(unit.y / ONE) }
}

/** 朝向向目标角转一格（最短方向，环形），最多 rate。 */
function rotateToward(facing: number, target: number, rate: number): number {
  let diff = ((target - facing + FACING_FULL / 2) % FACING_FULL + FACING_FULL) % FACING_FULL
  diff -= FACING_FULL / 2
  if (Math.abs(diff) <= rate) return ((target % FACING_FULL) + FACING_FULL) % FACING_FULL
  return (((facing + Math.sign(diff) * rate) % FACING_FULL) + FACING_FULL) % FACING_FULL
}

/**
 * 朝当前路径点直线推进一 tick。
 *
 * 全程整数运算：段向量为 (dx,dy)，长度用整数平方根，按比例截断前进 ——
 * 不产生浮点、跨平台结果一致。剩余速度不跨段结转（本项目自定，原版结转口径未核）。
 */
export function advanceAlongPath(unit: Unit): void {
  let budget = unit.speed
  while (budget > 0 && unit.pathIndex < unit.path.length) {
    const waypoint = unit.path[unit.pathIndex]!
    const targetX = waypoint.x * ONE + (ONE >> 1)
    const targetY = waypoint.y * ONE + (ONE >> 1)
    const dx = targetX - unit.x
    const dy = targetY - unit.y
    if (dx === 0 && dy === 0) {
      unit.pathIndex++
      continue
    }
    // 朝向先转：目标角 = 段方向的中心角（渐进，不瞬变）
    unit.facing = rotateToward(unit.facing, facingFromDir(dirFromDelta(dx, dy)), unit.turnRate)

    const dist = fixedLength(dx, dy)
    const advance = Math.min(budget, dist)
    const moveX = advance === dist ? dx : Math.trunc((dx * advance) / dist)
    const moveY = advance === dist ? dy : Math.trunc((dy * advance) / dist)
    unit.x += moveX
    unit.y += moveY
    budget -= advance
    if (unit.x === targetX && unit.y === targetY) unit.pathIndex++
  }
  if (unit.pathIndex >= unit.path.length) {
    unit.path = []
    unit.pathIndex = 0
  }
}

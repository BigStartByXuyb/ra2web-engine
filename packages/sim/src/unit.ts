import { ONE } from './fixed.js'
import type { Cell } from './grid.js'

/** 单位：位置与推进全部定点整数。 */
export interface Unit {
  readonly id: number
  readonly owner: number
  /** 定点坐标（1 格 = ONE） */
  x: number
  y: number
  health: number
  /** 每 tick 推进的定点距离 */
  readonly speed: number
  /** 视野半径（格）；迷雾按它揭开 */
  readonly sight: number
  /** 剩余路径（格子），空表示无移动任务 */
  path: Cell[]
  pathIndex: number
}

export function createUnit(id: number, owner: number, cell: Cell, speed: number, health: number, sight: number): Unit {
  return {
    id,
    owner,
    x: cell.x * ONE + (ONE >> 1),
    y: cell.y * ONE + (ONE >> 1),
    health,
    speed,
    sight,
    path: [],
    pathIndex: 0,
  }
}

/** 单位中心所在的格子。 */
export function unitCell(unit: Unit): Cell {
  return { x: Math.trunc(unit.x / ONE), y: Math.trunc(unit.y / ONE) }
}

/**
 * 朝当前路径点推进一 tick。
 *
 * 关键：每 tick 只在一个轴上移动，且距离取"剩余距离"与"速度"的较小值 ——
 * 不产生浮点、不越过目标点，跨平台结果一致。
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
    const step = Math.min(budget, Math.abs(dx) + Math.abs(dy))
    // 按曼哈顿方向推进：先消 x 再消 y，顺序固定 → 可复现
    const stepX = Math.sign(dx) * Math.min(Math.abs(dx), step)
    unit.x += stepX
    const remaining = step - Math.abs(stepX)
    if (remaining > 0) unit.y += Math.sign(dy) * Math.min(Math.abs(dy), remaining)
    budget -= step
    if (unit.x === targetX && unit.y === targetY) unit.pathIndex++
  }
  if (unit.pathIndex >= unit.path.length) {
    unit.path = []
    unit.pathIndex = 0
  }
}

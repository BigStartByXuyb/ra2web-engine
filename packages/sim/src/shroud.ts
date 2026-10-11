import { ONE } from './fixed.js'
import type { Unit } from './unit.js'

/**
 * 战争迷雾（shroud）：**永久揭开**，一格被看到过就不再变黑。
 *
 * 判据（客户端 `Shroud`）：
 *
 * - 格子值是等级：`reset()` 填 0（全黑）、`revealAll()` 填 2；
 *   揭开时把 0/1 级写成 2（`setValueAround(center, radius, elevation, changed, 2, [0, 1])`），
 *   而把 2 写回 0 只发生在 `unrevealAround` 与临时揭开（间谍卫星/超时空那类效果）上 ——
 *   常规探索是单向的。
 * - 范围是**欧氏距离**：客户端判据 `(m-sx)² + (y-sy)² <= radius² + 1`，半径取单位的
 *   `Sight`（客户端 `Math.min(MAX_SIGHT, ini.getNumber("Sight", 1))`，`MAX_SIGHT = 11`）。
 *
 * "这一格现在有没有被看到"另存一份：地形一旦揭开就永久可见，但**敌方单位**只有在自己
 * 与盟友的当前视野内才画出来。
 *
 * 迷雾按**玩家**各存一份（每个玩家只知道自己看到过什么）。
 */

export const SHROUD_UNEXPLORED = 0
export const SHROUD_EXPLORED = 2
export const MAX_SIGHT = 11
/** 客户端 `Sight` 缺省值 */
export const DEFAULT_SIGHT = 1

export interface Shroud {
  readonly width: number
  readonly height: number
  readonly ownerCount: number
  /** 每个玩家一份：0 = 没探索过，2 = 探索过 */
  readonly explored: readonly Uint8Array[]
  /** 每个玩家一份：本 tick 在视野内 */
  readonly visible: readonly Uint8Array[]
}

export function createShroud(ownerCount: number, width: number, height: number): Shroud {
  const owners = Math.max(1, ownerCount)
  const explored: Uint8Array[] = []
  const visible: Uint8Array[] = []
  for (let owner = 0; owner < owners; owner++) {
    explored.push(new Uint8Array(width * height))
    visible.push(new Uint8Array(width * height))
  }
  return { width, height, ownerCount: owners, explored, visible }
}

/** 每个 tick 重算一次视野：先清空"当前可见"，再按各单位视野揭开。 */
export function updateShroud(shroud: Shroud, units: readonly Unit[]): void {
  for (const cells of shroud.visible) cells.fill(0)
  for (const unit of units) {
    if (unit.health <= 0) continue
    const owner = shroud.explored[unit.owner]
    const visible = shroud.visible[unit.owner]
    if (!owner || !visible) continue
    const centerX = Math.trunc(unit.x / ONE)
    const centerY = Math.trunc(unit.y / ONE)
    const sight = Math.min(MAX_SIGHT, Math.max(0, unit.sight))
    const limit = sight * sight + 1
    for (let dy = -sight; dy <= sight; dy++) {
      const y = centerY + dy
      if (y < 0 || y >= shroud.height) continue
      for (let dx = -sight; dx <= sight; dx++) {
        const x = centerX + dx
        if (x < 0 || x >= shroud.width) continue
        if (dx * dx + dy * dy > limit) continue
        const index = y * shroud.width + x
        owner[index] = SHROUD_EXPLORED
        visible[index] = 1
      }
    }
  }
}

export function isExplored(shroud: Shroud, owner: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= shroud.width || y >= shroud.height) return false
  return shroud.explored[owner]?.[y * shroud.width + x] === SHROUD_EXPLORED
}

export function isVisible(shroud: Shroud, owner: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= shroud.width || y >= shroud.height) return false
  return shroud.visible[owner]?.[y * shroud.width + x] === 1
}

/** 已探索格数（界面核对用）。 */
export function exploredCount(shroud: Shroud, owner: number): number {
  let total = 0
  for (const value of shroud.explored[owner] ?? []) if (value === SHROUD_EXPLORED) total++
  return total
}

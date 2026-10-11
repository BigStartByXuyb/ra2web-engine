/**
 * 地图格子：逐格"可走 / 不可走"，外加**边判定** —— 相邻格之间的高度差会挡住这一步。
 *
 * 边判定的方向次序是固定的四方向：0 东(+x)、1 南(+y)、2 西(−x)、3 北(−y)。
 * `blockedSteps` 的长度是 `width × height × 4`，下标 = `(y × width + x) × 4 + 方向`，
 * 1 表示"从这一格朝这个方向不能走"。它是静态数据，不进世界状态哈希。
 */

/** 四方向次序：东、南、西、北。 */
export const CARDINAL_DIRECTIONS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
] as const

export const STEP_DIRECTION_COUNT = CARDINAL_DIRECTIONS.length

export interface Grid {
  readonly width: number
  readonly height: number
  /** 不可通行格子索引，查询用 */
  readonly blocked: ReadonlySet<number>
  /** 同一批不可通行格的升序索引，用于状态哈希（保证与创建顺序无关） */
  readonly blockedIndices: readonly number[]
  /** 相邻格之间的阻挡（长度 width×height×4）；没有边判定时长度为 0 */
  readonly blockedSteps: Uint8Array
}

export function createGrid(
  width: number,
  height: number,
  blockedCells: readonly Cell[],
  blockedSteps: Uint8Array = new Uint8Array(0),
): Grid {
  const blockedIndices = [...new Set(blockedCells.map((cell) => cell.y * width + cell.x))].sort((a, b) => a - b)
  return { width, height, blocked: new Set(blockedIndices), blockedIndices, blockedSteps }
}

export interface Cell {
  readonly x: number
  readonly y: number
}

export function cellIndex(grid: Grid, x: number, y: number): number {
  return y * grid.width + x
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height
}

export function isBlocked(grid: Grid, x: number, y: number): boolean {
  if (!inBounds(grid, x, y)) return true
  return grid.blocked.has(cellIndex(grid, x, y))
}

/** 从 (x, y) 朝四方向之一能否迈出这一步；方向下标见 `CARDINAL_DIRECTIONS`。 */
export function canStep(grid: Grid, x: number, y: number, direction: number): boolean {
  const nextX = x + CARDINAL_DIRECTIONS[direction]!.x
  const nextY = y + CARDINAL_DIRECTIONS[direction]!.y
  if (!inBounds(grid, nextX, nextY)) return false
  if (grid.blockedSteps.length === 0) return true
  return grid.blockedSteps[(y * grid.width + x) * STEP_DIRECTION_COUNT + direction] === 0
}

/** 地图格子：本文档阶段只需要"可走 / 不可走"，地块高度、地形伤害留给后续阶段。 */

export interface Grid {
  readonly width: number
  readonly height: number
  /** 不可通行格子索引，查询用 */
  readonly blocked: ReadonlySet<number>
  /** 同一批不可通行格的升序索引，用于状态哈希（保证与创建顺序无关） */
  readonly blockedIndices: readonly number[]
}

export function createGrid(width: number, height: number, blockedCells: readonly Cell[]): Grid {
  const blockedIndices = [...new Set(blockedCells.map((cell) => cell.y * width + cell.x))].sort((a, b) => a - b)
  return { width, height, blocked: new Set(blockedIndices), blockedIndices }
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

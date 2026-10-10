import { isBlocked, type Cell, type Grid } from './grid.js'

/**
 * A* 寻路，只走四方向。
 *
 * 确定性要求：开放集合的取出顺序必须稳定 —— 以 (f, h, y, x) 四级比较取最小，
 * 不用堆的插入顺序做决胜，避免实现差异影响结果。
 */

interface Node {
  readonly index: number
  readonly x: number
  readonly y: number
  g: number
  f: number
  parent: number
}

const DIRECTION_ORDER: readonly Cell[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
]

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by)
}

function isBetter(candidate: Node, current: Node): boolean {
  if (candidate.f !== current.f) return candidate.f < current.f
  if (candidate.g !== current.g) return candidate.g > current.g
  if (candidate.y !== current.y) return candidate.y < current.y
  return candidate.x < current.x
}

/** 返回从起点（不含）到终点（含）的格子序列；不可达时返回 undefined。 */
export function findPath(grid: Grid, from: Cell, to: Cell): readonly Cell[] | undefined {
  if (isBlocked(grid, to.x, to.y)) return undefined
  const nodes = new Map<number, Node>()
  const open = new Map<number, Node>()
  const closed = new Set<number>()

  const startIndex = from.y * grid.width + from.x
  const start: Node = {
    index: startIndex,
    x: from.x,
    y: from.y,
    g: 0,
    f: heuristic(from.x, from.y, to.x, to.y),
    parent: -1,
  }
  nodes.set(startIndex, start)
  open.set(startIndex, start)

  while (open.size > 0) {
    let current: Node | undefined
    for (const node of open.values()) {
      if (current === undefined || isBetter(node, current)) current = node
    }
    if (current === undefined) break
    if (current.x === to.x && current.y === to.y) return reconstruct(nodes, current)

    open.delete(current.index)
    closed.add(current.index)

    for (const direction of DIRECTION_ORDER) {
      const nx = current.x + direction.x
      const ny = current.y + direction.y
      if (isBlocked(grid, nx, ny)) continue
      const index = ny * grid.width + nx
      if (closed.has(index)) continue
      const g = current.g + 1
      const existing = nodes.get(index)
      if (existing && g >= existing.g) continue
      const node: Node = existing ?? { index, x: nx, y: ny, g, f: 0, parent: -1 }
      node.g = g
      node.f = g + heuristic(nx, ny, to.x, to.y)
      node.parent = current.index
      nodes.set(index, node)
      open.set(index, node)
    }
  }
  return undefined
}

function reconstruct(nodes: Map<number, Node>, end: Node): readonly Cell[] {
  const reversed: Cell[] = []
  let cursor: Node | undefined = end
  while (cursor && cursor.parent >= 0) {
    reversed.push({ x: cursor.x, y: cursor.y })
    cursor = nodes.get(cursor.parent)
  }
  return reversed.reverse()
}

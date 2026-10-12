import { DIRECTIONS } from './direction.js'
import { canStep, isBlocked, type Cell, type Grid } from './grid.js'

/**
 * A* 寻路，八方向（原版口径：路径就是一串方向步，见 docs/ENGINE-MAP.md「单位移动核心」）。
 *
 * 确定性要求：开放集合的取出顺序必须稳定 —— 以 (f, h, y, x) 四级比较取最小，
 * 不用堆的插入顺序做决胜，避免实现差异影响结果。
 *
 * 成本口径（本项目自定，整数）：直行 256，斜行 362（= ⌈256√2⌉，斜行一格的欧氏长度，
 * 与原版 lepton 步进表 0x851ac0 的 (±256,±256) 一致）。
 * 启发式用同口径的 octile 距离：`256×max(dx,dy) + 106×min(dx,dy)`（106 = 362−256）。
 *
 * 防切角（本项目自定）：斜步要求两个正交邻格都可走。原版推进核心里只见到对目标格的
 * 单格判定（`0x4a2670`），未见附加角检查；这里加上是为了不沿崖角/墙角穿越，
 * 待在二进制里核到原版寻路函数后再对齐。
 */

/** 直行一格的成本（256 lepton = 1 格） */
const COST_STRAIGHT = 256

/** 斜行一格的成本（⌈256√2⌉） */
const COST_DIAGONAL = 362

interface Node {
  readonly index: number
  readonly x: number
  readonly y: number
  g: number
  f: number
  parent: number
}

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx)
  const dy = Math.abs(ay - by)
  return COST_STRAIGHT * Math.max(dx, dy) + (COST_DIAGONAL - COST_STRAIGHT) * Math.min(dx, dy)
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

    for (let direction = 0; direction < DIRECTIONS.length; direction++) {
      const step = DIRECTIONS[direction]!
      const nx = current.x + step.x
      const ny = current.y + step.y
      if (isBlocked(grid, nx, ny)) continue
      if (!canEnterCell(grid, current.x, current.y, nx, ny)) continue
      const index = ny * grid.width + nx
      if (closed.has(index)) continue
      const diagonal = step.x !== 0 && step.y !== 0
      const g = current.g + (diagonal ? COST_DIAGONAL : COST_STRAIGHT)
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

/**
 * 斜步要求：两个正交邻格可走（防切角，本项目自定）且这两条正交边不挡
 * （悬崖高度差数据记在四方向边上，斜步不得绕过它）；直步按边判定放行。
 */
function canEnterCell(grid: Grid, x: number, y: number, nx: number, ny: number): boolean {
  const dx = nx - x
  const dy = ny - y
  if (dx === 0 || dy === 0) {
    const index = dx === 1 ? 0 : dx === -1 ? 2 : dy === 1 ? 1 : 3
    return canStep(grid, x, y, index)
  }
  const horizontal = dx > 0 ? 0 : 2
  const vertical = dy > 0 ? 1 : 3
  return (
    !isBlocked(grid, nx, y) &&
    !isBlocked(grid, x, ny) &&
    canStep(grid, x, y, horizontal) &&
    canStep(grid, x, y, vertical)
  )
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

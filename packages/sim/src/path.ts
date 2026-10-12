import { DIRECTIONS } from './direction.js'
import { canStep, isBlocked, type Cell, type Grid } from './grid.js'

/**
 * A* 寻路，八方向（原版口径：路径就是一串方向步，见 docs/ENGINE-MAP.md「寻路函数定位」）。
 *
 * 确定性要求：开放集合的取出顺序必须稳定 —— 以 (f, g, y, x) 四级比较取最小，
 * 不用堆的插入顺序做决胜，避免实现差异影响结果。
 *
 * 成本口径：直行 256，斜行 362（= ⌈256√2⌉，斜行一格的欧氏长度，与原版 lepton
 * 步进表 0x851ac0 的 (±256,±256) 一致）。启发式用同口径的 octile 距离：
 * `256×max(dx,dy) + 106×min(dx,dy)`（106 = 362−256）。
 *
 * 斜步切角 = **软惩罚 ×10**（原版口径：fn-427110 对切角斜步乘常数 0x79c4c8=10；
 * 2026-10-12 总工裁定照原版，切角是可达性行为不是路径偏好——原版斜缝可以穿，
 * 硬禁止会让可达性与原版不一致）。斜步的**高度边**（blockedSteps 正交两条）
 * 保持硬检查：高度是物理遮挡而非可走性，其原版口径归 Z 轴高度链核对。
 */

/** 直行一格的成本（256 lepton = 1 格） */
const COST_STRAIGHT = 256

/** 斜行一格的成本（⌈256√2⌉） */
const COST_DIAGONAL = 362

/** 切角斜步的代价乘数（原版 fn-427110 的 0x79c4c8 常数） */
const DIAGONAL_CORNER_PENALTY = 10

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

/** 返回从起点（不含）到终点（含）的格子序列；不可达时返回 undefined。
 *  `extraBlocked` 里的格按不可通行处理（单位占格用，见 `world.ts` 的碰撞）。 */
export function findPath(
  grid: Grid,
  from: Cell,
  to: Cell,
  extraBlocked?: { has(key: number): boolean },
): readonly Cell[] | undefined {
  if (isBlocked(grid, to.x, to.y)) return undefined
  if (extraBlocked?.has(to.y * grid.width + to.x)) return undefined
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
      if (extraBlocked?.has(ny * grid.width + nx)) continue
      const diagonal = step.x !== 0 && step.y !== 0
      const index = ny * grid.width + nx
      if (closed.has(index)) continue
      let cost: number
      if (diagonal) {
        // 斜步：高度边硬检查（物理遮挡），可走性软惩罚（原版切角 ×10）
        const multiplier = diagonalStepMultiplier(grid, current.x, current.y, nx, ny)
        if (multiplier === undefined) continue
        cost = COST_DIAGONAL * multiplier
      } else {
        const edgeIndex = step.x === 1 ? 0 : step.x === -1 ? 2 : step.y === 1 ? 1 : 3
        if (!canStep(grid, current.x, current.y, edgeIndex)) continue
        cost = COST_STRAIGHT
      }
      const existing = nodes.get(index)
      if (existing && existing.g >= current.g + cost) continue
      const node: Node = existing ?? { index, x: nx, y: ny, g: current.g + cost, f: 0, parent: -1 }
      node.g = current.g + cost
      node.f = node.g + heuristic(nx, ny, to.x, to.y)
      node.parent = current.index
      nodes.set(index, node)
      open.set(index, node)
    }
  }
  return undefined
}

/**
 * 斜步的三态判定：undefined = 高度边挡住（不可走）；1 = 双正交邻格常态（原价）；
 * 10 = 有正交邻格被堵（切角罚价，原版 fn-427110 的 ×10，见文件头）。
 */
function diagonalStepMultiplier(grid: Grid, x: number, y: number, nx: number, ny: number): number | undefined {
  const dx = nx - x
  const dy = ny - y
  const horizontal = dx > 0 ? 0 : 2
  const vertical = dy > 0 ? 1 : 3
  if (!canStep(grid, x, y, horizontal) || !canStep(grid, x, y, vertical)) return undefined
  return isBlocked(grid, nx, y) || isBlocked(grid, x, ny) ? DIAGONAL_CORNER_PENALTY : 1
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

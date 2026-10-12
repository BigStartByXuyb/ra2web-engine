import { cellToScreen, type IsoView, type ScreenPoint } from './iso.js'

/**
 * 3D 地形网格：把一格一格的地块抬成实体几何。
 *
 * 高度源是地图格的 `z`（乘每级像素 `zStep`）。**抬高必须与崖壁同时生成** ——
 * 任何 `|Δz| ≥ 1` 的相邻边都补一块竖直面，把缝填死；只抬高不补面，就会在
 * "这一带没有悬崖图块"的地方漏出竖向空洞（`docs/ENGINE-MAP.md` 那条红线的正解。
 * 缝由几何补上，不依赖美术有没有画崖面）。
 *
 * 这里只算几何与共边的贴图坐标；崖壁用什么贴图是绘制层的事。
 */

export interface UvPoint {
  readonly u: number
  readonly v: number
}

/** 地形里的一个面。四个角按 0-1-2 / 0-2-3 摆成两个三角形。 */
export interface TerrainFace {
  readonly kind: 'top' | 'wall'
  readonly cellX: number
  readonly cellY: number
  /** 世界坐标（像素）。顶面顺序是 上/右/下/左；崖壁顺序是 上左/上右/下右/下左 */
  readonly corners: readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint]
  /** 顶面：该格贴图的菱形四角；崖壁：共边两端的贴图坐标（上边两端），顺序与 corners 前两个对应 */
  readonly uvs: readonly [UvPoint, UvPoint, UvPoint, UvPoint]
}

export interface TerrainCell {
  readonly cellX: number
  readonly cellY: number
}

export interface TerrainMeshInput {
  readonly view: IsoView
  /** 一级高度折多少像素 */
  readonly zStep: number
  readonly cells: readonly TerrainCell[]
  /** 取某格的高度级数；地图外返回 undefined，按"与邻格同高"处理 */
  readonly levelAt: (cellX: number, cellY: number) => number | undefined
}

/**
 * 坡道的四角高度表：`rampType` → 四角级数。第 0 行是全 0（不是坡道）。
 *
 * 取自参考实现 `ra2web` 0.87.1 的 `rampHeights`，逐项照抄，不做归并。
 * 四角顺序由插值式反解得到：`(0,0) = r[1]`、`(1,0) = r[2]`、`(0,1) = r[0]`、`(1,1) = r[3]`。
 * 这是**参考实现**的口径，不是权威；等 GAME.EXE 里那处读出来再校。
 */
export const RAMP_HEIGHTS: readonly (readonly number[])[] = [
  [0, 0, 0, 0],
  [0, 0, 1, 1],
  [1, 0, 0, 1],
  [1, 1, 0, 0],
  [0, 1, 1, 0],
  [0, 0, 0, 1],
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [1, 0, 1, 1],
  [1, 1, 0, 1],
  [1, 1, 1, 0],
  [0, 1, 1, 1],
  [1, 0, 1, 2],
  [2, 1, 0, 1],
  [1, 2, 1, 0],
  [0, 1, 2, 1],
  [1, 0, 1, 0],
  [0, 1, 0, 1],
  [1, 0, 1, 0],
  [0, 1, 0, 1],
]

/**
 * 坡道在格内的双线性插值高度（单位：级）。`xFrac` / `yFrac` 是格内归一化坐标（0..1）。
 *
 * 越界的 `rampType`（含 0）一律返回 0：不是坡道就没有额外高度，不做别的猜测。
 */
export function interpolateRampHeight(xFrac: number, yFrac: number, rampType: number): number {
  const corners = RAMP_HEIGHTS[rampType]
  if (!corners || corners.length < 4) return 0
  const bottomRight = corners[3]!
  const topLeft = corners[1]!
  const bottomLeft = corners[0]!
  const topRight = corners[2]!
  return (
    topLeft * (1 - xFrac) * (1 - yFrac) +
    topRight * xFrac * (1 - yFrac) +
    bottomLeft * (1 - xFrac) * yFrac +
    bottomRight * xFrac * yFrac
  )
}

/** 贴图上菱形四个角的位置：上、右、下、左。 */
const DIAMOND_UV: readonly [UvPoint, UvPoint, UvPoint, UvPoint] = [
  { u: 0.5, v: 0 },
  { u: 1, v: 0.5 },
  { u: 0.5, v: 1 },
  { u: 0, v: 0.5 },
]

/**
 * 四条菱形边对应的邻格，与角点序号对齐：边 `i` 是 `corners[i] → corners[i+1]`。
 *
 * 上→右那条边在 `y = cellY − 0.5` 上，对面是 `−y` 侧；右→下在 `x = cellX + 0.5`，对面是 `+x` 侧。
 */
const EDGE_NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
]

export function buildTerrainMesh(input: TerrainMeshInput): readonly TerrainFace[] {
  const { view, zStep, cells, levelAt } = input
  const faces: TerrainFace[] = []

  for (const cell of cells) {
    const level = levelAt(cell.cellX, cell.cellY) ?? 0
    const corners = cellCorners(view, cell.cellX, cell.cellY, level * zStep)
    faces.push({ kind: 'top', cellX: cell.cellX, cellY: cell.cellY, corners, uvs: DIAMOND_UV })

    for (const [index, [dx, dy]] of EDGE_NEIGHBOURS.entries()) {
      const neighbour = levelAt(cell.cellX + dx, cell.cellY + dy)
      // 地图外（undefined）当作同高：边上没有落差就不该有面
      if (neighbour === undefined || neighbour >= level) continue
      const from = index
      const to = (index + 1) % 4
      const drop = (level - neighbour) * zStep
      faces.push({
        kind: 'wall',
        cellX: cell.cellX,
        cellY: cell.cellY,
        // 上边就是高的一侧那条共边，与相邻顶面**完全重合** —— 这是"不留缝"的保证
        corners: [corners[from]!, corners[to]!, lower(corners[to]!, drop), lower(corners[from]!, drop)],
        uvs: [DIAMOND_UV[from]!, DIAMOND_UV[to]!, DIAMOND_UV[from]!, DIAMOND_UV[to]!],
      })
    }
  }
  return faces
}

/** 一格的四个角（上、右、下、左），按高度抬起来。 */
function cellCorners(
  view: IsoView,
  cellX: number,
  cellY: number,
  lift: number,
): readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] {
  return [
    raised(cellToScreen(view, { x: cellX - 0.5, y: cellY - 0.5 }), lift),
    raised(cellToScreen(view, { x: cellX + 0.5, y: cellY - 0.5 }), lift),
    raised(cellToScreen(view, { x: cellX + 0.5, y: cellY + 0.5 }), lift),
    raised(cellToScreen(view, { x: cellX - 0.5, y: cellY + 0.5 }), lift),
  ]
}

/** 抬高就是屏幕 y 变小（等距投影里 `y` 减去高度）。 */
function raised(point: ScreenPoint, lift: number): ScreenPoint {
  return { x: point.x, y: point.y - lift }
}

/** 往下落 `amount` 像素：屏幕 y 变大，落到低的那一格的面上。 */
function lower(point: ScreenPoint, amount: number): ScreenPoint {
  return { x: point.x, y: point.y + amount }
}

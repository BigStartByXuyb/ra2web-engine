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

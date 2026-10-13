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
  /**
   * 每角 z（像素），顺序与 corners 对应。非坡格顶面四角同高、崖壁上两角同高；
   * 坡格顶面是斜面（四角可各不同），崖壁可为梯形（上棱两端不等高）。
   * 逐角 z 是**权威值**：消费方不要再从 corners 的 y 差反推落差。
   */
  readonly zs: readonly [number, number, number, number]
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
  /**
   * 取某格的坡道类型（TMP 子块 `rampType` 字节；0/缺省 = 非坡道）。地貌线任务 2 加法扩展：
   * 坡格四角高 = 格级 + `RAMP_HEIGHTS` 角增量（角序映射与 `interpolateRampHeight` 同一口径）。
   * 缺省（或以返回 0）时输出与扩展前完全一致。
   */
  readonly rampTypeAt?: ((cellX: number, cellY: number) => number) | undefined
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

/** 四角 z 的角序映射（与 `interpolateRampHeight` 同一口径）：上(0,0)=r[1]、右(1,0)=r[2]、下(1,1)=r[3]、左(0,1)=r[0]。 */
const RAMP_CORNER_INDEX: readonly [number, number, number, number] = [1, 2, 3, 0]

export function buildTerrainMesh(input: TerrainMeshInput): readonly TerrainFace[] {
  const { view, zStep, cells, levelAt } = input
  const rampTypeAt = input.rampTypeAt ?? ((): number => 0)
  const faces: TerrainFace[] = []
  /** 某格某角的抬升像素 = (格级 + 坡道角增量) × zStep。 */
  const cornerLift = (cellX: number, cellY: number, corner: number): number => {
    const level = levelAt(cellX, cellY) ?? 0
    const ramp = rampTypeAt(cellX, cellY)
    const extra = ramp ? (RAMP_HEIGHTS[ramp]?.[RAMP_CORNER_INDEX[corner]!] ?? 0) : 0
    return (level + extra) * zStep
  }
  /** 一格四角的世界坐标（未抬升的基准点）。 */
  const baseCorners = (cellX: number, cellY: number): readonly ScreenPoint[] => [
    cellToScreen(view, { x: cellX - 0.5, y: cellY - 0.5 }),
    cellToScreen(view, { x: cellX + 0.5, y: cellY - 0.5 }),
    cellToScreen(view, { x: cellX + 0.5, y: cellY + 0.5 }),
    cellToScreen(view, { x: cellX - 0.5, y: cellY + 0.5 }),
  ]

  for (const cell of cells) {
    const base = baseCorners(cell.cellX, cell.cellY)
    const lifts: [number, number, number, number] = [
      cornerLift(cell.cellX, cell.cellY, 0),
      cornerLift(cell.cellX, cell.cellY, 1),
      cornerLift(cell.cellX, cell.cellY, 2),
      cornerLift(cell.cellX, cell.cellY, 3),
    ]
    const corners: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] = [
      raised(base[0]!, lifts[0]),
      raised(base[1]!, lifts[1]),
      raised(base[2]!, lifts[2]),
      raised(base[3]!, lifts[3]),
    ]
    faces.push({ kind: 'top', cellX: cell.cellX, cellY: cell.cellY, corners, uvs: DIAMOND_UV, zs: lifts })

    for (const [index, [dx, dy]] of EDGE_NEIGHBOURS.entries()) {
      const neighbour = levelAt(cell.cellX + dx, cell.cellY + dy)
      // 地图外（undefined）当作同高：边上没有落差就不该有面
      if (neighbour === undefined) continue
      const to = (index + 1) % 4
      // 邻格在该共边上的两角（世界点相同、角序错位）：本角 i ↔ 邻角 (i+3)%4，本角 i+1 ↔ 邻角 (i+2)%4
      const myA = lifts[index]!
      const myB = lifts[to]!
      const nearA = cornerLift(cell.cellX + dx, cell.cellY + dy, (index + 3) % 4)
      const nearB = cornerLift(cell.cellX + dx, cell.cellY + dy, (index + 2) % 4)
      // 本角不高于邻角就没有面（非坡格退化为原判据：整格低于邻格即无墙）
      if (myA <= nearA && myB <= nearB) continue
      faces.push({
        kind: 'wall',
        cellX: cell.cellX,
        cellY: cell.cellY,
        // 上边就是高的一侧那条共边，与相邻顶面**完全重合** —— 这是"不留缝"的保证
        corners: [
          raised(base[index]!, myA),
          raised(base[to]!, myB),
          raised(base[to]!, nearB),
          raised(base[index]!, nearA),
        ],
        uvs: [DIAMOND_UV[index]!, DIAMOND_UV[to]!, DIAMOND_UV[index]!, DIAMOND_UV[to]!],
        zs: [myA, myB, nearB, nearA],
      })
    }
  }
  return faces
}


/** 抬高就是屏幕 y 变小（等距投影里 `y` 减去高度）。 */
function raised(point: ScreenPoint, lift: number): ScreenPoint {
  return { x: point.x, y: point.y - lift }
}


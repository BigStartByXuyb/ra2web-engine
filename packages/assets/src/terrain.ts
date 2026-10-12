import type { MapFile } from '@ra2web/formats'
import { landTypeOfTerrainType, type LandTypeName } from './land.js'
import type { TheaterAssets } from './theater.js'

/**
 * 通行性：逐格取 TMP 子块的 `terrainType` → 地块类型（LandType），
 * 再按该类型对**移动方式**的通行系数判定（系数 0 = 不能进入）。
 *
 * 这条链与客户端一致（`TileCollection` 建格时算 `landType`、
 * `getPassableSpeed` 查 `getSpeedModifier`），系数表由 `@ra2web/rules` 从 rules.ini 读。
 *
 * 早先按 theater INI 的**地块集锚点**（`WaterSet=21`、`CliffSet=10`…）分类的近似做法已作废：
 * 它只能回答"这块地在不在水/悬崖集里"，答不了"哪种移动方式能进"，
 * 也会把属于悬崖集的**斜坡**误判成不可通行。
 *
 * 高度差另算：相邻格 |Δz| ≥ 2 挡住这一步（见 `heightBlocksStep`），由调用方接进寻路的边判定。
 */

export interface PassabilityRequest {
  /** 移动方式（履带车是 `Track`）；一次判定只按一种算 */
  readonly speedType: string
  /** 地块类型 → 该移动方式的通行系数；0 表示不能进入 */
  readonly speedFactor: (landType: LandTypeName) => number
}

export interface Passability {
  /** 不可进入的格子（地图范围内） */
  readonly blocked: readonly { readonly x: number; readonly y: number }[]
  /** 地图里出现过、但映射表不认识的 TMP terrainType（原版遇到会报错） */
  readonly unknownTerrainTypes: readonly number[]
  /** 各地块类型占了多少格，便于核对判定结果 */
  readonly landTypeCounts: ReadonlyMap<LandTypeName, number>
  /**
   * 取不到地块图形的格子：本机资产里没有这些地块集的图形。
   * 与"不可通行"无关 —— 原版客户端在同样的格上会抛 `TileNum not found` / `SubTile not found`，
   * 所以这里既不算可通行也不算不可通行，只如实报数，由调用方决定是否开这局。
   */
  readonly missingArt: MissingArt
}

export interface MissingArt {
  readonly cells: number
  /** 地块集名 → 缺图格数（地块号超出剧场地块表时记 {@link OUT_OF_RANGE_TILE_SET}） */
  readonly bySet: ReadonlyMap<string, number>
}

export function buildPassability(
  map: MapFile,
  theater: TheaterAssets | undefined,
  request: PassabilityRequest,
): Passability {
  const blocked: { x: number; y: number }[] = []
  const unknown = new Set<number>()
  const missingBySet = new Map<string, number>()
  const landTypeCounts = new Map<LandTypeName, number>()
  let missingCells = 0
  for (const cell of map.cells) {
    if (cell.cellX < 0 || cell.cellY < 0 || cell.cellX >= map.width || cell.cellY >= map.height) continue
    const subTile = theater?.loadTile(cell.tileIndex)?.subTiles[cell.subTile]
    if (!subTile) {
      missingCells++
      const setName = setNameOf(theater, cell.tileIndex)
      missingBySet.set(setName, (missingBySet.get(setName) ?? 0) + 1)
      continue
    }
    const terrainType = subTile.terrainType
    const landType = landTypeOfTerrainType(terrainType)
    if (!landType) {
      unknown.add(terrainType)
      blocked.push({ x: cell.cellX, y: cell.cellY })
      continue
    }
    landTypeCounts.set(landType, (landTypeCounts.get(landType) ?? 0) + 1)
    if (request.speedFactor(landType) === 0) blocked.push({ x: cell.cellX, y: cell.cellY })
  }
  return {
    blocked,
    unknownTerrainTypes: [...unknown].sort((left, right) => left - right),
    landTypeCounts,
    missingArt: { cells: missingCells, bySet: missingBySet },
  }
}

/** 地块号超出剧场地块表时的记号，用于把"越界"和"这一集没图形"分开报。 */
export const OUT_OF_RANGE_TILE_SET = '地块号超出剧场地块表'

/** 这个地块号属于哪个地块集；越界或装不上剧场时给出记号，不猜。 */
function setNameOf(theater: TheaterAssets | undefined, tileIndex: number): string {
  const tile = theater?.ini.tiles[tileIndex]
  if (!tile) return OUT_OF_RANGE_TILE_SET
  return theater?.ini.sets[tile.setIndex]?.name ?? OUT_OF_RANGE_TILE_SET
}

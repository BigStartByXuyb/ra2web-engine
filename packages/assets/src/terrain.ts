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
}

export function buildPassability(
  map: MapFile,
  theater: TheaterAssets | undefined,
  request: PassabilityRequest,
): Passability {
  const blocked: { x: number; y: number }[] = []
  const unknown = new Set<number>()
  const landTypeCounts = new Map<LandTypeName, number>()
  for (const cell of map.cells) {
    if (cell.cellX < 0 || cell.cellY < 0 || cell.cellX >= map.width || cell.cellY >= map.height) continue
    const subTile = theater?.loadTile(cell.tileIndex)?.subTiles[cell.subTile]
    if (!subTile) {
      unknown.add(NO_TERRAIN_DATA)
      blocked.push({ x: cell.cellX, y: cell.cellY })
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
  return { blocked, unknownTerrainTypes: [...unknown].sort((left, right) => left - right), landTypeCounts }
}

/** 拿不到 TMP 子块（没有剧场美术）时的记号：按不可通行处理。 */
export const NO_TERRAIN_DATA = -1

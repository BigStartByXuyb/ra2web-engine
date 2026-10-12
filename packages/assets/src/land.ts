/**
 * TMP 子块的 `terrainType` 字节 → 地块类型（LandType）。
 *
 * 这张表照抄客户端 `getLandType` 的映射（`mZ`），一共 12 条：
 * `Default→Clear`、`Clear→Clear`、`Tunnel→Cliff`、`Railroad→Railroad`、`Rock1/Rock2→Rock`、
 * `Water→Water`、`Shore→Beach`、`Pavement→Road`、`Dirt→Road`、`Rough→Rough`、`Cliff→Cliff`。
 *
 * terrainType 的编号本身来自客户端的枚举：0 Default、5 Tunnel、6 Railroad、7 Rock1、8 Rock2、
 * 9 Water、10 Shore、11 Pavement、12 Dirt、13 Clear、14 Rough、15 Cliff；
 * **1..4 是枚举里没有名字的槽位，映射表里也没有** —— 客户端遇到就抛
 * `Unknown terrain type`，这里如实返回 undefined 并记录下来，不猜。
 *
 * 判定依据：客户端 `TileCollection` 建格时 `const w = y.terrainType; landType: uu(w)`，
 * 其中 y 是 TMP 子块、w 必须能在 `mZ` 里查到，否则抛错。
 */

export type LandTypeName =
  'Clear' | 'Road' | 'Rock' | 'Beach' | 'Rough' | 'Railroad' | 'Weeds' | 'Water' | 'Wall' | 'Tiberium' | 'Cliff'

/** 全部地块类型名的稳定顺序（`landTypeByCell` 用它的下标做编码）。 */
export const LAND_TYPE_NAMES: readonly LandTypeName[] = [
  'Clear',
  'Road',
  'Rock',
  'Beach',
  'Rough',
  'Railroad',
  'Weeds',
  'Water',
  'Wall',
  'Tiberium',
  'Cliff',
]

const TERRAIN_TYPES: ReadonlyMap<number, LandTypeName> = new Map([
  [0, 'Clear'],
  [5, 'Cliff'],
  [6, 'Railroad'],
  [7, 'Rock'],
  [8, 'Rock'],
  [9, 'Water'],
  [10, 'Beach'],
  [11, 'Road'],
  [12, 'Road'],
  [13, 'Clear'],
  [14, 'Rough'],
  [15, 'Cliff'],
])

/** 映射表认识的全部 terrainType，便于核对地图只用了已知值。 */
export const KNOWN_TERRAIN_TYPES: readonly number[] = [...TERRAIN_TYPES.keys()].sort((left, right) => left - right)

export function landTypeOfTerrainType(terrainType: number): LandTypeName | undefined {
  return TERRAIN_TYPES.get(terrainType)
}

/**
 * 相邻格的**高度差**是否挡住这一步。
 *
 * 客户端 `movePositionHelper.isEligibleTile`：非桥时判据是 `Math.abs(a.z - b.z) < 2`，
 * 即**高度差 0 或 1 可以走，2 及以上不能走**。这里的 z 是地图记录里的 z 字节。
 */
export function heightBlocksStep(fromZ: number, toZ: number): boolean {
  return Math.abs(fromZ - toZ) >= 2
}

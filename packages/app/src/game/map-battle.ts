import {
  buildPassability,
  heightBlocksStep,
  openTheater,
  readLocalText,
  type LandTypeName,
  type MissingArt,
} from '@ra2web/assets'
import type { MapCell, MapFile } from '@ra2web/formats'
import { loadRules, readLandRules, speedFactor, type LandTypeRules, type SpeedType } from '@ra2web/rules'
import { CARDINAL_DIRECTIONS, STEP_DIRECTION_COUNT, type Cell } from '@ra2web/sim'

/**
 * 官方地图 → 战场：逐格按地块类型判定通行性，逐边按高度差判定能不能迈过去，
 * 再给双方找落脚点。
 *
 * 两条判据都来自客户端：
 *
 * - **逐格**：TMP 子块的 `terrainType` → 地块类型 → rules.ini 里该移动方式的通行系数，
 *   系数 0（含缺键）＝不能进入。见 `@ra2web/assets` 的 `buildPassability`。
 * - **逐边**：相邻格 `|Δz| ≥ 2` 挡住这一步（客户端 `isEligibleTile`），即只有高度差 0/1 能迈，
 *   悬崖边因此走不上去，而斜坡每格只升一级、可以正常上下。
 *
 * 单位类型只用 `rules.ini` 里必定存在的几种，避免地图决定兵种；本局的三种车都是履带，
 * 因此格网按 `Track` 判定。
 */

export interface MapBattleSpawn {
  readonly unitId: string
  readonly owner: number
  readonly cell: Cell
}

export interface MapBattleSetup {
  readonly width: number
  readonly height: number
  readonly blocked: readonly Cell[]
  /** 相邻格阻挡（长度 width×height×4），交给模拟内核做边判定 */
  readonly blockedSteps: Uint8Array
  readonly landTypeSummary: string
  readonly unknownTerrainTypes: readonly number[]
  /** 取不到地块图形的格数与地块集名；非 0 说明这局在这份资产上开不了 */
  readonly missingArt: MissingArt
  readonly spawns: readonly MapBattleSpawn[]
}

const PLAYER_UNITS = ['HTNK', 'HTNK', 'SMCV'] as const
const ENEMY_UNITS = ['MTNK', 'MTNK'] as const
const SPAWN_SPACING = 2
/** 本局出场单位都是履带车（rules.ini `SpeedType`），按它判定格网 */
const SPEED_TYPE: SpeedType = 'Track'

export function planMapBattle(archiveBytes: Uint8Array, map: MapFile): MapBattleSetup | undefined {
  const theater = map.theater ? openTheater(archiveBytes, map.theater) : undefined
  if (!theater) return undefined

  const rulesText = readLocalText(archiveBytes, 'rules.ini')
  if (!rulesText) return undefined
  const land = readLandRules(loadRules([{ name: 'local.mix/rules.ini', text: rulesText }]))
  const passability = buildPassability(map, theater, {
    speedType: SPEED_TYPE,
    speedFactor: (landType: LandTypeName) => speedFactor(land, landType, SPEED_TYPE),
  })

  // 格空间宽高：原版的格是 512×512 数组里一块斜置区域，不能拿 map.width/height 当格边界
  const gridWidth = map.cellBounds.right
  const gridHeight = map.cellBounds.bottom
  const blockedCells = new Set<number>()
  const passable: Cell[] = []
  for (const cell of passability.blocked) {
    blockedCells.add(cell.y * gridWidth + cell.x)
  }
  for (const cell of map.cells) {
    if (cell.cellX < 0 || cell.cellY < 0 || cell.cellX >= gridWidth || cell.cellY >= gridHeight) continue
    const index = cell.cellY * gridWidth + cell.cellX
    if (blockedCells.has(index)) continue
    if (!passable.some((candidate) => candidate.y * gridWidth + candidate.x === index)) {
      passable.push({ x: cell.cellX, y: cell.cellY })
    }
  }
  passable.sort((left, right) => left.x + left.y - (right.x + right.y))

  const blocked: Cell[] = [...blockedCells].map((index) => ({
    x: index % gridWidth,
    y: Math.floor(index / gridWidth),
  }))
  const spawns = pickSpawns(passable)

  return {
    width: gridWidth,
    height: gridHeight,
    blocked,
    blockedSteps: buildBlockedSteps(map),
    landTypeSummary: summarizeLandTypes(passability.landTypeCounts, land, SPEED_TYPE),
    unknownTerrainTypes: passability.unknownTerrainTypes,
    missingArt: passability.missingArt,
    spawns,
  }
}

/** 相邻格高度差 ≥ 2 的边标成"不能走"：正反两个方向各自记一次。 */
function buildBlockedSteps(map: MapFile): Uint8Array {
  const gridWidth = map.cellBounds.right
  const gridHeight = map.cellBounds.bottom
  const zByIndex = new Map<number, number>()
  for (const cell of map.cells) {
    if (cell.cellX < 0 || cell.cellY < 0 || cell.cellX >= gridWidth || cell.cellY >= gridHeight) continue
    zByIndex.set(cell.cellY * gridWidth + cell.cellX, cell.z)
  }
  const blockedSteps = new Uint8Array(gridWidth * gridHeight * STEP_DIRECTION_COUNT)
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const z = zByIndex.get(y * gridWidth + x)
      if (z === undefined) continue
      CARDINAL_DIRECTIONS.forEach((direction, index) => {
        const neighbour = zByIndex.get((y + direction.y) * gridWidth + (x + direction.x))
        if (neighbour === undefined) return
        if (heightBlocksStep(z, neighbour)) blockedSteps[(y * gridWidth + x) * STEP_DIRECTION_COUNT + index] = 1
      })
    }
  }
  return blockedSteps
}

/** 格子数最多的几种地块类型，界面用来说明"这张图为什么不能走"。 */
function summarizeLandTypes(
  counts: ReadonlyMap<LandTypeName, number>,
  land: ReadonlyMap<LandTypeName, LandTypeRules>,
  speedType: SpeedType,
): string {
  return [...counts]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([name, count]) => {
      const factor = speedFactor(land, name, speedType)
      return `${name} ${count} 格${factor === 0 ? '（不可通行）' : ''}`
    })
    .join('、')
}

function pickSpawns(passable: readonly Cell[]): readonly MapBattleSpawn[] {
  const spawns: MapBattleSpawn[] = []
  const used: Cell[] = []
  for (const [list, fromEnd] of [
    [PLAYER_UNITS, false],
    [ENEMY_UNITS, true],
  ] as ReadonlyArray<readonly [readonly string[], boolean]>) {
    const candidates = fromEnd ? [...passable].reverse() : passable
    for (const unitId of list) {
      const spot = candidates.find((cell) =>
        used.every((taken) => Math.abs(taken.x - cell.x) + Math.abs(taken.y - cell.y) >= SPAWN_SPACING),
      )
      if (!spot) break
      used.push(spot)
      spawns.push({ unitId, owner: fromEnd ? 1 : 0, cell: spot })
    }
  }
  return spawns
}

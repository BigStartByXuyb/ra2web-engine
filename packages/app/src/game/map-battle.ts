import { buildPassability, openTheater } from '@ra2web/assets'
import type { MapFile } from '@ra2web/formats'
import type { Cell } from '@ra2web/sim'

/**
 * 官方地图 → 战场：把地图的通行性变成模拟内核的不可通行格，并给双方找落脚点。
 *
 * 通行性按 theater 的地块集分类判定（见 `@ra2web/assets` 的 `buildPassability`）；
 * 单位类型只用 `rules.ini` 里必定存在的几种，避免地图决定兵种。
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
  readonly blockedSetNames: readonly string[]
  readonly spawns: readonly MapBattleSpawn[]
}

const PLAYER_UNITS = ['HTNK', 'HTNK', 'SMCV'] as const
const ENEMY_UNITS = ['MTNK', 'MTNK'] as const
const SPAWN_SPACING = 2

export function planMapBattle(archiveBytes: Uint8Array, map: MapFile): MapBattleSetup | undefined {
  const theater = map.theater ? openTheater(archiveBytes, map.theater) : undefined
  if (!theater) return undefined
  const passability = buildPassability(theater.ini)

  const blockedCells = new Set<number>()
  const passable: Cell[] = []
  for (const cell of map.cells) {
    if (cell.cellX < 0 || cell.cellY < 0 || cell.cellX >= map.width || cell.cellY >= map.height) continue
    const index = cell.cellY * map.width + cell.cellX
    if (passability.blockedByTile[cell.tileIndex] === 1) blockedCells.add(index)
    else if (
      !blockedCells.has(index) &&
      !passable.some((candidate) => candidate.y * map.width + candidate.x === index)
    ) {
      passable.push({ x: cell.cellX, y: cell.cellY })
    }
  }
  passable.sort((left, right) => left.x + left.y - (right.x + right.y))

  const blocked: Cell[] = [...blockedCells].map((index) => ({ x: index % map.width, y: Math.floor(index / map.width) }))
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

  return {
    width: map.width,
    height: map.height,
    blocked,
    blockedSetNames: passability.blockedSetNames,
    spawns,
  }
}

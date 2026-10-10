import type { TheaterIni } from '@ra2web/formats'

/**
 * 通行性：按 theater INI 的**地块集分类**判定，而不是逐格数据。
 *
 * `[General]` 里的锚点值是**地块集编号**（实测：`WaterSet=21` 正好是第 21 个集「Water」、
 * `CliffSet=10` 是「Cliff Set」、`BridgeSet=19` 是「Bridges」、`BlackTile=6` 是「Blank」），
 * 因此"某地块能不能走"= 它所属的集是不是水/悬崖/空白。
 *
 * 待核对：原版可能对个别集（如斜坡、悬崖顶、可破坏悬崖）另有规定；这里先按
 * 水 / 悬崖 / 悬崖水面 / 可破坏悬崖 / 空白 判为不可通行。
 */

const IMPASSABLE_ANCHORS = ['waterset', 'cliffset', 'watercliffs', 'destroyablecliffs', 'blacktile'] as const

export interface Passability {
  /** 下标 = 全局地块编号；1 表示不可通行 */
  readonly blockedByTile: Uint8Array
  /** 被判为不可通行的地块集名，便于界面说明 */
  readonly blockedSetNames: readonly string[]
}

export function buildPassability(ini: TheaterIni): Passability {
  const blocked = new Uint8Array(ini.tiles.length)
  const blockedSetNames: string[] = []
  const anchors = IMPASSABLE_ANCHORS.map((key) => Number(ini.general.get(key)))

  ini.sets.forEach((set, setIndex) => {
    if (!anchors.includes(set.index)) return
    blockedSetNames.push(set.name)
    let at = 0
    for (let previous = 0; previous < setIndex; previous++) at += ini.sets[previous]!.tilesInSet
    for (let tile = 0; tile < set.tilesInSet; tile++) blocked[at + tile] = 1
  })

  return { blockedByTile: blocked, blockedSetNames }
}

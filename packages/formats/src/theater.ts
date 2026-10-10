import { ParseError } from './errors.js'
import { parseIni, type IniDocument } from './ini.js'

/**
 * Theater 地块控制文件（`snow.ini` / `temperat.ini` / `urban.ini`）读取。
 *
 * 结构沿自 TS：
 *   `[General]` 给出 `ClearTile` / `RoughTile` / `BlackTile` 等地块编号（数值是全局地块编号）；
 *   `[TileSet0000]`、`[TileSet0001]`… 依次定义地块集：`FileName` 是图形名、`TilesInSet` 是地块数。
 *
 * 地图记录里的 `tile` 是**全局地块编号**：按 TileSet 顺序累加 `TilesInSet` 即得，
 * 因此 `tiles[tile]` 直接给出"哪个图形文件、该文件里的第几块（1 起）"。
 *
 * 图形文件名规则（与客户端实现一致）：`<FileName><两位序号>[a..z]<剧场后缀>`，
 * 例如雪地第一块是 `Clear01.sno`；字母后缀用于同一地块的附加图像，按存在与否依次尝试。
 */

export interface TheaterTileSet {
  readonly index: number
  readonly name: string
  readonly fileName: string
  readonly tilesInSet: number
}

export interface TheaterTile {
  readonly setIndex: number
  readonly fileName: string
  /** 该图形文件里的第几块（1 起，两位序号） */
  readonly tileNumber: number
}

export interface TheaterIni {
  readonly general: ReadonlyMap<string, string>
  readonly sets: readonly TheaterTileSet[]
  readonly tiles: readonly TheaterTile[]
}

const SECTION_PATTERN = /^tileset(\d+)$/

export function readTheaterIni(bytes: Uint8Array): TheaterIni {
  const document = parseIni(new TextDecoder('windows-1252').decode(bytes))
  const collected: TheaterTileSet[] = []
  for (const [sectionName, section] of document.sections) {
    const matched = SECTION_PATTERN.exec(sectionName)
    if (!matched) continue
    const fileName = section.values.get('filename')
    const tilesInSet = Number(section.values.get('tilesinset') ?? 0)
    if (!fileName || !Number.isFinite(tilesInSet)) continue
    collected.push({
      index: Number(matched[1]),
      name: section.values.get('setname') ?? `TileSet${matched[1]}`,
      fileName,
      tilesInSet: Math.max(0, tilesInSet),
    })
  }

  // 按 TileSet 编号排序：全局地块编号就是按这个顺序累加 TilesInSet
  const sets = collected.sort((left, right) => left.index - right.index)
  const tiles: TheaterTile[] = []
  sets.forEach((set, setIndex) => {
    for (let tileNumber = 1; tileNumber <= set.tilesInSet; tileNumber++) {
      tiles.push({ setIndex, fileName: set.fileName, tileNumber })
    }
  })

  return {
    general: document.sections.get('general')?.values ?? new Map(),
    sets,
    tiles,
  }
}

/** 取 `[General]` 里的数值项（`ClearTile`、`RoughTile` 等）。 */
export function theaterNumber(ini: TheaterIni, key: string): number | undefined {
  const value = ini.general.get(key.toLowerCase())
  if (value === undefined) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 地块图形文件名（不含字母后缀）：`<FileName><两位序号><剧场后缀>`。 */
export function tileFileName(tile: TheaterTile, theaterSuffix: string): string {
  return `${tile.fileName}${String(tile.tileNumber).padStart(2, '0')}${theaterSuffix}`
}

/** 校验：地块表不能为空，否则说明这份 INI 不是地块控制文件。 */
export function assertTheaterIni(ini: TheaterIni): void {
  if (ini.tiles.length === 0) throw new ParseError('theater INI 里没有 [TileSet####] 地块集', 0)
}

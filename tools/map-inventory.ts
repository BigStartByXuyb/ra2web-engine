import fs from 'node:fs'
import { TILE_NONE, readMap, readMixEntry, readMixIndex } from '@ra2web/formats'
import {
  artEntryOf,
  findOverride,
  openTheater,
  readArtEntries,
  readOverlayNames,
  readRulesImageNames,
  type ArtEntry,
  type AssetOverride,
} from '@ra2web/assets'

/**
 * 单张地图的美术清单：这张图要用到哪些图形、哪些还缺，供"把一张图做完整"逐项收口。
 *
 * 用法：
 *   tsx tools/map-inventory.ts <RA2.MIX> <地图档案.mix> <条目序号> <out.md> [--hd=<覆盖包.mix>]
 *
 * 口径与引擎同一份，不另抄：建筑图形名走 `imageNameOf`（art.ini → rules.ini → 类型名），
 * 覆盖物名取 rules.ini `[OverlayTypes]`，地块名取剧场表命中的那个文件名。
 * 给 `--hd` 时额外报出"哪些地块还没有高清图"，判据与 `hd-tiles.ts` 一致：
 * 剧场命中的文件名（小写）是否在包里的 `hd-tiles.txt` 清单上。
 */
const [archivePath, mixPath, indexArg, outPath, ...rest] = process.argv.slice(2)
if (!archivePath || !mixPath || !indexArg || !outPath) {
  console.error('usage: tsx tools/map-inventory.ts <RA2.MIX> <地图档案.mix> <条目序号> <out.md> [--hd=<覆盖包.mix>]')
  process.exit(1)
}
const hdArg = rest.find((value) => value.startsWith('--hd='))
const overrides: AssetOverride[] = hdArg
  ? [{ name: 'hd', bytes: new Uint8Array(fs.readFileSync(hdArg.slice('--hd='.length))) }]
  : []

const archive = new Uint8Array(fs.readFileSync(archivePath))
const mapArchive = new Uint8Array(fs.readFileSync(mixPath))
const mapIndex = readMixIndex(mapArchive)
const entry = mapIndex.entries[Number(indexArg)]
if (!entry) {
  console.error(`档案只有 ${mapIndex.entries.length} 个条目`)
  process.exit(1)
}
const map = readMap(readMixEntry(mapArchive, mapIndex, entry))

const art = readArtEntries(archive, overrides)
const rulesImages = readRulesImageNames(archive, overrides)
const overlayNames = readOverlayNames(archive, overrides)
const theater = map.theater ? openTheater(archive, map.theater, overrides) : undefined
if (map.theater && !theater) {
  console.error(`剧场 ${map.theater} 打不开，地块名没法解析`)
  process.exit(1)
}

const hdNames = readHdManifest(overrides)

/** 建筑：类型名 → 聚合 */
interface StructureRow {
  type: string
  image: string
  entry: ArtEntry | undefined
  count: number
  hasArt: boolean
}
const structures = new Map<string, StructureRow>()
const units = new Map<string, number>()
for (const placement of map.placements) {
  if (placement.kind === 'structure') {
    const key = placement.type.toLowerCase()
    let row = structures.get(key)
    if (!row) {
      const { image, entry: artEntry } = artEntryOf(placement.type, art, rulesImages)
      row = {
        type: placement.type,
        image,
        entry: artEntry,
        count: 0,
        hasArt: structureHasArt(image, artEntry),
      }
      structures.set(key, row)
    }
    row.count++
  } else if (placement.kind === 'unit' || placement.kind === 'infantry' || placement.kind === 'aircraft') {
    units.set(placement.type, (units.get(placement.type) ?? 0) + 1)
  }
}

/** 覆盖物：编号 → 聚合 */
const overlays = new Map<number, number>()
const tiles = new Map<number, number>()
const heights = new Map<number, number>()
let bareCells = 0
for (const cell of map.cells) {
  if (cell.tileIndex === TILE_NONE) bareCells++
  else tiles.set(cell.tileIndex, (tiles.get(cell.tileIndex) ?? 0) + 1)
  heights.set(cell.z, (heights.get(cell.z) ?? 0) + 1)
  if (cell.overlay !== undefined) {
    overlays.set(cell.overlay.id, (overlays.get(cell.overlay.id) ?? 0) + 1)
  }
}

const lines: string[] = []
lines.push(`# ${mixPath.split(/[\\/]/u).pop()} 条目 ${indexArg} 美术清单`)
lines.push('')
lines.push('## 图信息')
lines.push('')
lines.push(`- hash：\`${entry.hash.toString(16)}\``)
lines.push(`- 尺寸：${map.width}×${map.height}，剧场 ${map.theater ?? '-'}`)
lines.push(`- 记录 ${map.cells.length} 条（无地块 ${bareCells} 条）；地块 ${tiles.size} 种；高度 z ${heights.size} 种`)
lines.push(
  `- 建筑放置 ${[...structures.values()].reduce((sum, row) => sum + row.count, 0)} 个；预置单位 ${[...units.values()].reduce((sum, value) => sum + value, 0)} 个`,
)
lines.push('')

lines.push('## 建筑（按出现次数降序）')
lines.push('')
lines.push(
  '| 类型 | 图形名 | 地基 | Height | OccupyHeight | YSortAdjust | Buildup | ActiveAnim | ActiveAnimDamaged | 次数 | 美术 |',
)
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
const structureRows = [...structures.values()].sort((a, b) => b.count - a.count)
for (const row of structureRows) {
  const e = row.entry
  lines.push(
    [
      row.type,
      row.image,
      e ? `${e.foundationWidth}x${e.foundationHeight}` : '-',
      e?.height ?? 0,
      e?.occupyHeight ?? 0,
      e?.ySortAdjust ?? 0,
      e?.buildup ?? '-',
      e?.activeAnim ?? '-',
      e?.activeAnimDamaged ?? '-',
      row.count,
      row.hasArt ? '有' : '**缺**',
    ]
      .join(' | ')
      .replace(/^/u, '| ')
      .replace(/$/u, ' |'),
  )
}
lines.push('')

lines.push('## 覆盖物')
lines.push('')
if (overlays.size === 0) {
  lines.push('（这张图没有覆盖物）')
} else {
  lines.push('| 编号 | 图形名 | 次数 |')
  lines.push('| --- | --- | --- |')
  for (const [id, count] of [...overlays.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${id} | ${overlayNames.get(id) ?? '**未定义**'} | ${count} |`)
  }
}
lines.push('')

lines.push('## 地块')
lines.push('')
if (hdNames.size === 0) {
  lines.push(`- 没有给 \`--hd\`，跳过"缺高清"判定；本图用到 ${tiles.size} 种地块`)
} else {
  const used = new Map<string, number>()
  let unresolved = 0
  for (const [tileIndex, count] of tiles) {
    const fileName = theater?.tileFileName(tileIndex)
    if (!fileName) {
      unresolved += count
      continue
    }
    const name = fileName.toLowerCase()
    used.set(name, (used.get(name) ?? 0) + count)
  }
  const missing = [...used.entries()].filter(([name]) => !hdNames.has(name)).sort((a, b) => b[1] - a[1])
  lines.push(`- 本图用到 ${tiles.size} 种地块，去重后 ${used.size} 个图形文件（另有 ${bareCells} 条记录本来就没地块）`)
  lines.push(`- 已有高清：${used.size - missing.length} 个`)
  lines.push(
    `- **缺高清：${missing.length} 个**${unresolved > 0 ? `；另有 ${unresolved} 格有地块号但取不到图形名` : ''}`,
  )
  for (const [name, count] of missing) {
    lines.push(`  - \`${name}\` ${count} 格`)
  }
}
lines.push('')

lines.push('## 预置单位')
lines.push('')
if (units.size === 0) {
  lines.push('（这张图没有预置单位）')
} else {
  for (const [type, count] of [...units.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${type} × ${count}`)
  }
}
lines.push('')

lines.push('## 缺口小结')
lines.push('')
const missingStructures = structureRows.filter((row) => !row.hasArt)
lines.push(
  `- 建筑美术缺 ${missingStructures.length} 种${missingStructures.length > 0 ? `：${missingStructures.map((row) => row.type).join('、')}` : ''}`,
)
lines.push(`- 覆盖物编号未定义 ${[...overlays.keys()].filter((id) => !overlayNames.has(id)).length} 种`)
lines.push(
  `- 建筑里带 Buildup 的 ${structureRows.filter((row) => row.entry?.buildup).length} 种、带 ActiveAnim 的 ${structureRows.filter((row) => row.entry?.activeAnim).length} 种`,
)
lines.push('')

fs.writeFileSync(outPath, lines.join('\n'), 'utf8')
console.log(
  `[清单] ${map.width}×${map.height} ${map.theater ?? '-'}：建筑 ${structures.size} 种、覆盖物 ${overlays.size} 种、地块 ${tiles.size} 种、单位 ${units.size} 种`,
)
console.log(`[清单] 已写入 ${outPath}`)

function readHdManifest(packs: readonly AssetOverride[]): ReadonlySet<string> {
  if (packs.length === 0) return new Set()
  const manifest = findOverride(packs, 'hd-tiles.txt')
  if (!manifest) return new Set()
  return new Set(
    new TextDecoder()
      .decode(manifest)
      .split(/\r?\n/u)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line !== ''),
  )
}

/** 建筑美术是否存在：覆盖包里的 `<图形名>.png` 或剧场表里的 SHP，命中任一条即有。 */
function structureHasArt(image: string, artEntry: ArtEntry | undefined): boolean {
  if (findOverride(overrides, `${image.toLowerCase()}.png`)) return true
  return theater?.loadImage(image, { theaterExtension: artEntry?.theater ?? false }) !== undefined
}

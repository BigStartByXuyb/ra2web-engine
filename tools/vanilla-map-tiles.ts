import fs from 'node:fs'
import { readMap, readMixEntry, readMixIndex } from '@ra2web/formats'
import { openTheater } from '@ra2web/assets'

/**
 * 逐格检查"这一格取不取得到地块美术" —— 渲染出空洞（透明/黑）时用它定位。
 *
 * 用法：tsx tools/vanilla-map-tiles.ts <RA2.MIX> <地图档案.mix> <条目序号>
 *
 * 输出：取不到 TMP 的格数、子块槽位为空（原版说"这格没有图形"）的格数，
 * 以及出现最多的几个"问题 tile 索引"，带一格样例坐标。
 */
const [archivePath, mixPath, indexArg, ...rest] = process.argv.slice(2)
if (!archivePath || !mixPath || !indexArg) {
  console.error('usage: tsx tools/vanilla-map-tiles.ts <RA2.MIX> <maps.mix> <entryIndex>')
  process.exit(1)
}
const archive = new Uint8Array(fs.readFileSync(archivePath))
const maps = new Uint8Array(fs.readFileSync(mixPath))
const mapIndex = readMixIndex(maps)
const entry = mapIndex.entries[Number(indexArg)]
if (!entry) {
  console.error(`地图档案只有 ${mapIndex.entries.length} 个条目`)
  process.exit(1)
}
const map = readMap(readMixEntry(maps, mapIndex, entry))
const theater = map.theater ?? 'temperate'
const assets = openTheater(archive, theater)
if (!assets) {
  console.error(`装不上剧场 ${theater}`)
  process.exit(1)
}

const missingTile = new Map<number, { count: number; sample: string }>()
const emptySlot = new Map<number, { count: number; sample: string }>()
let noArt = 0
for (const cell of map.cells) {
  const tmp = assets.loadTile(cell.tileIndex)
  const record = (map_: Map<number, { count: number; sample: string }>, sample: string): void => {
    const current = map_.get(cell.tileIndex)
    if (current) current.count++
    else map_.set(cell.tileIndex, { count: 1, sample })
  }
  const sample = `cell(${cell.cellX},${cell.cellY}) sub=${cell.subTile} z=${cell.z}`
  if (!tmp) {
    noArt++
    record(missingTile, sample)
    continue
  }
  const sub = tmp.subTiles[cell.subTile]
  if (!sub || sub.size <= 0 || sub.pixels.every((value) => value === 0)) {
    noArt++
    record(emptySlot, sample)
  }
}

const top = (map_: Map<number, { count: number; sample: string }>, limit: number): string =>
  [...map_.entries()]
    .sort((left, right) => right[1].count - left[1].count)
    .slice(0, limit)
    .map(([tile, info]) => `tile ${tile}×${info.count}（${info.sample}）`)
    .join('\n  ')

console.log(`地图 ${map.width}×${map.height}，剧场 ${theater}，格数 ${map.cells.length}`)
console.log(
  `取不到 TMP 的格：${[...missingTile.values()].reduce((sum, info) => sum + info.count, 0)}（${missingTile.size} 种 tile）`,
)
if (missingTile.size > 0) console.log(`  最多：\n  ${top(missingTile, 6)}`)
console.log(
  `能取到 TMP 但这一格是空槽位：${[...emptySlot.values()].reduce((sum, info) => sum + info.count, 0)}（${emptySlot.size} 种 tile）`,
)
if (emptySlot.size > 0) console.log(`  最多：\n  ${top(emptySlot, 6)}`)
console.log(`合计没有美术的格：${noArt} / ${map.cells.length}`)

// --tiles=334,336：把指定索引在剧场表里的登记情况打出来（对照缺失的索引）
const tilesOption = rest.find((value) => value.startsWith('--tiles='))
if (tilesOption) {
  const wanted = tilesOption.slice('--tiles='.length).split(',').map(Number)
  console.log(`\n剧场表共登记 ${assets.ini.tiles.length} 个地块（索引 0..${assets.ini.tiles.length - 1}）`)
  for (const index of wanted) {
    const tile = assets.ini.tiles[index]
    console.log(
      tile === undefined
        ? `tile ${index} → 表里没有（越界）`
        : `tile ${index} → 段 ${tile.setIndex} 文件 ${tile.fileName} 第 ${tile.tileNumber} 块`,
    )
  }
}

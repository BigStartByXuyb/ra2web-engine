import fs from 'node:fs'
import { readMap, readMixEntry, readMixIndex } from '@ra2web/formats'

/**
 * 用**玩家自备的原版档案**读一张地图：MIX → `.map` → `[IsoMapPack5]`（base64 + 分块 LZO）→ 记录。
 *
 * 用法：tsx tools/vanilla-map.ts <地图档案.mix> [条目序号=0]
 */
const [mixPath, indexArg = '0'] = process.argv.slice(2)
if (!mixPath) {
  console.error('usage: vanilla-map.ts <maps01.mix path> [entryIndex=0]')
  process.exit(1)
}

const archive = new Uint8Array(fs.readFileSync(mixPath))
const index = readMixIndex(archive)
const entry = index.entries[Number(indexArg)]
if (!entry) {
  console.error(`档案只有 ${index.entries.length} 个条目`)
  process.exit(1)
}

const map = readMap(readMixEntry(archive, index, entry))
const tiles = new Map<number, number>()
const heights = new Map<number, number>()
for (const cell of map.cells) {
  tiles.set(cell.tileIndex, (tiles.get(cell.tileIndex) ?? 0) + 1)
  heights.set(cell.z, (heights.get(cell.z) ?? 0) + 1)
}

console.log(`${mixPath} 条目 ${indexArg}（hash ${entry.hash.toString(16)}）`)
console.log(`尺寸 ${map.width}×${map.height}  剧场 ${map.theater ?? '-'}  本地范围 ${formatBounds(map.localBounds)}`)
console.log(`记录 ${map.cells.length} 条（= (2×宽−1)×高）`)
console.log(`tile 索引 ${tiles.size} 种，最多的几个：${topEntries(tiles, 8)}`)
console.log(`高度 z ${heights.size} 种，分布：${topEntries(heights, 8)}`)

const inRange = map.cells.filter(
  (cell) => cell.cellX >= 0 && cell.cellY >= 0 && cell.cellX < map.width && cell.cellY < map.height,
).length
console.log(`落在方格范围内的记录 ${inRange} / ${map.cells.length}`)

function topEntries(counts: Map<number, number>, limit: number): string {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([key, value]) => `${key}×${value}`)
    .join(' ')
}

function formatBounds(bounds: { left: number; top: number; right: number; bottom: number } | undefined): string {
  return bounds ? `${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}` : '-'
}

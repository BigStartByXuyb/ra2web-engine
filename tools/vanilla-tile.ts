import fs from 'node:fs'
import { crc32, findMixEntry, readMixEntry, readMixIndex, readTmp, type TmpFile } from '@ra2web/formats'
import { writePng } from './png-write.js'

/**
 * 用**玩家自备的原版档案**渲染一个地块：RA2.MIX → isotemp.mix → `.tmp` → PNG。
 *
 * 地形调色板取自 `local.mix` 里第一个 768 字节条目：判定方法是把该地块最常出现的索引
 * 映射过去，得到的都是棕/灰/土色（另三个候选分别是高亮、灰度、饱和色板）。
 * 待核对：哪个条目对应哪个 theater。
 *
 * 用法：tsx tools/vanilla-tile.ts <RA2.MIX> [theater=isotemp.mix] [entryIndex=1] [out.png=tile.png] [scale=2]
 */
const [mixPath, theaterName = 'isotemp.mix', indexArg = '1', outPath = 'tile.png', scaleArg = '2'] =
  process.argv.slice(2)
if (!mixPath) {
  console.error('usage: vanilla-tile.ts <RA2.MIX> [theater=isotemp.mix] [entryIndex=1] [out.png] [scale=2]')
  process.exit(1)
}

const scale = Math.max(1, Math.round(Number(scaleArg)))
const archive = new Uint8Array(fs.readFileSync(mixPath))
const root = readMixIndex(archive)

const palette = readTerrainPalette(archive)
const theaterBytes = readMixEntry(archive, root, findMixEntry(root, theaterName, crc32)!)
const theater = readMixIndex(theaterBytes)
const tile = readTmp(readMixEntry(theaterBytes, theater, theater.entries[Number(indexArg)]!))

const colors = new Map<number, number>()
for (const sub of tile.subTiles) for (const index of sub.pixels) colors.set(index, (colors.get(index) ?? 0) + 1)
console.log(
  `地块 ${theaterName} #${indexArg}：${tile.cellsX}×${tile.cellsY} 格、${tile.cellWidth}×${tile.cellHeight} 像素，` +
    `子块 ${tile.subTiles.length} 个，用到的调色板索引 ${colors.size} 种`,
)

const image = composeTile(tile, palette)
fs.writeFileSync(outPath, writePng(image.width, image.height, image.rgba))
console.log(`渲染 → ${outPath}（${image.width}×${image.height}，放大 ${scale}×）`)

function readTerrainPalette(archiveBytes: Uint8Array): Uint8Array {
  const localBytes = readMixEntry(
    archiveBytes,
    readMixIndex(archiveBytes),
    findMixEntry(readMixIndex(archiveBytes), 'local.mix', crc32)!,
  )
  const local = readMixIndex(localBytes)
  const entry = local.entries.find((candidate) => candidate.length === 768)
  if (!entry) throw new Error('local.mix 里找不到 768 字节调色板')
  console.log(`地形调色板：local.mix 条目 hash=${entry.hash.toString(16)}`)
  return readMixEntry(localBytes, local, entry)
}

/** 各子块按 (pixelX, pixelY) 贴到同一张图上：等距斜向排布，偏移可为负。 */
function composeTile(tile: TmpFile, palette: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const minX = Math.min(...tile.subTiles.map((sub) => sub.pixelX))
  const minY = Math.min(...tile.subTiles.map((sub) => sub.pixelY))
  const contentWidth = Math.max(...tile.subTiles.map((sub) => sub.pixelX)) - minX + tile.cellWidth
  const contentHeight = Math.max(...tile.subTiles.map((sub) => sub.pixelY)) - minY + tile.cellHeight
  const rgba = new Uint8Array(contentWidth * scale * contentHeight * scale * 4)

  for (const sub of tile.subTiles) {
    for (let y = 0; y < tile.cellHeight; y++) {
      for (let x = 0; x < tile.cellWidth; x++) {
        const index = sub.pixels[y * tile.cellWidth + x]!
        if (index === 0) continue
        const pixelX = sub.pixelX - minX + x
        const pixelY = sub.pixelY - minY + y
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const at = ((pixelY * scale + dy) * contentWidth * scale + pixelX * scale + dx) * 4
            rgba[at] = Math.min(255, palette[index * 3]! * 4)
            rgba[at + 1] = Math.min(255, palette[index * 3 + 1]! * 4)
            rgba[at + 2] = Math.min(255, palette[index * 3 + 2]! * 4)
            rgba[at + 3] = 255
          }
        }
      }
    }
  }
  return { width: contentWidth * scale, height: contentHeight * scale, rgba }
}

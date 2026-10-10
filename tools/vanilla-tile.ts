import fs from 'node:fs'
import { loadTerrainPalette, openTheater } from '@ra2web/assets'
import type { TmpFile } from '@ra2web/formats'
import { paintTmpSubTile, type RgbaImage } from '@ra2web/render'
import { writePng } from './png-write.js'

/**
 * 用**玩家自备的原版档案**渲染一个地块：RA2.MIX → theater 地块表 → `.tem/.sno/.urb` → PNG。
 *
 * 走的是引擎自己的取用路径（`openTheater` + `loadTerrainPalette`），因此渲染出来的
 * 颜色与战场页一致，可以直接和原版截图比对。
 *
 * 用法：tsx tools/vanilla-tile.ts <RA2.MIX> [theater=temperate] [tileIndex=0] [out.png=tile.png] [scale=2]
 */
const [mixPath, theaterName = 'temperate', indexArg = '0', outPath = 'tile.png', scaleArg = '2'] = process.argv.slice(2)
if (!mixPath) {
  console.error('usage: vanilla-tile.ts <RA2.MIX> [theater=temperate] [tileIndex=0] [out.png] [scale=2]')
  process.exit(1)
}

const scale = Math.max(1, Math.round(Number(scaleArg)))
const archive = new Uint8Array(fs.readFileSync(mixPath))
const theater = openTheater(archive, theaterName)
const palette = loadTerrainPalette(archive, theaterName)
if (!theater || !palette) {
  console.error(`取不到剧场资源：${theaterName}`)
  process.exit(1)
}

const tile = theater.loadTile(Number(indexArg))
if (!tile) {
  console.error(`地块 ${indexArg} 没有图形（剧场地块表共 ${theater.ini.tiles.length} 块）`)
  process.exit(1)
}
const painted = tile.subTiles.map((sub) => (sub.isEmpty ? undefined : paintTmpSubTile(tile, sub, palette)))
console.log(
  `地块 ${indexArg}（${theaterName}）：${tile.cellsX}×${tile.cellsY} 格、${tile.cellWidth}×${tile.cellHeight} 像素，` +
    `子块 ${tile.subTiles.length} 个（有图形 ${painted.filter(Boolean).length} 个）`,
)

const image = compose(tile, painted)
fs.writeFileSync(outPath, writePng(image.width, image.height, image.rgba))
console.log(`渲染 → ${outPath}（${image.width}×${image.height}，放大 ${scale}×）`)

/** 各子块按 (pixelX, pixelY) 贴到同一张图上：等距斜向排布，偏移可为负。 */
function compose(tile: TmpFile, painted: ReadonlyArray<RgbaImage | undefined>): RgbaImage {
  const placed: Array<{ x: number; y: number; image: RgbaImage }> = []
  tile.subTiles.forEach((sub, position) => {
    const image = painted[position]
    if (image) placed.push({ x: sub.pixelX, y: sub.pixelY, image })
  })
  const minX = Math.min(...placed.map((item) => item.x))
  const minY = Math.min(...placed.map((item) => item.y))
  const width = Math.max(...placed.map((item) => item.x)) - minX + tile.cellWidth
  const height = Math.max(...placed.map((item) => item.y)) - minY + tile.cellHeight
  const rgba = new Uint8Array(width * scale * height * scale * 4)

  for (const item of placed) {
    const originX = (item.x - minX) * scale
    const originY = (item.y - minY) * scale
    for (let y = 0; y < item.image.height; y++) {
      for (let x = 0; x < item.image.width; x++) {
        if (item.image.rgba[(y * item.image.width + x) * 4 + 3] === 0) continue
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const target = ((originY + y * scale + dy) * width * scale + originX + x * scale + dx) * 4
            const from = (y * item.image.width + x) * 4
            rgba[target] = item.image.rgba[from]!
            rgba[target + 1] = item.image.rgba[from + 1]!
            rgba[target + 2] = item.image.rgba[from + 2]!
            rgba[target + 3] = 255
          }
        }
      }
    }
  }
  return { width: width * scale, height: height * scale, rgba }
}

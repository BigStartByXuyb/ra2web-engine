import fs from 'node:fs'
import { readMap, readMixEntry, readMixIndex } from '@ra2web/formats'
import { writePng } from './png-write.js'

/**
 * 把地图档案里自带的**官方预览图**导成 PNG —— 这是官方自己渲的那一张，用来跟我们的渲染对照。
 *
 * 用法：tsx tools/vanilla-map-preview.ts <地图档案.mix> <条目序号> <out.png> [放大倍数=1]
 */
const [mixPath, indexArg, outPath, scaleArg] = process.argv.slice(2)
if (!mixPath || !indexArg || !outPath) {
  console.error('usage: tsx tools/vanilla-map-preview.ts <maps.mix> <entryIndex> <out.png> [scale=1]')
  process.exit(1)
}
const scale = Math.max(1, Number(scaleArg ?? '1'))
const archive = new Uint8Array(fs.readFileSync(mixPath))
const index = readMixIndex(archive)
const entry = index.entries[Number(indexArg)]
if (!entry) {
  console.error(`档案只有 ${index.entries.length} 个条目`)
  process.exit(1)
}
const map = readMap(readMixEntry(archive, index, entry))
const preview = map.preview
if (!preview) {
  console.error('这张地图没有自带预览图')
  process.exit(1)
}

const out = new Uint8Array(preview.width * scale * preview.height * scale * 4)
for (let y = 0; y < preview.height * scale; y++) {
  for (let x = 0; x < preview.width * scale; x++) {
    const from = (Math.floor(y / scale) * preview.width + Math.floor(x / scale)) * 3
    const to = (y * preview.width * scale + x) * 4
    out[to] = preview.rgb[from]!
    out[to + 1] = preview.rgb[from + 1]!
    out[to + 2] = preview.rgb[from + 2]!
    out[to + 3] = 255
  }
}
fs.writeFileSync(outPath, writePng(preview.width * scale, preview.height * scale, out))
console.log(
  `官方预览 ${preview.width}×${preview.height} × ${scale} → ${outPath}（地图 ${map.width}×${map.height}，剧场 ${map.theater ?? '-'}）`,
)

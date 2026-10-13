import fs from 'node:fs'
import path from 'node:path'
import {
  crc32,
  findMixEntry,
  readMixEntry,
  readMixFile,
  readMixIndex,
  readPalette,
  readShp,
  SHP_TRANSPARENT_INDEX,
} from '@ra2web/formats'
import { writePng } from './png-write.js'

/**
 * 从 LANGUAGE.MIX 内的 cameo.mix 解出单位建造图标（`<单位>icon.shp`，60×48 8bit），
 * 用 RA2.MIX 内 cache.mix 的 `cameo.pal` 上色，导出 PNG —— 轨道 2 写实建模的
 * "造型 / 配色 / 标识位置"标准答案（docs/ART-ROADMAP.md 辨识度三件套之一）。
 *
 * 色板必须走 `readPalette`（6 位分量 ×4 还原 8 位），自拼 colors 会读错偏移整张变黑。
 *
 * 用法：tsx tools/extract-cameo.ts <输出目录> <单位ID...> [--scale=N] [--pack=<目录>]
 *   tsx tools/extract-cameo.ts D:/AI_GAME/work/hd-packs/refs HTNK
 *
 * 输出：`<输出目录>/<单位小写>-cameo.png`（原尺寸）与 `-cameo-<scale>x.png`（最近邻放大，
 * 供人眼参考；最近邻不插值，看到的每个色块都是原版真实像素）。
 */

const DEFAULT_PACK_DIR = 'D:/AI_GAME/work/assets/pack'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const positional = args.filter((arg) => !arg.startsWith('--'))
const outDir = positional[0]
const unitIds = positional.slice(1)
const scale = Number(flag('scale') ?? 8)
const packDir = flag('pack') ?? DEFAULT_PACK_DIR

if (!outDir || unitIds.length === 0 || !Number.isFinite(scale) || scale < 1) {
  console.error('usage: tsx tools/extract-cameo.ts <输出目录> <单位ID...> [--scale=8] [--pack=<原版档案目录>]')
  process.exit(1)
}

// cameo.mix 藏在 LANGUAGE.MIX 里；readMixFile 剥这一层嵌套（原版布局，条目名不敏感大小写）。
const languageBytes = new Uint8Array(fs.readFileSync(path.join(packDir, 'LANGUAGE.MIX')))
const cameoMixBytes = readMixFile({ bytes: languageBytes, fileName: 'cameo.mix' })
if (!cameoMixBytes) throw new Error(`${packDir}/LANGUAGE.MIX 里没有 cameo.mix`)

// cameo.pal 藏在 RA2.MIX 内的 cache.mix 里：先剥 RA2.MIX → cache.mix，
// 再在 cache.mix 里找 cameo.pal（readMixFile 只支持一层嵌套，这里手动叠第二次）。
const ra2Bytes = new Uint8Array(fs.readFileSync(path.join(packDir, 'RA2.MIX')))
const cacheMixBytes = readMixFile({ bytes: ra2Bytes, fileName: 'cache.mix' })
if (!cacheMixBytes) throw new Error(`${packDir}/RA2.MIX 里没有 cache.mix`)
const cacheIndex = readMixIndex(cacheMixBytes)
const palEntry = findMixEntry(cacheIndex, 'cameo.pal', crc32)
if (!palEntry) throw new Error('cache.mix 里没有 cameo.pal')
const palette = readPalette(readMixEntry(cacheMixBytes, cacheIndex, palEntry))

const cameoIndex = readMixIndex(cameoMixBytes)

function compositeRgba(shp: ReturnType<typeof readShp>): { width: number; height: number; rgba: Uint8Array } {
  const rgba = new Uint8Array(shp.width * shp.height * 4)
  for (const frame of shp.frames) {
    if (frame.isEmpty) continue
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const index = frame.pixels[y * frame.width + x]!
        if (index === SHP_TRANSPARENT_INDEX) continue
        const color = palette.colors[index]!
        const at = ((frame.y + y) * shp.width + (frame.x + x)) * 4
        rgba[at] = color.r
        rgba[at + 1] = color.g
        rgba[at + 2] = color.b
        rgba[at + 3] = 255
      }
    }
  }
  return { width: shp.width, height: shp.height, rgba }
}

function upscale(width: number, height: number, rgba: Uint8Array, factor: number): Uint8Array {
  const out = new Uint8Array(width * factor * height * factor * 4)
  for (let y = 0; y < height * factor; y++) {
    for (let x = 0; x < width * factor; x++) {
      const from = (Math.floor(y / factor) * width + Math.floor(x / factor)) * 4
      const to = (y * width * factor + x) * 4
      out[to] = rgba[from]!
      out[to + 1] = rgba[from + 1]!
      out[to + 2] = rgba[from + 2]!
      out[to + 3] = rgba[from + 3]!
    }
  }
  return out
}

fs.mkdirSync(outDir, { recursive: true })
for (const unitId of unitIds) {
  const entryName = `${unitId}icon.shp`
  const entry = findMixEntry(cameoIndex, entryName, crc32)
  if (!entry) {
    console.error(`${entryName} 不在 cameo.mix 里，跳过`)
    continue
  }
  const shp = readShp(readMixEntry(cameoMixBytes, cameoIndex, entry))
  const image = compositeRgba(shp)
  const base = path.join(outDir, `${unitId.toLowerCase()}-cameo.png`)
  fs.writeFileSync(base, writePng(image.width, image.height, image.rgba))
  const zoomed = path.join(outDir, `${unitId.toLowerCase()}-cameo-${scale}x.png`)
  fs.writeFileSync(
    zoomed,
    writePng(image.width * scale, image.height * scale, upscale(image.width, image.height, image.rgba, scale)),
  )
  console.log(`${entryName}（${shp.width}×${shp.height}，${shp.frames.length} 帧）→ ${base} + ${zoomed}`)
}

import fs from 'node:fs'
import { crc32 } from '@ra2web/formats'
import { landTypeOfTerrainType, loadTheaterPalette, openTheater, type LandTypeName } from '@ra2web/assets'
import { paintTmpSubTile } from '@ra2web/render'
import { writeMix } from './mix-write.js'
import { decodePngBytes, type PngImage } from './png-read.js'
import { writePng } from './png-write.js'

/**
 * 生成**高清地块素材包**：把原版地块的像素换成真彩位图，摆位与地形数据仍由原版 TMP 决定。
 *
 * 用法：
 *   tsx tools/build-hd-tiles.ts <RA2.MIX> <out.mix> <剧场> <纹理目录> [--scale=4] [--land=Clear=snow_floor.png,Road=asphalt.png]
 *
 * 合成方式（每个子块各自做一遍）：
 *
 * 1. 用原版调色板把子块画成 RGBA（`paintTmpSubTile`），拿到**原始亮度结构**与**透明遮罩**；
 * 2. 遮罩与亮度都做**双线性**放大 → 菱形边缘不再是硬台阶，坡面的明暗关系保留；
 * 3. 颜色来自该地块**类型**对应的贴图（`Clear`/`Road`/`Rock`…，见 `[tileset]` 的 terrainType 映射），
 *    按"相对该子块的平均亮度"做明暗调制，于是雪地还是那个雪地、路还是那条路，只是材质换成真彩。
 *
 * 没给贴图的类型就退回"平滑后的原版颜色"——包可以只覆盖一部分地块，其余照旧。
 *
 * 输出（与 `docs/ENGINE-UNIT3D.md` 里的约定配套，引擎侧实现在 `packages/app/src/game/hd-tiles.ts`）：
 * `hd-tiles.txt` 是清单，`<原名去后缀>.png` 是该地块的 `cellsX × cellsY` 子块网格。
 */

const [archivePath, outPath, theaterName, textureDir, ...rest] = process.argv.slice(2)
if (!archivePath || !outPath || !theaterName || !textureDir) {
  console.error(
    'usage: tsx tools/build-hd-tiles.ts <RA2.MIX> <out.mix> <theater> <纹理目录> [--scale=4] [--land=Clear=snow.png]',
  )
  process.exit(1)
}

const scaleArg = rest.find((value) => value.startsWith('--scale='))
const SCALE = scaleArg ? Math.max(1, Number(scaleArg.slice('--scale='.length)) || 1) : 4
const landArg = rest.find((value) => value.startsWith('--land='))
const landTextures = new Map<LandTypeName, PngImage>()
if (landArg) {
  for (const item of landArg.slice('--land='.length).split(',')) {
    const [land, file] = item.split('=')
    if (!land || !file) continue
    const path = `${textureDir}/${file}`
    if (!fs.existsSync(path)) {
      console.warn(`[高清地块] 贴图不存在，跳过：${path}`)
      continue
    }
    landTextures.set(land as LandTypeName, decodePngBytes(new Uint8Array(fs.readFileSync(path))))
  }
}
console.log(`[高清地块] 倍率 ${SCALE}，贴图 ${landTextures.size} 种（${[...landTextures.keys()].join('、') || '无'}）`)

const archive = new Uint8Array(fs.readFileSync(archivePath))
const theater = openTheater(archive, theaterName)
const palette = loadTheaterPalette(archive, theaterName, 'iso')
if (!theater || !palette) {
  console.error(`[高清地块] 装不上剧场 ${theaterName}`)
  process.exit(1)
}

/** 取一个 0..1 的相位，让相邻地块取到贴图的不同位置，不至于整片一样。 */
function phaseOf(name: string): { x: number; y: number } {
  const hash = crc32(new TextEncoder().encode(name))
  return { x: hash % 512, y: (hash >>> 9) % 512 }
}

function sampleWrap(texture: PngImage, x: number, y: number, out: { r: number; g: number; b: number }): void {
  const sx = ((Math.floor(x) % texture.width) + texture.width) % texture.width
  const sy = ((Math.floor(y) % texture.height) + texture.height) % texture.height
  const at = (sy * texture.width + sx) * 4
  out.r = texture.pixels[at]!
  out.g = texture.pixels[at + 1]!
  out.b = texture.pixels[at + 2]!
}

/** 双线性采样原图（返回 0..255 的 alpha 与亮度）。 */
function sampleSource(
  image: { width: number; height: number; rgba: Uint8Array },
  x: number,
  y: number,
): { alpha: number; lum: number; r: number; g: number; b: number } {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  let alpha = 0
  let lum = 0
  let r = 0
  let g = 0
  let b = 0
  for (const [dx, dy, weight] of [
    [0, 0, (1 - fx) * (1 - fy)],
    [1, 0, fx * (1 - fy)],
    [0, 1, (1 - fx) * fy],
    [1, 1, fx * fy],
  ] as const) {
    const sx = Math.min(image.width - 1, Math.max(0, x0 + dx))
    const sy = Math.min(image.height - 1, Math.max(0, y0 + dy))
    const at = (sy * image.width + sx) * 4
    const a = (image.rgba[at + 3]! / 255) * weight
    alpha += a
    lum += 0.299 * image.rgba[at]! * a + 0.587 * image.rgba[at + 1]! * a + 0.114 * image.rgba[at + 2]! * a
    r += image.rgba[at]! * a
    g += image.rgba[at + 1]! * a
    b += image.rgba[at + 2]! * a
  }
  if (alpha <= 0.001) return { alpha: 0, lum: 0, r: 0, g: 0, b: 0 }
  return { alpha, lum: lum / alpha, r: r / alpha, g: g / alpha, b: b / alpha }
}

const entries: { name: string; data: Uint8Array }[] = []
const converted: string[] = []
const seen = new Set<string>()
let skipped = 0

for (let tileIndex = 0; tileIndex < theater.ini.tiles.length; tileIndex++) {
  const name = theater.tileFileName(tileIndex)
  if (!name || seen.has(name)) continue
  seen.add(name)
  const tile = theater.loadTile(tileIndex)
  if (!tile) {
    skipped++
    continue
  }

  const gridWidth = tile.cellsX * tile.cellWidth * SCALE
  const gridHeight = tile.cellsY * tile.cellHeight * SCALE
  const rgba = new Uint8Array(gridWidth * gridHeight * 4)
  const phase = phaseOf(name)
  const sample = { r: 0, g: 0, b: 0 }

  tile.subTiles.forEach((sub, index) => {
    if (sub.isEmpty) return
    const source = paintTmpSubTile(tile, sub, palette)
    // 该子块的平均亮度：明暗按"相对自己"算，材质颜色才不会被整体压暗压亮
    let lumSum = 0
    let count = 0
    for (let at = 0; at < source.rgba.length; at += 4) {
      if (source.rgba[at + 3] === 0) continue
      lumSum += 0.299 * source.rgba[at]! + 0.587 * source.rgba[at + 1]! + 0.114 * source.rgba[at + 2]!
      count++
    }
    const meanLum = count > 0 ? Math.max(24, lumSum / count) : 128
    const texture = landTextures.get(landTypeOfTerrainType(sub.terrainType) ?? 'Clear') ?? landTextures.get('Clear')
    const column = index % tile.cellsX
    const row = Math.floor(index / tile.cellsX)
    const originX = column * tile.cellWidth * SCALE
    const originY = row * tile.cellHeight * SCALE

    for (let y = 0; y < tile.cellHeight * SCALE; y++) {
      for (let x = 0; x < tile.cellWidth * SCALE; x++) {
        const pixel = sampleSource(source, (x + 0.5) / SCALE - 0.5, (y + 0.5) / SCALE - 0.5)
        // **遮罩必须是硬边**：引擎用预乘 alpha 混合（blendFunc(ONE, ONE_MINUS_SRC_ALPHA)），
        // 半透明边缘像素会把它的整份颜色都加上去，于是每格边界出现一条亮线。
        // 原版地块本来就是 0/255 硬边，这里保持一致。
        if (pixel.alpha < 0.5) continue
        const shade = Math.min(1.7, Math.max(0.32, pixel.lum / meanLum))
        let r = pixel.r
        let g = pixel.g
        let b = pixel.b
        if (texture) {
          sampleWrap(texture, phase.x + x, phase.y + y, sample)
          r = sample.r * shade
          g = sample.g * shade
          b = sample.b * shade
        }
        const at = ((originY + y) * gridWidth + originX + x) * 4
        rgba[at] = Math.min(255, Math.round(r))
        rgba[at + 1] = Math.min(255, Math.round(g))
        rgba[at + 2] = Math.min(255, Math.round(b))
        rgba[at + 3] = 255
      }
    }
  })

  const dot = name.lastIndexOf('.')
  const pngName = `${dot > 0 ? name.slice(0, dot) : name}.png`
  entries.push({ name: pngName, data: new Uint8Array(writePng(gridWidth, gridHeight, rgba)) })
  converted.push(name)
}

entries.unshift({ name: 'hd-tiles.txt', data: new TextEncoder().encode(converted.join('\n') + '\n') })
fs.writeFileSync(outPath, writeMix(entries))
console.log(
  `[高清地块] ${converted.length} 个地块 → ${outPath}（${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MiB），跳过 ${skipped} 个无图形的地块`,
)

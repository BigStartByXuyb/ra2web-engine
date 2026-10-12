import fs from 'node:fs'
import { paletteColor } from '@ra2web/formats'
import { loadTheaterPalette } from '@ra2web/assets'
import { decodePngBytes } from './png-read.js'
import { writePng } from './png-write.js'
import { loadUnitModel } from './game-assets.js'

/**
 * 按**原版配色**生成单位材质贴图。
 *
 * 用法：
 *   tsx tools/build-unit-textures.ts <RA2.MIX> <输出目录> <单位ID> <剧场> [--plate=<金属板.png>] [--size=256]
 *
 * 口径：颜色不靠眼估，从 `<单位>.vxl`（含 `tur` 炮塔）的体素按**单位色板**统计出来 ——
 * 出现最多的颜色当装甲主色，明显更暗的一簇当履带/橡胶，明显更亮的一簇当裸金属。
 * 贴图取一张 CC0 金属板，按这些颜色**染色并烧进图里**（导出后 `baseColorFactor = 1`），
 * 所以模型在引擎里乘一次就是原版那套配色，只是表面多了材质细节。
 *
 * 输出：`<输出目录>/<材质名>.png`，Blender 侧按材质名自动取用。
 */
const [archivePath, outDir, unitId, theaterName, ...rest] = process.argv.slice(2)
if (!archivePath || !outDir || !unitId || !theaterName) {
  console.error(
    'usage: tsx tools/build-unit-textures.ts <RA2.MIX> <outDir> <单位ID> <剧场> [--plate=metal_plate.png] [--size=256]',
  )
  process.exit(1)
}
const plateArg = rest.find((value) => value.startsWith('--plate='))
const sizeArg = rest.find((value) => value.startsWith('--size='))
const SIZE = sizeArg ? Math.max(32, Number(sizeArg.slice('--size='.length)) || 256) : 256
const platePath = plateArg ? plateArg.slice('--plate='.length) : 'D:/AI_GAME/work/hd-packs/textures/metal_plate.png'

const archive = new Uint8Array(fs.readFileSync(archivePath))
// 机体 + 炮塔 + 色板只有 `loadUnitModel` 那一处口径（它优先用模型内嵌色板，和引擎一致）
const { model, palette } = loadUnitModel(archive, unitId, theaterName)
const unitPalette = palette ?? loadTheaterPalette(archive, theaterName, 'unit')
if (!unitPalette || model.voxels.length === 0) {
  console.error(`[单位配色] ${unitId} 读不出体素或色板`)
  process.exit(1)
}

/** 体素按色板统计：颜色 → 体素数。 */
const histogram = new Map<string, { color: [number, number, number]; count: number }>()
let total = 0
for (const voxel of model.voxels) {
  const color = paletteColor(unitPalette, voxel.colorIndex)
  const key = `${color.r},${color.g},${color.b}`
  const entry = histogram.get(key) ?? { color: [color.r, color.g, color.b] as [number, number, number], count: 0 }
  entry.count++
  histogram.set(key, entry)
  total++
}

const luminance = (color: readonly [number, number, number]): number =>
  0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]
const ranked = [...histogram.values()].sort((left, right) => right.count - left.count)
const main = ranked[0]!
const mainLum = luminance(main.color)
/** 在某个亮度区间里找出现最多的那一簇。 */
const pickWhere = (
  test: (luminance: number) => boolean,
  fallback: readonly [number, number, number],
  factor: number,
): [number, number, number] => {
  const hit = ranked.find((entry) => test(luminance(entry.color) / mainLum))
  return hit
    ? [hit.color[0], hit.color[1], hit.color[2]]
    : [fallback[0] * factor, fallback[1] * factor, fallback[2] * factor]
}

const dark = pickWhere((ratio) => ratio < 0.62, main.color, 0.5)
const darkest = pickWhere((ratio) => ratio < 0.45, dark, 0.55)
const bright = pickWhere((ratio) => ratio > 1.25, main.color, 1.45)
const lighter = pickWhere((ratio) => ratio > 1.05 && ratio <= 1.25, main.color, 1.15)
/** 识别色（红星/红带）：出现最多的"明显偏红"那一簇。 */
const accentHit = ranked.find((entry) => entry.color[0] - Math.max(entry.color[1], entry.color[2]) > 40)
const accent: [number, number, number] = accentHit
  ? [accentHit.color[0], accentHit.color[1], accentHit.color[2]]
  : [151, 0, 0]
/** 车灯/光学件：原版里最亮的偏白那一簇。 */
const opticHit = ranked.find((entry) => luminance(entry.color) > 180)
const optic: [number, number, number] = opticHit
  ? [opticHit.color[0], opticHit.color[1], opticHit.color[2]]
  : [230, 235, 200]
const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))
const scale = (color: readonly [number, number, number], factor: number): [number, number, number] => [
  clamp(color[0] * factor),
  clamp(color[1] * factor),
  clamp(color[2] * factor),
]

/** 材质名 → 原版里对应的那一簇颜色。 */
const MATERIALS: Record<string, [number, number, number]> = {
  Armor: main.color,
  ArmorLight: lighter,
  BareMetal: bright,
  TrackLink: dark,
  Rubber: darkest,
}

/** 不贴图的那几种材质（识别色/光学件）只把颜色写进 colors.json，Blender 侧按它设纯色。 */
const FLAT_COLORS: Record<string, [number, number, number]> = { Accent: accent, Optic: optic }

console.log(`[单位配色] ${unitId} @ ${theaterName}：${histogram.size} 种颜色、${total} 个体素`)
console.log(
  `  原版聚类（占比）：${ranked
    .slice(0, 6)
    .map((entry) => `rgb(${entry.color.join(',')}) ${((entry.count / total) * 100).toFixed(1)}%`)
    .join('、')}`,
)
for (const [material, color] of Object.entries(MATERIALS)) {
  console.log(`  ${material.padEnd(10)} ← rgb(${color.join(',')})`)
}
for (const [material, color] of Object.entries(FLAT_COLORS)) {
  console.log(`  ${material.padEnd(10)} ← rgb(${color.join(',')})（纯色，不贴图）`)
}

const plate = decodePngBytes(new Uint8Array(fs.readFileSync(platePath)))
fs.mkdirSync(outDir, { recursive: true })
for (const [material, color] of Object.entries(MATERIALS)) {
  // 先把金属板缩到目标边长的方图，再按"保留平均亮度的比例"染成原版那一簇颜色
  const out = new Uint8Array(SIZE * SIZE * 4)
  let luminanceSum = 0
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = Math.min(plate.width - 1, Math.floor((x / SIZE) * plate.width))
      const sy = Math.min(plate.height - 1, Math.floor((y / SIZE) * plate.height))
      const from = (sy * plate.width + sx) * 4
      const to = (y * SIZE + x) * 4
      const r = plate.pixels[from]!
      const g = plate.pixels[from + 1]!
      const b = plate.pixels[from + 2]!
      luminanceSum += 0.299 * r + 0.587 * g + 0.114 * b
      out[to] = r
      out[to + 1] = g
      out[to + 2] = b
      out[to + 3] = 255
    }
  }
  // 先把金属板压成**纯亮度**：板子自带的色偏会把成品的色相带跑（实测偏卡其金），
  // 压成灰度后逐通道乘目标色，输出色相就正好等于原版色板那一色，细节全靠亮度起伏表达。
  const mean = Math.max(16, luminanceSum / (SIZE * SIZE))
  const factor = 1 / mean
  for (let at = 0; at < out.length; at += 4) {
    const grey = 0.299 * out[at]! + 0.587 * out[at + 1]! + 0.114 * out[at + 2]!
    out[at] = clamp(grey * color[0] * factor)
    out[at + 1] = clamp(grey * color[1] * factor)
    out[at + 2] = clamp(grey * color[2] * factor)
  }
  fs.writeFileSync(`${outDir}/${material}.png`, writePng(SIZE, SIZE, out))
}
console.log(`[单位配色] ${Object.keys(MATERIALS).length} 张材质贴图 → ${outDir}`)

// 贴图材质 + 纯色材质一起写进 colors.json：Blender 侧只认这一份颜色表，不再手挑色值
const colors: Record<string, [number, number, number]> = {}
for (const [material, color] of Object.entries({ ...MATERIALS, ...FLAT_COLORS })) {
  colors[material] = [color[0] / 255, color[1] / 255, color[2] / 255]
}
fs.writeFileSync(`${outDir}/colors.json`, `${JSON.stringify(colors, null, 2)}\n`)
console.log(`[单位配色] 颜色表 → ${outDir}/colors.json`)

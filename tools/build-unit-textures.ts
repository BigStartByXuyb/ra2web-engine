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
/** 识别色系（红/橙：R 显著高于 G/B）不参与灰阶聚类——金属/履带/暗部要的是灰阶簇，
 * 红色识别标记再大再暗也会把"更暗的一簇"抢走（天启 14.2% 红被分给 BareMetal 的实例）。
 * Accent 自己仍从全量 ranked 里挑。 */
const isAccentHue = (color: readonly [number, number, number]): boolean =>
  color[0] - Math.max(color[1], color[2]) > 40
const greyRanked = ranked.filter((entry) => !isAccentHue(entry.color))
const main = (greyRanked[0] ?? ranked[0])!
const mainLum = luminance(main.color)
/** 在某个亮度区间里找出现最多的那一簇（只在灰阶簇里找）。 */
const pickWhere = (
  test: (luminance: number) => boolean,
  fallback: readonly [number, number, number],
  factor: number,
): [number, number, number] => {
  const hit = greyRanked.find((entry) => test(luminance(entry.color) / mainLum))
  return hit
    ? [hit.color[0], hit.color[1], hit.color[2]]
    : [fallback[0] * factor, fallback[1] * factor, fallback[2] * factor]
}

const dark = pickWhere((ratio) => ratio < 0.62, main.color, 0.5)
const darkest = pickWhere((ratio) => ratio < 0.45, dark, 0.55)
const bright = pickWhere((ratio) => ratio > 1.25, main.color, 1.45)
const lighter = pickWhere((ratio) => ratio > 1.05 && ratio <= 1.25, main.color, 1.15)
/**
 * 炮管/机件那类"枪铁色"：取原版里中等偏暗、又不是履带那么黑的那一簇
 * （官方图标里炮管明显比车体暗，直接用车体的亮簇会显得发白）。
 */
const gunmetal = pickWhere((ratio) => ratio >= 0.45 && ratio < 0.62, dark, 0.62)
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
  BareMetal: gunmetal,
  TrackLink: dark,
  Rubber: darkest,
}

/** 不贴图的那几种材质（识别色/光学件）只把颜色写进 colors.json，Blender 侧按它设纯色。 */
const FLAT_COLORS: Record<string, [number, number, number]> = { Accent: accent, Optic: bright }

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
  // 面板缝、铆钉、磨损：写实质感靠这些线脚。贴图按 CUBE_SIZE=64 体素铺一张：
  // 256px / 64 体素 = 4px 每体素，cell=SIZE/8 即一条缝隔 8 体素 —— 真实装甲板的尺度。
  const shade = (x: number, y: number, scale: number): void => {
    const at = ((y % SIZE) * SIZE + (x % SIZE)) * 4
    for (let channel = 0; channel < 3; channel++) out[at + channel] = clamp(out[at + channel]! * scale)
  }
  const cell = SIZE / 8
  /** 一条 1 像素宽的缝 + 沿线铆钉；`vertical` 决定方向。 */
  const seam = (position: number, vertical: boolean): void => {
    for (let step = 0; step < SIZE; step++) {
      const x = vertical ? position : step
      const y = vertical ? step : position
      shade(x, y, 0.72)
      shade(vertical ? x + 1 : x, vertical ? y : y + 1, 1.12)
      if (step % 24 === 12) {
        for (const dx of [-2, -1, 0, 1, 2]) {
          for (const dy of [-2, -1, 0, 1, 2]) {
            if (dx * dx + dy * dy > 4) continue
            shade(x + dx, y + dy, dx === 0 && dy === 0 ? 1.22 : 1.08)
          }
        }
      }
    }
  }
  for (let line = 0; line < SIZE; line += cell) {
    seam(line, true)
    seam((line + cell / 2) % SIZE, false)
  }
  /** 磨损：缝附近的划痕与掉漆，用确定性的伪随机，跑两次结果一样。 */
  let seed = 12345
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let index = 0; index < SIZE * 2; index++) {
    const x = Math.floor(random() * SIZE)
    const y = Math.floor(random() * SIZE)
    const length = 4 + Math.floor(random() * 14)
    const vertical = random() < 0.5
    const dark = random() < 0.65
    for (let step = 0; step < length; step++) {
      shade(vertical ? x : x + step, vertical ? y + step : y, dark ? 0.86 : 1.1)
    }
  }
  fs.writeFileSync(`${outDir}/${material}.png`, writePng(SIZE, SIZE, out))
}
console.log(`[单位配色] ${Object.keys(MATERIALS).length} 张材质贴图 → ${outDir}`)

// 铸造光滑面（炮塔顶那类大曲面）专用 ArmorCast：把 Armor 成品 8×8 均值压缩再双线性
// 放大，板缝/铆钉/磨损圆斑全部糊掉 —— 平铺贴图在光滑曲面上复现"凸点"的治本解。
{
  const castSource = decodePngBytes(new Uint8Array(fs.readFileSync(`${outDir}/Armor.png`)))
  const small = 32
  const scale = castSource.width / small
  const smallPixels = new Uint8Array(small * small * 4)
  for (let y = 0; y < small; y++) {
    for (let x = 0; x < small; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const from = ((y * scale + dy) * castSource.width + (x * scale + dx)) * 4
          r += castSource.pixels[from]!
          g += castSource.pixels[from + 1]!
          b += castSource.pixels[from + 2]!
        }
      }
      const count = scale * scale
      const to = (y * small + x) * 4
      smallPixels[to] = r / count
      smallPixels[to + 1] = g / count
      smallPixels[to + 2] = b / count
      smallPixels[to + 3] = 255
    }
  }
  const cast = new Uint8Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = Math.min(small - 1, (x / SIZE) * small)
      const sy = Math.min(small - 1, (y / SIZE) * small)
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(small - 1, x0 + 1)
      const y1 = Math.min(small - 1, y0 + 1)
      const fx = sx - x0
      const fy = sy - y0
      const to = (y * SIZE + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        const p00 = smallPixels[(y0 * small + x0) * 4 + channel]!
        const p10 = smallPixels[(y0 * small + x1) * 4 + channel]!
        const p01 = smallPixels[(y1 * small + x0) * 4 + channel]!
        const p11 = smallPixels[(y1 * small + x1) * 4 + channel]!
        cast[to + channel] = clamp(
          p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy,
        )
      }
      cast[to + 3] = 255
    }
  }
  fs.writeFileSync(`${outDir}/ArmorCast.png`, writePng(SIZE, SIZE, cast))
}

// 贴图材质 + 纯色材质一起写进 colors.json：Blender 侧只认这一份颜色表，不再手挑色值
const colors: Record<string, [number, number, number]> = {}
for (const [material, color] of Object.entries({ ...MATERIALS, ArmorCast: main.color, ...FLAT_COLORS })) {
  colors[material] = [color[0] / 255, color[1] / 255, color[2] / 255]
}
fs.writeFileSync(`${outDir}/colors.json`, `${JSON.stringify(colors, null, 2)}\n`)
console.log(`[单位配色] 颜色表 → ${outDir}/colors.json`)

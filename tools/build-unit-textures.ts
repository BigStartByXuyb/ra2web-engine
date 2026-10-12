import fs from 'node:fs'
import { decodePngBytes } from './png-read.js'
import { writePng } from './png-write.js'

/**
 * 生成单位模型用的材质贴图：把一张 CC0 贴图**按材质颜色染色**后缩到目标边长。
 *
 * 用法：`tsx tools/build-unit-textures.ts <源图目录> <输出目录> [边长]`
 *
 * 为什么在离线先染色：引擎的着色器是 `baseColorFactor × 贴图`，而 Blender 的
 * "贴图乘颜色再连到 Base Color" 不一定会导成 `baseColorFactor`。把颜色**烧进贴图**，
 * 导出后 factor = 1，引擎乘一次就是想要的颜色，两边口径不会跑偏。
 *
 * 输出文件名 = 材质名（`Armor.png` 一类），Blender 侧按文件名自动取用：
 * 有这张图就贴图，没有就退回原来的纯色。
 */
const [sourceDir, outDir, sizeArg] = process.argv.slice(2)
if (!sourceDir || !outDir) {
  console.error('usage: tsx tools/build-unit-textures.ts <源图目录> <输出目录> [边长]')
  process.exit(1)
}
const SIZE = Number(sizeArg ?? 512)

/** 材质名 → [源贴图文件, 目标颜色]；颜色与原版纯色 PBR 的基色一致，换材质不换配色。 */
const TARGETS: Record<string, { source: string; color: [number, number, number] }> = {
  Armor: { source: 'metal_plate.png', color: [0.3, 0.33, 0.28] },
  ArmorLight: { source: 'metal_plate.png', color: [0.39, 0.42, 0.36] },
  BareMetal: { source: 'metal_plate.png', color: [0.62, 0.63, 0.65] },
  TrackLink: { source: 'metal_plate.png', color: [0.33, 0.33, 0.35] },
  Rubber: { source: 'metal_plate.png', color: [0.11, 0.11, 0.12] },
}

fs.mkdirSync(outDir, { recursive: true })
for (const [material, target] of Object.entries(TARGETS)) {
  const path = `${sourceDir}/${target.source}`
  if (!fs.existsSync(path)) {
    console.warn(`[单位贴图] 源图不存在，跳过 ${material}：${path}`)
    continue
  }
  const source = decodePngBytes(new Uint8Array(fs.readFileSync(path)))
  // 源图缩到目标边长的方图：单位在屏幕上只有几十像素，512 已经富余
  const out = new Uint8Array(SIZE * SIZE * 4)
  let luminance = 0
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = Math.min(source.width - 1, Math.floor((x / SIZE) * source.width))
      const sy = Math.min(source.height - 1, Math.floor((y / SIZE) * source.height))
      const from = (sy * source.width + sx) * 4
      const to = (y * SIZE + x) * 4
      const r = source.pixels[from]!
      const g = source.pixels[from + 1]!
      const b = source.pixels[from + 2]!
      luminance += 0.299 * r + 0.587 * g + 0.114 * b
      out[to] = r
      out[to + 1] = g
      out[to + 2] = b
      out[to + 3] = 255
    }
  }
  // 按源图平均亮度归一：贴图整体偏暗偏亮都不会把材质的颜色带跑
  const mean = Math.max(24, luminance / (SIZE * SIZE))
  for (let at = 0; at < out.length; at += 4) {
    for (let channel = 0; channel < 3; channel++) {
      out[at + channel] = Math.min(255, Math.round((out[at + channel]! * target.color[channel]! * 255) / mean))
    }
  }
  const outPath = `${outDir}/${material}.png`
  fs.writeFileSync(outPath, writePng(SIZE, SIZE, out))
  console.log(`[单位贴图] ${material} ← ${target.source}（均值 ${mean.toFixed(0)}）→ ${outPath}`)
}

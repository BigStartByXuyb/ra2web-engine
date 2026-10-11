import fs from 'node:fs'
import zlib from 'node:zlib'
import {
  crc32,
  findMixEntry,
  hashFileName,
  paletteColor,
  readMixFile,
  readMixIndex,
  readShp,
  readVxl,
} from '@ra2web/formats'
import { loadTheaterPalette } from '@ra2web/assets'
import { FACING_COUNT, METALLIC_STYLE, positionVoxelModel, renderVoxelSprite } from '@ra2web/render'

/**
 * 把原版图形转成**真彩 PNG** 后打包成一个覆盖素材包 —— 写实/超清素材包的最小可用形态。
 *
 * 用法：
 *   tsx tools/build-png-pack.ts <RA2.MIX> <out.mix> <剧场=temperate> <建筑图形名...> [--unit=<单位ID>...]
 *
 * 说明：
 * - 建筑：取该 SHP 的第一个非空帧，按剧场**单位色板**上色，写成 `<图形名>.png`；
 * - 单位：把 `<单位>.vxl`（+炮塔）按 8 朝向渲染成一行贴条，写成 `<单位>.png`；
 *   `--scale=3` 可以让体素渲染放大（等价于更细的模型观感）。
 *
 * 这条链验证的是：**真彩 PNG 能被引擎优先取用**，于是写实素材（AI 重绘或手绘）只要
 * 按同名 + 同样的布局（建筑一整张、单位横向 8 帧）放进来就能上屏。
 */
const [archivePath, outPath, theaterName = 'temperate', ...rest] = process.argv.slice(2)
if (!archivePath || !outPath || rest.length === 0) {
  console.error(
    'usage: tsx tools/build-png-pack.ts <RA2.MIX> <out.mix> <theater> <graphic...> [--unit=HTNK] [--scale=3]',
  )
  process.exit(1)
}

const options = rest.filter((value) => value.startsWith('--'))
const names = rest.filter((value) => !value.startsWith('--'))
const unitIds = options.filter((value) => value.startsWith('--unit=')).map((value) => value.slice('--unit='.length))
const scale = Number(options.find((value) => value.startsWith('--scale='))?.slice('--scale='.length) ?? '3')
/** 高清处理倍率：>1 时对建筑贴图放大 + 锐化 + 金属调色（超清包的观感预览，不是美术素材本身） */
const hd = Number(options.find((value) => value.startsWith('--hd='))?.slice('--hd='.length) ?? '1')

const archive = new Uint8Array(fs.readFileSync(archivePath))
const palette = loadTheaterPalette(archive, theaterName, 'unit')
if (!palette) {
  console.error(`取不到 ${theaterName} 的单位色板`)
  process.exit(1)
}

const CONTAINERS = [
  'local.mix',
  'conquer.mix',
  'generic.mix',
  'isogen.mix',
  'isotemp.mix',
  'isosnow.mix',
  'isourb.mix',
  'temperat.mix',
  'snow.mix',
  'urban.mix',
  'tem.mix',
  'sno.mix',
  'urb.mix',
] as const

function find(fileName: string): Uint8Array | undefined {
  for (const container of CONTAINERS) {
    const bytes = readMixFile({ bytes: archive, fileName, containerFileName: container })
    if (bytes) return bytes
  }
  return readMixFile({ bytes: archive, fileName })
}

/** 8 位 RGBA、非隔行 PNG 写出（用 Node 的 zlib 做 deflate）。 */
function writePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgba.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1)
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'ascii')
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    let crc = 0xffffffff
    for (const byte of body) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0)
    return Buffer.concat([head, data, tail])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

const CRC_TABLE = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/**
 * 超清包观感预览用的图像处理：双线性放大 + 反锐化 + 金属调色。
 *
 * **这不是写实美术**，只是把原版贴图放大后做"更细腻 + 金属感"的处理，
 * 用来验证引擎能吃下更大、更细的贴图。真正的写实贴图要由美术或 AI 重绘产出。
 */
function enhance(
  rgba: Uint8Array,
  width: number,
  height: number,
  factor: number,
): { rgba: Uint8Array; width: number; height: number } {
  if (factor <= 1) return { rgba: gradeMetal(rgba), width, height }
  const scaled = upscaleBilinear(rgba, width, height, factor)
  return { rgba: gradeMetal(unsharp(scaled.rgba, scaled.width, scaled.height)), ...scaled }
}

function upscaleBilinear(
  rgba: Uint8Array,
  width: number,
  height: number,
  factor: number,
): { rgba: Uint8Array; width: number; height: number } {
  const outWidth = width * factor
  const outHeight = height * factor
  const out = new Uint8Array(outWidth * outHeight * 4)
  for (let y = 0; y < outHeight; y++) {
    const sourceY = Math.min(height - 1, Math.floor(y / factor))
    for (let x = 0; x < outWidth; x++) {
      const sourceX = Math.min(width - 1, Math.floor(x / factor))
      // 在源图上做 1 像素的加权平均，得到比最近邻平滑的过渡
      const left = Math.max(0, sourceX - 1)
      const right = Math.min(width - 1, sourceX + 1)
      const up = Math.max(0, sourceY - 1)
      const down = Math.min(height - 1, sourceY + 1)
      const at = (px: number, py: number) => (py * width + px) * 4
      const target = (y * outWidth + x) * 4
      for (let channel = 0; channel < 4; channel++) {
        const center = rgba[at(sourceX, sourceY) + channel]!
        const near =
          (rgba[at(left, sourceY) + channel]! +
            rgba[at(right, sourceY) + channel]! +
            rgba[at(sourceX, up) + channel]! +
            rgba[at(sourceX, down) + channel]!) /
          4
        out[target + channel] = Math.round(center * 0.6 + near * 0.4)
      }
    }
  }
  return { rgba: out, width: outWidth, height: outHeight }
}

/** 反锐化掩模：拉出边缘，放大后的贴图不至于糊。 */
function unsharp(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(rgba.length)
  const at = (x: number, y: number) =>
    (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        const center = rgba[target + channel]!
        const blur =
          (rgba[at(x - 1, y) + channel]! +
            rgba[at(x + 1, y) + channel]! +
            rgba[at(x, y - 1) + channel]! +
            rgba[at(x, y + 1) + channel]!) /
          4
        out[target + channel] = Math.max(0, Math.min(255, Math.round(center + (center - blur) * 0.8)))
      }
      out[target + 3] = rgba[target + 3]!
    }
  }
  return out
}

/** 金属调色：对比度略提、暗部偏冷蓝、亮部偏白 —— 只是预览用的风格化。 */
function gradeMetal(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length)
  for (let index = 0; index < rgba.length; index += 4) {
    if (rgba[index + 3] === 0) continue
    const r = rgba[index]!
    const g = rgba[index + 1]!
    const b = rgba[index + 2]!
    const luminance = (r * 0.3 + g * 0.59 + b * 0.11) / 255
    const contrast = 1.14
    const cool = (1 - luminance) * 0.16
    out[index] = clampChannel((r - 128) * contrast + 128 - cool * 18)
    out[index + 1] = clampChannel((g - 128) * contrast + 128 - cool * 8)
    out[index + 2] = clampChannel((b - 128) * contrast + 128 + cool * 26 + luminance * 10)
    out[index + 3] = rgba[index + 3]!
  }
  return out
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

/** 建筑：SHP 第一个非空帧 → 按色板上色 → 真彩 PNG。 */
function structurePng(graphicName: string): Uint8Array | undefined {
  for (const candidate of [`${graphicName}.shp`, `${graphicName}.tem`, `${graphicName}.sno`, `${graphicName}.urb`]) {
    const bytes = find(candidate)
    if (!bytes) continue
    const shp = readShp(bytes)
    const frame = shp.frames.find((item) => !item.isEmpty)
    if (!frame) continue
    const rgba = new Uint8Array(frame.width * frame.height * 4)
    for (let index = 0; index < frame.pixels.length; index++) {
      const colorIndex = frame.pixels[index]!
      if (colorIndex === 0) continue
      const color = paletteColor(palette!, colorIndex)
      const at = index * 4
      rgba[at] = color.r
      rgba[at + 1] = color.g
      rgba[at + 2] = color.b
      rgba[at + 3] = 255
    }
    const enhanced = enhance(rgba, frame.width, frame.height, Math.max(1, Math.round(hd)))
    console.log(
      `${candidate} → ${graphicName}.png（${frame.width}×${frame.height}${hd > 1 ? ` → ${enhanced.width}×${enhanced.height}` : ''}）`,
    )
    return writePng(enhanced.width, enhanced.height, enhanced.rgba)
  }
  return undefined
}

/** 单位：VXL 按 8 朝向渲染 → 横向贴条 PNG。 */
function unitSheet(unitId: string): Uint8Array | undefined {
  const bodyBytes = find(`${unitId.toLowerCase()}.vxl`)
  if (!bodyBytes) return undefined
  const models = [readVxl(bodyBytes)]
  const turretBytes = find(`${unitId.toLowerCase()}tur.vxl`)
  if (turretBytes) models.push(readVxl(turretBytes))
  const model = positionVoxelModel(models)
  const sprites = Array.from({ length: FACING_COUNT }, (_unused, facing) =>
    renderVoxelSprite(model, {
      facing,
      pixelsPerVoxel: Math.max(1, Math.round(scale)),
      paddingInVoxels: 1,
      // 超清档给体素加金属光泽（引擎的着色模型，和素材无关）
      ...(hd > 1 ? { shading: METALLIC_STYLE } : {}),
    }),
  )
  const frameSize = Math.max(...sprites.map((sprite) => Math.max(sprite.width, sprite.height)))
  const rgba = new Uint8Array(frameSize * FACING_COUNT * frameSize * 4)
  sprites.forEach((sprite, index) => {
    const offsetX = index * frameSize + Math.round((frameSize - sprite.width) / 2)
    const offsetY = frameSize - sprite.height
    for (let y = 0; y < sprite.height; y++) {
      for (let x = 0; x < sprite.width; x++) {
        const from = (y * sprite.width + x) * 4
        if (sprite.rgba[from + 3] === 0) continue
        const to = ((offsetY + y) * frameSize * FACING_COUNT + offsetX + x) * 4
        rgba[to] = sprite.rgba[from]!
        rgba[to + 1] = sprite.rgba[from + 1]!
        rgba[to + 2] = sprite.rgba[from + 2]!
        rgba[to + 3] = 255
      }
    }
  })
  const enhanced =
    hd > 1
      ? { rgba: gradeMetal(rgba), width: frameSize * FACING_COUNT, height: frameSize }
      : { rgba, width: frameSize * FACING_COUNT, height: frameSize }
  console.log(`${unitId}.vxl → ${unitId}.png（8 帧 × ${frameSize}×${frameSize}）`)
  return writePng(enhanced.width, enhanced.height, enhanced.rgba)
}

/** 明文头 MIX：u16 条目数 + u32 数据区长度 + 条目表 + 数据区。 */
function writeMix(entries: ReadonlyArray<{ name: string; data: Uint8Array }>): Uint8Array {
  const tableBytes = 6 + entries.length * 12
  const dataSize = entries.reduce((total, entry) => total + entry.data.length, 0)
  const bytes = new Uint8Array(tableBytes + dataSize)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, entries.length, true)
  view.setUint32(2, dataSize, true)
  let offset = 0
  entries.forEach((entry, index) => {
    const at = 6 + index * 12
    view.setUint32(at, hashFileName(entry.name, crc32), true)
    view.setUint32(at + 4, offset, true)
    view.setUint32(at + 8, entry.data.length, true)
    bytes.set(entry.data, tableBytes + offset)
    offset += entry.data.length
  })
  return bytes
}

const packed: Array<{ name: string; data: Uint8Array }> = []
for (const name of names) {
  const png = structurePng(name)
  if (png) packed.push({ name: `${name.toLowerCase()}.png`, data: png })
}
for (const unitId of unitIds) {
  const png = unitSheet(unitId)
  if (png) packed.push({ name: `${unitId.toLowerCase()}.png`, data: png })
}
if (packed.length === 0) {
  console.error('没有生成任何 PNG')
  process.exit(1)
}
const mix = writeMix(packed)
fs.writeFileSync(outPath, mix)
const index = readMixIndex(mix)
const ok = packed.every((entry) => findMixEntry(index, entry.name, crc32) !== undefined)
console.log(`${outPath}：${packed.length} 张 PNG、${mix.length} 字节，索引自检${ok ? '通过' : '失败'}`)

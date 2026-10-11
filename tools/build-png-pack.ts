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
import { FACING_COUNT, positionVoxelModel, renderVoxelSprite } from '@ra2web/render'

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
    console.log(`${candidate} → ${graphicName}.png（${frame.width}×${frame.height}）`)
    return writePng(frame.width, frame.height, rgba)
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
    renderVoxelSprite(model, { facing, pixelsPerVoxel: Math.max(1, Math.round(scale)), paddingInVoxels: 1 }),
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
  console.log(`${unitId}.vxl → ${unitId}.png（8 帧 × ${frameSize}×${frameSize}）`)
  return writePng(frameSize * FACING_COUNT, frameSize, rgba)
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

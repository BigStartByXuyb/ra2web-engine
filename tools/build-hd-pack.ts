import fs from 'node:fs'
import { crc32, findMixEntry, hashFileName, readMixFile, readMixIndex, readShp, type ShpFile } from '@ra2web/formats'

/**
 * 从原版档案里挑几个图形，放大若干倍（最近邻）后打包成一个**覆盖素材包**（明文头 MIX）。
 *
 * 用法：tsx tools/build-hd-pack.ts <RA2.MIX> <输出.mix> <倍数> <文件名...>
 * 例：  tsx tools/build-hd-pack.ts "…\RA2.MIX" hd-sample.mix 3 natsla.shp
 *
 * 这个包是给引擎的"素材覆盖层"用的样例：验证"把替换图形放进自己的 MIX 里，引擎优先命中"。
 * 真正写实/超清的素材由美术（或 AI 重绘）产出，规格与这里一致 —— 同一个文件名、任意更大的尺寸、
 * 帧的 x/y 偏移按同一比例放大即可（引擎按图形的整幅画布与地基对齐，不看固定尺寸）。
 */
const [archivePath, outPath, scaleText, ...fileNames] = process.argv.slice(2)
if (!archivePath || !outPath || !scaleText || fileNames.length === 0) {
  console.error('usage: tsx tools/build-hd-pack.ts <RA2.MIX> <out.mix> <scale> <file...>')
  process.exit(1)
}
const scale = Math.max(1, Math.round(Number(scaleText)))
const archive = new Uint8Array(fs.readFileSync(archivePath))

/** 原版里图形可能落在内嵌包里，逐个容器试一遍。 */
const CONTAINERS = [
  undefined,
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

function readOriginal(fileName: string): Uint8Array | undefined {
  for (const container of CONTAINERS) {
    const bytes = container
      ? readMixFile({ bytes: archive, fileName, containerFileName: container })
      : readMixFile({ bytes: archive, fileName })
    if (bytes) {
      console.log(`${fileName} ← ${container ?? '(根)'}`)
      return bytes
    }
  }
  return undefined
}

/** 最近邻放大一整张 SHP：帧偏移与整幅画布同比例放大。 */
function upscaleShp(shp: ShpFile, factor: number): Uint8Array {
  const frames = shp.frames.map((frame) => ({
    x: frame.x * factor,
    y: frame.y * factor,
    width: frame.width * factor,
    height: frame.height * factor,
    pixels: upscalePixels(frame.pixels, frame.width, frame.height, factor),
  }))
  const headerBytes = 8 + frames.length * 24
  const dataBytes = frames.reduce((total, frame) => total + frame.pixels.length, 0)
  const bytes = new Uint8Array(headerBytes + dataBytes)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0, true)
  view.setUint16(2, shp.width * factor, true)
  view.setUint16(4, shp.height * factor, true)
  view.setUint16(6, frames.length, true)
  let offset = headerBytes
  frames.forEach((frame, index) => {
    const at = 8 + index * 24
    view.setInt16(at, frame.x, true)
    view.setInt16(at + 2, frame.y, true)
    view.setInt16(at + 4, frame.width, true)
    view.setInt16(at + 6, frame.height, true)
    view.setUint8(at + 8, 0) // compressionType 0：原样宽×高字节
    view.setInt32(at + 16, offset, true)
    bytes.set(frame.pixels, offset)
    offset += frame.pixels.length
  })
  return bytes
}

function upscalePixels(pixels: Uint8Array, width: number, height: number, factor: number): Uint8Array {
  if (width === 0 || height === 0) return new Uint8Array(0)
  const out = new Uint8Array(width * factor * height * factor)
  for (let y = 0; y < height * factor; y++) {
    for (let x = 0; x < width * factor; x++) {
      out[y * width * factor + x] = pixels[Math.floor(y / factor) * width + Math.floor(x / factor)]!
    }
  }
  return out
}

/** 明文头 MIX 写出：u16 条目数 + u32 数据区长度 + 条目表 + 数据区。 */
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
for (const fileName of fileNames) {
  const original = readOriginal(fileName)
  if (!original) {
    console.error(`档案里没有 ${fileName}，跳过`)
    continue
  }
  packed.push({ name: fileName, data: upscaleShp(readShp(original), scale) })
}
if (packed.length === 0) {
  console.error('没有可打包的文件')
  process.exit(1)
}

const mix = writeMix(packed)
fs.writeFileSync(outPath, mix)
const index = readMixIndex(mix)
const verify = packed.every((entry) => findMixEntry(index, entry.name, crc32) !== undefined)
console.log(
  `${outPath}：${packed.length} 个文件、${mix.length} 字节、${scale}× 放大，索引自检${verify ? '通过' : '失败'}`,
)

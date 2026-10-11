import fs from 'node:fs'
import zlib from 'node:zlib'
import { crc32, findMixEntry, hashFileName, readMixIndex } from '@ra2web/formats'

/**
 * 程序化绘制写实感贴图并打包成覆盖素材包 —— 不依赖任何图像模型，纯代码画。
 *
 * 用法：tsx tools/draw-sprite.ts <out.mix>
 *
 * 用的是等距视角约定：右下方 (−x 方向) 的两个面比左上方暗、朝上的面最亮，
 * 高光按"金属圆柱/球体"的方式上，边缘给 1 像素描边避免与地图糊在一起。
 * 这张图是**手写几何**（圆、锥、柱、渐变），不是从原版像素放大的。
 */

type Rgba = [number, number, number, number]

const CRC_TABLE = (() => {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

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

/** 极简画布：只做本工具要用的几件事（带 alpha 混合的像素写入）。 */
class Canvas {
  readonly pixels: Uint8Array
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8Array(width * height * 4)
  }

  blend(x: number, y: number, color: Rgba, coverage = 1): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || coverage <= 0) return
    const at = (y * this.width + x) * 4
    const alpha = (color[3] / 255) * Math.min(1, coverage)
    for (let channel = 0; channel < 3; channel++) {
      const existing = this.pixels[at + channel]!
      this.pixels[at + channel] = Math.round(existing * (1 - alpha) + color[channel]! * alpha)
    }
    this.pixels[at + 3] = Math.min(255, Math.round(this.pixels[at + 3]! + alpha * 255))
  }

  /** 椭圆填充；`shade` 按归一化的相对位置给出该点颜色。 */
  ellipse(cx: number, cy: number, rx: number, ry: number, shade: (nx: number, ny: number, edge: number) => Rgba): void {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const nx = (x + 0.5 - cx) / rx
        const ny = (y + 0.5 - cy) / ry
        const distance = Math.hypot(nx, ny)
        if (distance > 1.05) continue
        // 边缘 1 像素做抗锯齿：距离在 0.95..1.05 之间按比例降低覆盖
        const coverage = distance <= 0.95 ? 1 : Math.max(0, (1.05 - distance) / 0.1)
        this.blend(x, y, shade(nx, ny, Math.max(0, distance)), coverage)
      }
    }
  }

  rect(x0: number, y0: number, x1: number, y1: number, shade: (nx: number, ny: number) => Rgba): void {
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        const coverageX = Math.min(1, Math.min(x + 1, x1) - Math.max(x, x0))
        const coverageY = Math.min(1, Math.min(y + 1, y1) - Math.max(y, y0))
        if (coverageX <= 0 || coverageY <= 0) continue
        this.blend(x, y, shade((x + 0.5 - x0) / (x1 - x0), (y + 0.5 - y0) / (y1 - y0)), coverageX * coverageY)
      }
    }
  }
}

function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round(a[3] + (b[3] - a[3]) * t),
  ]
}

const STEEL_DARK: Rgba = [46, 50, 56, 255]
const STEEL_MID: Rgba = [96, 104, 112, 255]
const STEEL_LIGHT: Rgba = [168, 178, 188, 255]
const SOVIET_RED: Rgba = [150, 26, 24, 255]
const RED_LIGHT: Rgba = [200, 60, 48, 255]
const SNOW: Rgba = [226, 233, 240, 255]
const OUTLINE: Rgba = [22, 24, 28, 210]

/** 金属圆柱的一段：左亮右暗，并按高度做明暗渐变。 */
function metalBand(canvas: Canvas, cx: number, cy: number, rx: number, ry: number, top: number, bottom: number): void {
  canvas.ellipse(cx, cy, rx, ry, (nx, ny) => {
    const radial = Math.max(0, 1 - Math.abs(nx))
    const light = 0.25 + radial * 0.75
    const base = mix(STEEL_DARK, STEEL_LIGHT, Math.min(1, light))
    void ny
    void top
    void bottom
    return base
  })
}

/** 磁暴线圈：底座 + 收锥塔身 + 球顶 + 四角红基座。 */
function drawTeslaCoil(): { width: number; height: number; rgba: Uint8Array } {
  const width = 132
  const height = 208
  const canvas = new Canvas(width, height)
  const cx = width / 2

  // 地面接触阴影（等距视角下是个扁椭圆）
  canvas.ellipse(cx, height - 12, 46, 12, () => [10, 12, 16, 90])

  // 四角红色基座：等距方向上左右各两个
  const pads: Array<[number, number]> = [
    [cx - 40, height - 22],
    [cx + 40, height - 22],
    [cx - 26, height - 8],
    [cx + 26, height - 8],
  ]
  for (const [px, py] of pads) {
    canvas.rect(px - 11, py - 20, px + 11, py, (nx, ny) =>
      nx < 0.5 ? mix(RED_LIGHT, SOVIET_RED, ny) : mix(SOVIET_RED, STEEL_DARK, ny * 0.7),
    )
    canvas.rect(px - 11, py - 22, px + 11, py - 19, () => mix(STEEL_LIGHT, RED_LIGHT, 0.35))
  }

  // 底座（八角水泥台）
  canvas.ellipse(cx, height - 26, 34, 14, (nx, ny) => {
    void ny
    const light = 0.3 + Math.max(0, 1 - Math.abs(nx)) * 0.5
    return mix(STEEL_DARK, STEEL_MID, light)
  })
  canvas.ellipse(cx, height - 34, 34, 14, (nx, ny) => {
    void ny
    return mix(STEEL_MID, STEEL_LIGHT, 0.25 + Math.max(0, 1 - Math.abs(nx)) * 0.55)
  })
  // 顶上一点雪
  canvas.ellipse(cx, height - 40, 20, 7, () => mix(SNOW, STEEL_LIGHT, 0.15))

  // 塔身：从下往上收锥，用一串圆台叠出来
  const bands = 26
  for (let index = 0; index < bands; index++) {
    const t = index / (bands - 1)
    const y = height - 46 - t * 108
    const radius = 15 * (1 - t * 0.72)
    metalBand(canvas, cx, y, radius, radius * 0.42, 0, 0)
  }

  // 顶部球体：金属球 + 左上高光
  canvas.ellipse(cx, 52, 24, 24, (nx, ny) => {
    const light = Math.max(0, 1 - Math.hypot(nx + 0.45, ny + 0.5))
    const base = mix(mix(STEEL_MID, STEEL_LIGHT, 0.35), [245, 250, 255, 255], Math.min(1, light * 1.15))
    return base
  })
  canvas.ellipse(cx - 8, 44, 7, 6, () => [250, 253, 255, 220])

  // 描边：把不透明像素的边界压一圈深色，避免糊在地图上
  outline(canvas, OUTLINE)
  return { width, height, rgba: canvas.pixels }
}

/** 把不透明区域的边界压一圈深色。 */
function outline(canvas: Canvas, color: Rgba): void {
  const copy = canvas.pixels.slice()
  const alphaAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= canvas.width || y >= canvas.height ? 0 : copy[(y * canvas.width + x) * 4 + 3]!
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const at = (y * canvas.width + x) * 4
      if (copy[at + 3] === 0) continue
      const isEdge =
        copy[((y - 1) * canvas.width + x) * 4 + 3] === undefined ||
        alphaAt(x - 1, y) < 40 ||
        alphaAt(x + 1, y) < 40 ||
        alphaAt(x, y - 1) < 40 ||
        alphaAt(x, y + 1) < 40
      if (isEdge) canvas.blend(x, y, color, 0.55)
    }
  }
}

/** 岗哨/雷达站：水泥方体 + 天线盘，用来看"方块建筑"这条画法。 */
function drawRadarStation(): { width: number; height: number; rgba: Uint8Array } {
  const width = 150
  const height = 176
  const canvas = new Canvas(width, height)
  const cx = width / 2
  canvas.ellipse(cx, height - 10, 52, 12, () => [10, 12, 16, 80])

  // 主体：等距方盒（顶面亮、左面中、右面暗）
  const topY = 52
  const bottomY = height - 24
  canvas.rect(cx - 46, topY, cx, bottomY, (nx, ny) =>
    mix(mix(STEEL_MID, STEEL_LIGHT, 0.5), STEEL_DARK, ny * 0.55 + (nx > 0.5 ? 0 : 0)),
  )
  canvas.rect(cx, topY + 14, cx + 46, bottomY + 14, (nx, ny) =>
    mix(mix(STEEL_DARK, STEEL_MID, 0.4), [26, 28, 32, 255], ny * 0.6),
  )
  canvas.rect(cx - 46, topY, cx + 46, topY + 14, () => mix(STEEL_LIGHT, [236, 242, 248, 255], 0.35))

  // 顶面设备：一小段管道 + 一个碟形天线
  canvas.rect(cx - 18, topY - 10, cx + 6, topY + 2, (nx) => mix(STEEL_MID, STEEL_LIGHT, 1 - nx))
  canvas.ellipse(cx + 18, topY - 16, 20, 11, (nx, ny) => {
    const light = Math.max(0, 1 - Math.hypot(nx + 0.3, ny + 0.4))
    return mix(STEEL_MID, [240, 246, 252, 255], Math.min(1, light))
  })
  canvas.rect(cx + 15, topY - 12, cx + 21, topY + 6, () => mix(STEEL_DARK, STEEL_MID, 0.5))

  // 红色警示条
  canvas.rect(cx - 46, bottomY - 16, cx, bottomY - 6, () => SOVIET_RED)
  canvas.rect(cx, bottomY + 0, cx + 46, bottomY + 10, () => mix(SOVIET_RED, STEEL_DARK, 0.45))

  outline(canvas, OUTLINE)
  return { width, height, rgba: canvas.pixels }
}

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

const outPath = process.argv[2]
if (!outPath) {
  console.error('usage: tsx tools/draw-sprite.ts <out.mix>')
  process.exit(1)
}

const coil = drawTeslaCoil()
const radar = drawRadarStation()
const archiveBytes = writeMix([
  { name: 'natsla.png', data: writePng(coil.width, coil.height, coil.rgba) },
  { name: 'naradr.png', data: writePng(radar.width, radar.height, radar.rgba) },
])
fs.writeFileSync(outPath, archiveBytes)
const index = readMixIndex(archiveBytes)
const ok = ['natsla.png', 'naradr.png'].every((name) => findMixEntry(index, name, crc32) !== undefined)
console.log(
  `${outPath}：磁暴线圈 ${coil.width}×${coil.height}、雷达站 ${radar.width}×${radar.height}，` +
    `${archiveBytes.length} 字节，索引自检${ok ? '通过' : '失败'}`,
)

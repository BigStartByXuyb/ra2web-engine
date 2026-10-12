import zlib from 'node:zlib'

/**
 * 极简 PNG 读取：支持 8/16bit 的 RGB/RGBA、非隔行（浏览器截图是 8bit，CC0 素材常是 16bit）。
 * 16bit 取高字节 —— 地表贴图只要 8bit 精度，缩到 8bit 就够了。
 * 供命令行工具与 UI 测试共用；换算与写出的对应件是 `png-write.ts`。
 */

export interface PngImage {
  readonly width: number
  readonly height: number
  /** RGBA，长度 = width×height×4 */
  readonly pixels: Uint8Array
}

export function decodePngBytes(bytes: Uint8Array): PngImage {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  let bitDepth = 0
  const chunks: Buffer[] = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]!
      if (bitDepth !== 8 && bitDepth !== 16) throw new Error(`只支持 8/16bit PNG，收到 ${bitDepth}`)
      colorType = data[9]!
      if (data[12] !== 0) throw new Error('不支持隔行 PNG')
    } else if (type === 'IDAT') {
      chunks.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += length + 12
  }
  const samples = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (samples === 0) throw new Error(`只支持 RGBA/RGB PNG，colorType=${colorType}`)
  const bytesPerSample = bitDepth / 8
  const channels = samples * bytesPerSample

  const raw = zlib.inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const pixels = new Uint8Array(width * height * 4)
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride))
    for (let index = 0; index < stride; index++) {
      const left = index >= channels ? line[index - channels]! : 0
      const up = previous[index]!
      const upLeft = index >= channels ? previous[index - channels]! : 0
      const value = line[index]!
      line[index] =
        filter === 0
          ? value
          : filter === 1
            ? (value + left) & 0xff
            : filter === 2
              ? (value + up) & 0xff
              : filter === 3
                ? (value + ((left + up) >> 1)) & 0xff
                : (value + paeth(left, up, upLeft)) & 0xff
    }
    for (let x = 0; x < width; x++) {
      const from = x * channels
      const to = (y * width + x) * 4
      const step = bytesPerSample
      pixels[to] = line[from]!
      pixels[to + 1] = line[from + step]!
      pixels[to + 2] = line[from + 2 * step]!
      pixels[to + 3] = samples === 4 ? line[from + 3 * step]! : 255
    }
    previous = line
  }
  return { width, height, pixels }
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const toLeft = Math.abs(estimate - left)
  const toUp = Math.abs(estimate - up)
  const toUpLeft = Math.abs(estimate - upLeft)
  return toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft
}

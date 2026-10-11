import fs from 'node:fs'
import zlib from 'node:zlib'

/** 一张 8bit RGBA/RGB、非隔行 PNG 的裸像素（浏览器截图的格式）。 */
export interface PngImage {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8Array
}

export function decodePng(filePath: string): PngImage {
  const buffer = fs.readFileSync(filePath)
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const chunks: Buffer[] = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8) throw new Error(`只支持 8bit PNG，收到 ${data[8]}`)
      colorType = data[9]!
      if (data[12] !== 0) throw new Error('不支持隔行 PNG')
    } else if (type === 'IDAT') {
      chunks.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += length + 12
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (channels === 0) throw new Error(`只支持 RGBA/RGB PNG，colorType=${colorType}`)

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
      pixels[to] = line[from]!
      pixels[to + 1] = line[from + 1]!
      pixels[to + 2] = line[from + 2]!
      pixels[to + 3] = channels === 4 ? line[from + 3]! : 255
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

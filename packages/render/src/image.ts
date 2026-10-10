/** 像素缓冲的最小公共件：填充与拷贝只管字节，不认识体素或精灵。 */

export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

export interface RgbaImage {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

export function fillImage(bytes: Uint8Array, color: Rgba): void {
  for (let at = 0; at < bytes.length; at += 4) {
    bytes[at] = color.r
    bytes[at + 1] = color.g
    bytes[at + 2] = color.b
    bytes[at + 3] = color.a
  }
}

/** 把整张源图拷贝到目标图的 (atX, atY)；越界部分直接丢弃。 */
export function blitImage(destination: RgbaImage, source: RgbaImage, atX: number, atY: number): void {
  for (let y = 0; y < source.height; y++) {
    const targetY = y + atY
    if (targetY < 0 || targetY >= destination.height) continue
    const rowStart = y * source.width * 4
    destination.rgba.set(
      source.rgba.subarray(rowStart, rowStart + source.width * 4),
      (targetY * destination.width + atX) * 4,
    )
  }
}

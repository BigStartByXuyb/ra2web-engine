import { TruncatedInputError } from './errors.js'

/**
 * PAL 调色板：768 字节 = 256 色 × RGB。
 *
 * 原版调色板分量是 6 位（0..63），需要左移 2 位还原成 8 位；但也有已经是 8 位的文件，
 * 因此按"全体分量最大值 ≤ 63"来判定，这是原版素材的实际情形。
 */

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

export interface Palette {
  readonly colors: readonly Rgb[]
}

export const PALETTE_COLORS = 256
export const PALETTE_BYTES = PALETTE_COLORS * 3

export function readPalette(bytes: Uint8Array): Palette {
  if (bytes.byteLength < PALETTE_BYTES) throw new TruncatedInputError(PALETTE_BYTES, 0)
  const colors: Rgb[] = []
  let maxComponent = 0
  for (let i = 0; i < PALETTE_BYTES; i += 3) {
    const r = bytes[i]!
    const g = bytes[i + 1]!
    const b = bytes[i + 2]!
    maxComponent = Math.max(maxComponent, r, g, b)
    colors.push({ r, g, b })
  }
  if (maxComponent > 63) return { colors }
  return { colors: colors.map((color) => ({ r: color.r * 4, g: color.g * 4, b: color.b * 4 })) }
}

/** 取某索引的颜色；越界返回黑色，便于渲染器直接使用。 */
export function paletteColor(palette: Palette, index: number): Rgb {
  return palette.colors[index] ?? { r: 0, g: 0, b: 0 }
}

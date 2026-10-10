import { ParseError, TruncatedInputError } from './errors.js'

/**
 * TMP 地块读取（`.tmp`，等距地形图块）。
 *
 * 布局（已用真实档案核实，见 `docs/ENGINE-MAP.md`）：
 *
 *   i32 x, y          —— 地块覆盖的格子数（1×1、2×2、7×4…）
 *   i32 cx, cy        —— 每格的像素尺寸（60×30）
 *   i32 offset[x*y]   —— 各子块相对文件起点的偏移
 *
 * 每个子块：
 *
 *   i32 pixelX, pixelY —— 该格在图块内的像素位置（可为负：等距斜向排布）
 *   u32 size           —— 子块字节数（含这 16 字节头）
 *   u32 reserved       —— 待核对（实测恒为该值，且与像素数/2 相差固定）
 *   u8  pixels[cx*cy]  —— 调色板索引，0 表示透明
 *   …余下 `size − 16 − cx*cy` 字节 —— 待核对（实测 36 字节/子块）
 *
 * 判定依据：把 7×4 地块的 28 个子块按各自 pixelX/pixelY 贴到大图上，能拼成连贯的等距地形
 * （透明区正好落在地块轮廓外），且所有子块偏移严格等差（= 子块字节数）。
 */

const SUB_TILE_HEADER_BYTES = 16

export interface TmpSubTile {
  /** 该格在图块内的像素位置（相对左上角，可为负） */
  readonly pixelX: number
  readonly pixelY: number
  /** 子块字节数（含 16 字节头） */
  readonly size: number
  /** 待核对字段（实测为常量） */
  readonly reserved: number
  /** 调色板索引，长度 = cx×cy */
  readonly pixels: Uint8Array
  /** 像素之后的剩余字节（待核对用途） */
  readonly trailing: Uint8Array
}

export interface TmpFile {
  readonly cellsX: number
  readonly cellsY: number
  readonly cellWidth: number
  readonly cellHeight: number
  readonly subTiles: readonly TmpSubTile[]
}

export function readTmp(bytes: Uint8Array): TmpFile {
  if (bytes.byteLength < 16) throw new TruncatedInputError(16, 0)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const cellsX = view.getInt32(0, true)
  const cellsY = view.getInt32(4, true)
  const cellWidth = view.getInt32(8, true)
  const cellHeight = view.getInt32(12, true)
  if (cellsX <= 0 || cellsY <= 0 || cellWidth <= 0 || cellHeight <= 0) {
    throw new ParseError(`TMP 头部不合理：${cellsX}×${cellsY} 格、${cellWidth}×${cellHeight} 像素`, 0)
  }

  const count = cellsX * cellsY
  const pixelsPerCell = cellWidth * cellHeight
  if (bytes.byteLength < SUB_TILE_HEADER_BYTES + count * 4) {
    throw new TruncatedInputError(SUB_TILE_HEADER_BYTES + count * 4, bytes.byteLength)
  }

  const subTiles: TmpSubTile[] = []
  for (let index = 0; index < count; index++) {
    const at = view.getInt32(SUB_TILE_HEADER_BYTES + index * 4, true)
    if (at < 0 || at + SUB_TILE_HEADER_BYTES > bytes.byteLength) {
      throw new TruncatedInputError(at + SUB_TILE_HEADER_BYTES, bytes.byteLength)
    }
    const header = new DataView(bytes.buffer, bytes.byteOffset + at, bytes.byteLength - at)
    const size = header.getUint32(8, true)
    if (size < SUB_TILE_HEADER_BYTES + pixelsPerCell || at + size > bytes.byteLength) {
      throw new ParseError(`子块 ${index} 长度不合理：size=${size} @${at}`, at)
    }
    subTiles.push({
      pixelX: header.getInt32(0, true),
      pixelY: header.getInt32(4, true),
      size,
      reserved: header.getUint32(12, true),
      pixels: bytes.subarray(at + SUB_TILE_HEADER_BYTES, at + SUB_TILE_HEADER_BYTES + pixelsPerCell),
      trailing: bytes.subarray(at + SUB_TILE_HEADER_BYTES + pixelsPerCell, at + size),
    })
  }

  return { cellsX, cellsY, cellWidth, cellHeight, subTiles }
}

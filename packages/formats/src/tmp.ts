import { ParseError, TruncatedInputError } from './errors.js'

/**
 * TMP 地块读取（`.tmp`，等距地形图块）。
 *
 * 布局（已用真实档案 + 客户端实现双向核实，见 `docs/ENGINE-MAP.md`）：
 *
 *   i32 cellsX, cellsY        —— 地块覆盖的格子数（1×1、2×3、7×4…）
 *   i32 cellWidth, cellHeight —— 每格的像素尺寸（60×30）
 *   i32 offset[cellsX*cellsY] —— 各子块相对文件起点的偏移，0 表示该格没有图形
 *
 * 每个子块的头 52 字节：
 *
 *   0  i32 pixelX, pixelY   —— 该格在图块内的像素位置（等距斜向，可为负）
 *   8  u32 size             —— 像素 + z 数据的总字节数（含这 52 字节头）
 *   12 u32 imageDataEnd     —— 像素区结束位置（= 52 + 像素数）
 *   16 i32 extraDataOffset  —— 第二份额外数据的块内偏移；无额外数据时是未初始化残留
 *   20 i32 extraX, extraY, extraWidth, extraHeight —— 额外数据的位置与格数
 *   36 u32 flags            —— bit0 有额外数据、bit1 有 z 数据
 *   40 u8  height, terrainType, rampType
 *   43 i8  radarLeft[3] / radarRight[3] —— 雷达图上的两种颜色
 *   49 u8  padding[3]
 *   52 u8  pixels[cellWidth*cellHeight/2]  —— 调色板索引，0 表示透明
 *      u8  zData[cellWidth*cellHeight/2]   —— 有则紧随像素，当 flags bit1（`size` 到此为止）
 *      u8  extraData[|extraWidth*extraHeight|] ×2 —— 再随后是同一份额外数据的两份拷贝
 *
 * `size` 不含额外数据；额外数据的两份拷贝由 `extraDataOffset` 分隔，本函数不读它们。
 *
 * 像素只存菱形覆盖的部分（矩形的一半），逐行排布，行宽变化见 `tmpTileRows`。
 */

const HEADER_BYTES = 16
const BLOCK_HEADER_BYTES = 52
/** `flags` 的 bit1：像素之后还有一份 z 数据（已被 `size` 计入）。 */
const FLAG_Z_DATA = 0x2
/** 等距菱形每下行 4 像素的变化步长。 */
const ROW_WIDTH_STEP = 4
/** 像素总数与"格宽 × 格高"的比例：菱形只占矩形的半边。 */
const PIXEL_COUNT_DIVISOR = 2

export interface TmpRow {
  /** 该行在格内的纵坐标 */
  readonly y: number
  /** 该行起始像素的横坐标 */
  readonly x: number
  /** 该行的像素数 */
  readonly width: number
}

/**
 * 菱形像素的行布局：上半每行比上一行宽 4 像素、起点左移 2，下半对称收缩。
 *
 * 调用方按 (cellWidth, cellHeight) 记忆化，同一剧场里所有地块共用一份。
 */
export function tmpTileRows(cellWidth: number, cellHeight: number): readonly TmpRow[] {
  const rows: TmpRow[] = []
  const half = cellHeight / 2
  let width = 0
  let x = cellWidth / 2 - 2
  for (let y = 0; y < half; y++) {
    width += ROW_WIDTH_STEP
    rows.push({ y, x, width })
    x -= ROW_WIDTH_STEP / 2
  }
  x = ROW_WIDTH_STEP / 2
  width -= ROW_WIDTH_STEP
  for (let y = half; y < cellHeight; y++) {
    rows.push({ y, x, width })
    x += ROW_WIDTH_STEP / 2
    width -= ROW_WIDTH_STEP
  }
  return rows
}

export interface TmpSubTile {
  /** 该格在图块内的像素位置（相对左上角，可为负） */
  readonly pixelX: number
  readonly pixelY: number
  /** 整块字节数（含 52 字节头） */
  readonly size: number
  /** `flags` 原始值：bit0 有额外数据、bit1 有 z 数据 */
  readonly flags: number
  /** 该格的地面高度档位（原版用它算崖壁高度） */
  readonly height: number
  /** 地形类型编号（0 普通、1 水、2 坡道…，原版按它决定通行与外观） */
  readonly terrainType: number
  /** 坡道类型：0 不是坡道，非 0 表示这一格是斜坡 */
  readonly rampType: number
  /** 菱形像素，长度 = cellWidth×cellHeight/2；0 表示透明 */
  readonly pixels: Uint8Array
  /** 该槽位是否有图形（多格图块里允许为空） */
  readonly isEmpty: boolean
}

export interface TmpFile {
  readonly cellsX: number
  readonly cellsY: number
  readonly cellWidth: number
  readonly cellHeight: number
  readonly subTiles: readonly TmpSubTile[]
}

const EMPTY_SUB_TILE: TmpSubTile = {
  pixelX: 0,
  pixelY: 0,
  size: 0,
  flags: 0,
  height: 0,
  terrainType: 0,
  rampType: 0,
  pixels: new Uint8Array(0),
  isEmpty: true,
}

export function readTmp(bytes: Uint8Array): TmpFile {
  if (bytes.byteLength < HEADER_BYTES) throw new TruncatedInputError(HEADER_BYTES, 0)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const cellsX = view.getInt32(0, true)
  const cellsY = view.getInt32(4, true)
  const cellWidth = view.getInt32(8, true)
  const cellHeight = view.getInt32(12, true)
  if (cellsX <= 0 || cellsY <= 0 || cellWidth <= 0 || cellHeight <= 0) {
    throw new ParseError(`TMP 头部不合理：${cellsX}×${cellsY} 格、${cellWidth}×${cellHeight} 像素`, 0)
  }
  // 菱形逐行排布要求格宽是格高的两倍（每下行 ±4 像素）：`tmpTileRows` 按此生成，
  // 不成立时像素数会对不上，因此在这里一次性拒绝。
  if (cellWidth !== cellHeight * PIXEL_COUNT_DIVISOR) {
    throw new ParseError(`TMP 格尺寸不是 2:1 等距：${cellWidth}×${cellHeight}`, 8)
  }

  const count = cellsX * cellsY
  if (bytes.byteLength < HEADER_BYTES + count * 4) {
    throw new TruncatedInputError(HEADER_BYTES + count * 4, bytes.byteLength)
  }

  const pixelCount = (cellWidth * cellHeight) / PIXEL_COUNT_DIVISOR
  if (bytes.byteLength < BLOCK_HEADER_BYTES + pixelCount) {
    throw new ParseError(`TMP 声明的格尺寸放不下：${cellWidth}×${cellHeight}`, 8)
  }
  const subTiles: TmpSubTile[] = []
  for (let index = 0; index < count; index++) {
    const at = view.getInt32(HEADER_BYTES + index * 4, true)
    if (at === 0) {
      subTiles.push(EMPTY_SUB_TILE)
      continue
    }
    if (at < 0 || at + BLOCK_HEADER_BYTES > bytes.byteLength) {
      throw new TruncatedInputError(at + BLOCK_HEADER_BYTES, bytes.byteLength)
    }
    subTiles.push(readSubTile(bytes, at, pixelCount, index))
  }

  return { cellsX, cellsY, cellWidth, cellHeight, subTiles }
}

function readSubTile(bytes: Uint8Array, at: number, pixelCount: number, index: number): TmpSubTile {
  const header = new DataView(bytes.buffer, bytes.byteOffset + at, bytes.byteLength - at)
  const size = header.getUint32(8, true)
  const imageDataEnd = header.getUint32(12, true)
  const flags = header.getUint32(36, true)
  const hasZData = (flags & FLAG_Z_DATA) !== 0
  const declared = BLOCK_HEADER_BYTES + pixelCount + (hasZData ? pixelCount : 0)

  if (imageDataEnd !== BLOCK_HEADER_BYTES + pixelCount) {
    throw new ParseError(`子块 ${index} 的像素区结束位置不合理：${imageDataEnd}`, at)
  }
  if (size !== declared) throw new ParseError(`子块 ${index} 长度不合理：size=${size} 应为 ${declared}`, at)
  if (at + size > bytes.byteLength) throw new TruncatedInputError(at + size, bytes.byteLength)

  return {
    pixelX: header.getInt32(0, true),
    pixelY: header.getInt32(4, true),
    size,
    flags,
    height: header.getUint8(40),
    terrainType: header.getUint8(41),
    rampType: header.getUint8(42),
    pixels: bytes.subarray(at + BLOCK_HEADER_BYTES, at + BLOCK_HEADER_BYTES + pixelCount),
    isEmpty: false,
  }
}

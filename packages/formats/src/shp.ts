import { ParseError, TruncatedInputError } from './errors.js'

/**
 * SHP 读取（RA2 的 `.shp`，以及按剧场后缀命名的 `.tem` / `.sno` / `.urb`）。
 *
 * 头部 8 字节：`u16 0`（签名）+ `u16 width` + `u16 height` + `u16 frameCount`。
 *
 * 每帧头 24 字节：`i16 x`、`i16 y`、`i16 width`、`i16 height`、`u8 compressionType`、
 * 3 字节保留、2 个 `i32` 保留、`i32 dataOffset`（帧数据相对文件起点）。
 * 帧数据范围 = 本帧 `dataOffset` 到下一帧 `dataOffset`（最后一帧到文件尾）。
 *
 * 帧像素按 `compressionType` 解：
 *
 *  - `0` / `1`：原样 `width × height` 字节；
 *  - `2`：逐行前缀 `u16 行长度`，其后是该行的字节；
 *  - `3`：逐行前缀 `u16 行长度`，行内**每个非零字节就是一个像素**，`0` 是零游程转义
 *    （后跟"零的个数"，超出本行宽度时按行宽截断）；
 *  - 其它：视为空帧。
 *
 * 宽或高为 0 的帧是**合法的空帧**（实测 `LOBRDG26.tem` 6 帧里有 3 帧如此，数据偏移也是 0），
 * 这种帧按"没有图形"处理，不报错。
 *
 * 调色板索引 `0` 是透明。判定依据：客户端 `ShpFile.readImageData` 的四个分支与此逐条对应；
 * `SROCK01.tem` / `NAWALL.shp` 等真实文件实测 `compressionType=3`。
 */

const HEADER_BYTES = 8
const FRAME_HEADER_BYTES = 24
const TRANSPARENT_INDEX = 0

/** 帧数据里"0 转义"的字节值。 */
export const SHP_TRANSPARENT_INDEX = TRANSPARENT_INDEX

export interface ShpFrame {
  /** 该帧相对整个图形左上角的像素偏移 */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly compressionType: number
  /** 调色板索引，长度 = width × height；0 表示透明 */
  readonly pixels: Uint8Array
  /** 宽或高为 0 的空帧（多帧图形里允许出现） */
  readonly isEmpty: boolean
}

export interface ShpFile {
  /** 头部声明的整体尺寸（各帧按 x/y 贴进去） */
  readonly width: number
  readonly height: number
  readonly frames: readonly ShpFrame[]
}

export function readShp(bytes: Uint8Array): ShpFile {
  if (bytes.byteLength < HEADER_BYTES) throw new TruncatedInputError(HEADER_BYTES, 0)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint16(0, true) !== 0) {
    throw new ParseError(`不是 SHP：签名 ${view.getUint16(0, true)}`, 0)
  }
  const width = view.getUint16(2, true)
  const height = view.getUint16(4, true)
  const frameCount = view.getUint16(6, true)
  if (frameCount === 0) throw new ParseError('SHP 没有帧', 6)
  const tableEnd = HEADER_BYTES + frameCount * FRAME_HEADER_BYTES
  if (bytes.byteLength < tableEnd) throw new TruncatedInputError(tableEnd, bytes.byteLength)

  const starts: number[] = []
  const frames: ShpFrame[] = []
  for (let index = 0; index < frameCount; index++) {
    const at = HEADER_BYTES + index * FRAME_HEADER_BYTES
    const frameWidth = view.getInt16(at + 4, true)
    const frameHeight = view.getInt16(at + 6, true)
    const compressionType = bytes[at + 8]!
    const dataOffset = view.getInt32(at + 20, true)
    if (frameWidth < 0 || frameHeight < 0) {
      throw new ParseError(`第 ${index} 帧尺寸不合理：${frameWidth}×${frameHeight}`, at + 4)
    }
    if (dataOffset < 0 || dataOffset > bytes.byteLength) {
      throw new TruncatedInputError(dataOffset, bytes.byteLength)
    }
    starts.push(dataOffset)
    const isEmpty = frameWidth === 0 || frameHeight === 0
    frames.push({
      x: view.getInt16(at, true),
      y: view.getInt16(at + 2, true),
      width: frameWidth,
      height: frameHeight,
      compressionType,
      pixels: new Uint8Array(isEmpty ? 0 : frameWidth * frameHeight),
      isEmpty,
    })
  }

  frames.forEach((frame, index) => {
    if (frame.isEmpty) return
    const start = starts[index]!
    const declaredEnd = starts[index + 1] ?? bytes.byteLength
    const end = declaredEnd > start ? declaredEnd : bytes.byteLength
    decodeFrame(bytes.subarray(start, end), frame)
  })

  return { width, height, frames }
}

function decodeFrame(data: Uint8Array, frame: ShpFrame): void {
  const { width, height, pixels } = frame
  if (frame.compressionType <= 1) {
    if (data.byteLength < width * height) throw new TruncatedInputError(width * height, data.byteLength)
    pixels.set(data.subarray(0, width * height))
    return
  }
  if (frame.compressionType === 2) {
    let read = 0
    let written = 0
    for (let row = 0; row < height; row++) {
      if (read + 2 > data.byteLength) throw new TruncatedInputError(read + 2, data.byteLength)
      const rowBytes = new DataView(data.buffer, data.byteOffset + read, 2).getUint16(0, true) - 2
      read += 2
      if (rowBytes < 0 || read + rowBytes > data.byteLength)
        throw new TruncatedInputError(read + rowBytes, data.byteLength)
      for (let index = 0; index < rowBytes; index++) pixels[written++] = data[read + index]!
      read += rowBytes
    }
    return
  }
  if (frame.compressionType !== 3) return
  decodeScanlineRle(data, frame)
}

/**
 * 类型 3：逐行 `u16 行长度` + 行内行程编码。
 *
 * 行内字节非 0 时**它自己就是像素值**（不是"字面量份数"）；为 0 时下一字节是"零的个数"。
 * 判定依据：客户端 `TmpFile` 同级的 `VK.decode` 逐字节判断（`if (h !== 0) r[a++] = h`）。
 */
function decodeScanlineRle(data: Uint8Array, frame: ShpFrame): void {
  const { width, height, pixels } = frame
  let read = 0
  for (let row = 0; row < height; row++) {
    if (read + 2 > data.byteLength) throw new TruncatedInputError(read + 2, data.byteLength)
    let remaining = new DataView(data.buffer, data.byteOffset + read, 2).getUint16(0, true) - 2
    read += 2
    let column = 0
    const rowStart = row * width
    while (remaining > 0) {
      remaining -= 1
      if (read >= data.byteLength) throw new TruncatedInputError(read, data.byteLength)
      const value = data[read++]!
      if (value !== TRANSPARENT_INDEX) {
        if (column < width) pixels[rowStart + column] = value
        column += 1
        continue
      }
      remaining -= 1
      if (read >= data.byteLength) throw new TruncatedInputError(read, data.byteLength)
      let zeros = data[read++]!
      if (column + zeros > width) zeros = width - column
      column += zeros
    }
  }
}

import { decodeBase64 } from './base64.js'
import { ParseError, TruncatedInputError } from './errors.js'
import { iniValue, parseIni, type IniDocument } from './ini.js'
import { decompressLzo1x } from './lzo1x.js'

/**
 * 地图（`.map`）读取。
 *
 * 地图本体是 INI 文本（windows-1252），地形单独放在 `[IsoMapPack5]`：
 * 多行数值键的 base64 文本（按数值键升序拼接）→ 解码后是若干块，
 * 每块是 `[u16 压缩长度][u16 原始长度][LZO1X 压缩数据]`，单块原始数据 ≤ 8192 字节；
 * 把各块的原始数据拼起来，按 11 字节一条记录切分。
 *
 * 证据（Maps01.mix 首张地图，70×96、SNOW）：
 *  - 解压前数据里 `11 00 00`（LZO 结束标记）恰好出现 18 次，而
 *    ceil(11 × (2×70−1) × 96 / 8192) = 18；
 *  - 按块头切分后 18 块全部严格解出：8192×17 + 7524 = 146788 = 11 × (2×70−1) × 96 + 4，
 *    多出的 4 字节是原版的余量。
 * 记录字段与客户端解析器一致：rx、ry、tile、保留、subTile、z、保留。
 *
 * 待核对：z 的原版单位（这里保留原始字节值，不做换算）。
 */

export const MAP_RECORD_BYTES = 11

export interface MapCell {
  /** 地图包里的菱形坐标（rx, ry） */
  readonly diamondX: number
  readonly diamondY: number
  /** 方格坐标：cellX = rx − ry + width − 1，cellY = ⌊(rx + ry − width − 1) / 2⌋ */
  readonly cellX: number
  readonly cellY: number
  readonly tileIndex: number
  readonly subTile: number
  /** 原版 z 字节（高度），单位待核对 */
  readonly z: number
}

export interface MapBounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface MapFile {
  readonly bounds: MapBounds
  /** 地图宽高（= right − left / bottom − top） */
  readonly width: number
  readonly height: number
  readonly localBounds: MapBounds | undefined
  readonly theater: string | undefined
  readonly cells: readonly MapCell[]
}

export function readMap(bytes: Uint8Array): MapFile {
  const document = parseIni(new TextDecoder('windows-1252').decode(bytes))
  const bounds = readBounds(document, 'size')
  if (!bounds) throw new ParseError('地图缺少 [Map] Size=', bytes.byteOffset)
  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top
  if (width <= 0 || height <= 0) throw new ParseError(`地图尺寸不合理：${width}×${height}`, bytes.byteOffset)

  const cells = readCells(document, width, height)
  return {
    bounds,
    width,
    height,
    localBounds: readBounds(document, 'localsize'),
    theater: iniValue(document, 'map', 'theater'),
    cells,
  }
}

function readBounds(document: IniDocument, key: string): MapBounds | undefined {
  const value = iniValue(document, 'map', key)
  if (value === undefined) return undefined
  const parts = value.split(',').map((part) => Number.parseInt(part.trim(), 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new ParseError(`[Map] ${key} 无法解析：${value}`, 0)
  }
  return { left: parts[0]!, top: parts[1]!, right: parts[2]!, bottom: parts[3]! }
}

function readCells(document: IniDocument, width: number, height: number): readonly MapCell[] {
  const section = document.sections.get('isomappack5')
  if (!section) throw new ParseError('地图缺少 [IsoMapPack5]', 0)

  const ordered = [...section.values.entries()]
    .filter(([key, value]) => Number.isInteger(Number(key)) && value !== '')
    .sort((left, right) => Number(left[0]) - Number(right[0]))
    .map(([, value]) => value)
  if (ordered.length === 0) throw new ParseError('[IsoMapPack5] 是空的', 0)

  const raw = readBlocks(decodeBase64(ordered.join('')))
  const count = (2 * width - 1) * height
  const needed = count * MAP_RECORD_BYTES
  if (raw.byteLength < needed) throw new TruncatedInputError(needed, raw.byteLength)

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const cells: MapCell[] = []
  for (let index = 0; index < count; index++) {
    const at = index * MAP_RECORD_BYTES
    const diamondX = view.getUint16(at, true)
    const diamondY = view.getUint16(at + 2, true)
    const diamondSum = diamondX + diamondY
    cells.push({
      diamondX,
      diamondY,
      cellX: diamondX - diamondY + width - 1,
      cellY: Math.floor((diamondSum - width - 1) / 2),
      tileIndex: Math.max(0, view.getInt16(at + 4, true)),
      subTile: raw[at + 8]!,
      z: raw[at + 9]!,
    })
  }
  return cells
}

/** 逐块解压：每块自带压缩长度与原始长度，块之间相互独立。 */
function readBlocks(compressed: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let total = 0
  let offset = 0
  while (offset + 4 <= compressed.byteLength) {
    const header = new DataView(compressed.buffer, compressed.byteOffset + offset, 4)
    const compressedLength = header.getUint16(0, true)
    const rawLength = header.getUint16(2, true)
    const start = offset + 4
    const end = start + compressedLength
    if (compressedLength === 0 || end > compressed.byteLength) {
      throw new TruncatedInputError(end, compressed.byteLength)
    }
    const chunk = decompressLzo1x(compressed.subarray(start, end))
    if (chunk.byteLength !== rawLength) {
      throw new ParseError(`地图块长度不符：头部 ${rawLength}，实际 ${chunk.byteLength}`, offset)
    }
    chunks.push(chunk)
    total += chunk.byteLength
    offset = end
  }

  const merged = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    merged.set(chunk, at)
    at += chunk.byteLength
  }
  return merged
}

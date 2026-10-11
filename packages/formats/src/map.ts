import { decodeBase64 } from './base64.js'
import { ParseError, TruncatedInputError } from './errors.js'
import { iniValue, parseIni, type IniDocument } from './ini.js'
import { readPackedBlocks, type PackedBlockCodec } from './packed-blocks.js'

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
/** 覆盖物网格的索引步长：`下标 = 菱形横坐标 + 512 × 菱形纵坐标`。 */
export const OVERLAY_GRID_STRIDE = 512
/** 覆盖物网格里的"无覆盖物"值。 */
export const OVERLAY_NONE = 255

export interface MapOverlay {
  /** 覆盖物编号，对应 rules.ini 的 `[OverlayTypes]` 顺序 */
  readonly id: number
  /** 该格的附加字节（矿石量、图帧号等），含义随覆盖物而定 */
  readonly data: number
}

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
  /** 该格的覆盖物（树、矿、栏杆…）；没有则为 undefined */
  readonly overlay: MapOverlay | undefined
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
  /** 地图档案自带的官方预览图；没有这张图或布局不认识时为 undefined */
  readonly preview: MapPreviewImage | undefined
}

/** 官方预览图：24 位 RGB，不经调色板。 */
export interface MapPreviewImage {
  readonly width: number
  readonly height: number
  /** 长度 = width × height × 3 */
  readonly rgb: Uint8Array
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
    preview: readPreview(document),
  }
}

/**
 * 官方预览图：`[Preview] Size=<左>,<上>,<宽>,<高>` + `[PreviewPack]`（LZO1X 分块包）。
 *
 * 解出的是 `宽 × 高 × 3` 字节的 **24 位 RGB**（实测 `MULTI.MIX` 第 7 张：`0,0,102,52` → 15912 字节、
 * 首像素 (176,184,80)）。长度对不上时按"没有预览图"处理 —— 这张图是装饰，不该挡住地图本身。
 */
function readPreview(document: IniDocument): MapPreviewImage | undefined {
  const size = iniValue(document, 'preview', 'size')
  if (!size || !document.sections.has('previewpack')) return undefined
  const parts = size.split(',').map((part) => Number.parseInt(part.trim(), 10))
  const width = parts[2]
  const height = parts[3]
  if (parts.length !== 4 || !width || !height || width <= 0 || height <= 0) return undefined
  const rgb = readPackedSection(document, 'PreviewPack', 'lzo1x')
  return rgb.byteLength === width * height * 3 ? { width, height, rgb } : undefined
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
  const raw = readPackedSection(document, 'IsoMapPack5', 'lzo1x')
  const count = (2 * width - 1) * height
  const needed = count * MAP_RECORD_BYTES
  if (raw.byteLength < needed) throw new TruncatedInputError(needed, raw.byteLength)

  const overlays = readOverlayGrid(document)
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
      overlay: overlays?.(diamondX + OVERLAY_GRID_STRIDE * diamondY, index),
    })
  }
  return cells
}

/**
 * 覆盖物：`[OverlayPack]` 给编号、`[OverlayDataPack]` 给附加字节，两份都是 Format80 分块包。
 *
 * 两份流按**菱形坐标**索引（`rx + 512 × ry`），与地形记录一一对应；255 表示该格没有覆盖物。
 * 索引超出流长时按"没有覆盖物"处理（原版的地图包只覆盖用到的范围）。
 */
function readOverlayGrid(document: IniDocument): ((at: number, index: number) => MapOverlay | undefined) | undefined {
  if (!document.sections.has('overlaypack') || !document.sections.has('overlaydatapack')) return undefined
  const ids = readPackedSection(document, 'OverlayPack', 'format80')
  const data = readPackedSection(document, 'OverlayDataPack', 'format80')
  return (at) => {
    if (at >= ids.byteLength) return undefined
    const id = ids[at]!
    return id === OVERLAY_NONE ? undefined : { id, data: data[at] ?? 0 }
  }
}

/**
 * 取出一个分块包段：数值键升序拼接 → base64 → 分块解压。
 * 编码器由调用方给出，同一容器只在这里切一次块。
 */
function readPackedSection(document: IniDocument, sectionName: string, codec: PackedBlockCodec): Uint8Array {
  const section = document.sections.get(sectionName.toLowerCase())
  if (!section) throw new ParseError(`地图缺少 [${sectionName}]`, 0)
  const ordered = [...section.values.entries()]
    .filter(([key, value]) => Number.isInteger(Number(key)) && value !== '')
    .sort((left, right) => Number(left[0]) - Number(right[0]))
    .map(([, value]) => value)
  if (ordered.length === 0) throw new ParseError(`[${sectionName}] 是空的`, 0)
  return readPackedBlocks(decodeBase64(ordered.join('')), codec)
}

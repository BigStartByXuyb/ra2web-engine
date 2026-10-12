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
/** 地形段的结束哨兵：读到 `(X, Y) = (0xFFFF, 0)` 这条就停（原版比的是全局哨兵对） */
export const ISO_RECORD_SENTINEL = { x: 0xffff, y: 0 } as const
/** 地块编号的"这一格没有地块"取值：原版先把格里的值置 0xFFFF，再读 4 字节覆盖 */
export const TILE_NONE = 0xffff
/** 覆盖物网格的索引步长：`下标 = 菱形横坐标 + 512 × 菱形纵坐标`。 */
export const OVERLAY_GRID_STRIDE = 512
/** 覆盖物网格里的"无覆盖物"值。 */
export const OVERLAY_NONE = 255
/**
 * 地图上摆放的建筑/单位坐标**本来就是格坐标**（与地形记录同一套格空间，见 `readCells`），所以倍率是 1。
 *
 * 判定依据：拿地图自带的 25 个民用建筑当判据（它们必须站在**真有地块**的格上）——
 * 原值当格坐标 20/25 命中、只有 2 个在水上；除以 2 只剩 6/25 命中，建筑会整体偏出地形、
 * 表现为"飘在地图外面"。
 */
export const PLACEMENT_UNITS_PER_CELL = 1

export type PlacementKind = 'structure' | 'unit' | 'infantry' | 'aircraft' | 'terrain'

/**
 * 地图预置的对象（建筑、单位、步兵、飞机、树木）。
 *
 * 行格式（`[Structures]` / `[Units]` / `[Infantry]` / `[Aircraft]` 共用）：
 * `所有者,类型,生命值,X,Y,朝向,标签,…`，其中 **X/Y 是半格单位**（格子 = X/2、Y/2）。
 * 判定依据：`MULTI.MIX` 第 7 张 38/38、第 0 张 62/62、`Maps01.mix` 第 0 张 262/268 个建筑
 * 按半格解释落在地图范围内（按"原值当格子"只有 13/38、11/62、76/268），
 * 且落在水面/悬崖上的极少（0 / 0 / 4 个）。
 *
 * `[Terrain]` 的键就是坐标（`rx + 1000 × ry`），与建筑不同，因此单独一组。
 */
export interface MapPlacement {
  readonly kind: PlacementKind
  readonly owner: string
  /** rules.ini 里的类型名（如 `CABHUT`、`NAFLAK`） */
  readonly type: string
  readonly health: number
  readonly cellX: number
  readonly cellY: number
  readonly facing: number
}

export interface MapOverlay {
  /** 覆盖物编号，对应 rules.ini 的 `[OverlayTypes]` 顺序 */
  readonly id: number
  /** 该格的附加字节（矿石量、图帧号等），含义随覆盖物而定 */
  readonly data: number
}

export interface MapCell {
  /** 记录里的原始 X、Y（1 起；就是原版的格坐标，见 `readCells` 的判定依据） */
  readonly diamondX: number
  readonly diamondY: number
  /** 格坐标（0 起）= 记录里的 X − 1、Y − 1 */
  readonly cellX: number
  readonly cellY: number
  /** 地块编号；`TILE_NONE` 表示这一格没有地块 */
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
  /**
   * 格坐标范围（右/下开区间）。原版的格空间是 512×512 格数组里一块**斜置的区域**，
   * 不等于 `width`×`height` 那个矩形：网格步长、可见性过滤都必须用这一组。
   */
  readonly cellBounds: MapBounds
  readonly localBounds: MapBounds | undefined
  readonly theater: string | undefined
  readonly cells: readonly MapCell[]
  /** 地图档案自带的官方预览图；没有这张图或布局不认识时为 undefined */
  readonly preview: MapPreviewImage | undefined
  /** 预置的建筑/单位/步兵/飞机（坐标为半格，已换算成格子） */
  readonly placements: readonly MapPlacement[]
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

  const cells = readCells(document)
  return {
    bounds,
    width,
    height,
    cellBounds: cellRangeOf(cells),
    localBounds: readBounds(document, 'localsize'),
    theater: iniValue(document, 'map', 'theater'),
    cells,
    preview: readPreview(document),
    placements: [
      ...readPlacements(document, 'Structures', 'structure'),
      ...readPlacements(document, 'Units', 'unit'),
      ...readPlacements(document, 'Infantry', 'infantry'),
      ...readPlacements(document, 'Aircraft', 'aircraft'),
    ],
  }
}

/** 放置段：`所有者,类型,生命值,X,Y,朝向,…`，X/Y 是半格单位。 */
function readPlacements(document: IniDocument, sectionName: string, kind: PlacementKind): readonly MapPlacement[] {
  const section = document.sections.get(sectionName.toLowerCase())
  if (!section) return []
  const placements: MapPlacement[] = []
  for (const value of section.values.values()) {
    const parts = value.split(',')
    if (parts.length < 6) continue
    const health = Number.parseInt(parts[2]!.trim(), 10)
    const x = Number.parseInt(parts[3]!.trim(), 10)
    const y = Number.parseInt(parts[4]!.trim(), 10)
    const facing = Number.parseInt(parts[5]!.trim(), 10)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    placements.push({
      kind,
      owner: parts[0]!.trim(),
      type: parts[1]!.trim(),
      health: Number.isFinite(health) ? health : 0,
      cellX: Math.floor(x / PLACEMENT_UNITS_PER_CELL),
      cellY: Math.floor(y / PLACEMENT_UNITS_PER_CELL),
      facing: Number.isFinite(facing) ? facing : 0,
    })
  }
  return placements
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

/** 实际用到的格范围（右/下开区间，与 `[Map] Size` 同一约定）。 */
function cellRangeOf(cells: readonly MapCell[]): MapBounds {
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const cell of cells) {
    left = Math.min(left, cell.cellX)
    top = Math.min(top, cell.cellY)
    right = Math.max(right, cell.cellX)
    bottom = Math.max(bottom, cell.cellY)
  }
  return Number.isFinite(left)
    ? { left, top, right: right + 1, bottom: bottom + 1 }
    : { left: 0, top: 0, right: 0, bottom: 0 }
}

/**
 * 地形记录（`IsoMapPack5`）：**11 字节一条**，末尾另跟 4 字节哨兵。
 *
 * 字段：`X(int16) | Y(int16) | 地块编号(int32，0xFFFF = 这一格没有地块) | subTile | z | 1 字节`。
 *
 * 判定依据：原版客户端 `GAME.EXE` 的 `FUN_0054e1e0`（VA 0x54e1e0，`IsoMapPack5` 的消费者）——
 * 每次读 4 字节当 `(X, Y)`，用 `格下标 = Y × 512 + X` 直接取格，再读 4 字节写进格对象、再读 1+1+1 字节，
 * 读到全局哨兵对就结束。**X、Y 本身就是引擎的格坐标，不存在"菱形 → 方格"的换算**。
 *
 * 实测印证：地图自带的 25 个民用建筑按 `(X − 1, Y − 1)` 落格，17 个落在陆地、0 个落在水面；
 * 改前那条菱形换算只有 4 个陆地、11 个在水面，且道路交叉口会变成斜角。
 */
function readCells(document: IniDocument): readonly MapCell[] {
  const raw = readPackedSection(document, 'IsoMapPack5', 'lzo1x')
  const overlays = readOverlayGrid(document)
  const cells: MapCell[] = []
  for (let at = 0; at + MAP_RECORD_BYTES <= raw.byteLength; at += MAP_RECORD_BYTES) {
    const x = raw[at]! | (raw[at + 1]! << 8)
    const y = raw[at + 2]! | (raw[at + 3]! << 8)
    if (x === ISO_RECORD_SENTINEL.x && y === ISO_RECORD_SENTINEL.y) break
    const cellX = x - 1
    const cellY = y - 1
    const tile = raw[at + 4]! | (raw[at + 5]! << 8) | (raw[at + 6]! << 16) | (raw[at + 7]! << 24)
    cells.push({
      diamondX: x,
      diamondY: y,
      cellX,
      cellY,
      tileIndex: tile >>> 0,
      subTile: raw[at + 8]!,
      z: raw[at + 9]!,
      overlay: overlays?.(cellX + OVERLAY_GRID_STRIDE * cellY),
    })
  }
  return cells
}

/**
 * 覆盖物：`[OverlayPack]` 给编号、`[OverlayDataPack]` 给附加字节，两份都是 Format80 分块包。
 *
 * 两份流按**方格坐标**索引：`下标 = x + 512 × y`，x/y 就是 waypoint、建筑用的那套地图格坐标
 * （不是地形记录里的菱形坐标），整个网格固定 512×512、每格一字节，255 表示该格没有覆盖物。
 *
 * 判定依据：原版客户端 `GAME.EXE` 的 `FUN_005db670`（VA 0x5db670）——外层按 y、内层按 x
 * 各循环 0x200 次，顺序读一个字节，命中就把覆盖物放到 `(x, y)` 这一格上；`OverlayDataPack`
 * 的读法与之同构。按菱形坐标索引会把矿石一类的东西散到别的格子（例如水上）。
 *
 * 索引超出流长时按"没有覆盖物"处理（原版的地图包只覆盖用到的范围）。
 */
function readOverlayGrid(document: IniDocument): ((at: number) => MapOverlay | undefined) | undefined {
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

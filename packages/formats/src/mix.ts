import { TruncatedInputError } from './errors.js'
import { crc32 } from './crc32.js'
import { Blowfish } from './vendor/blowfish.js'
import { BlowfishKey } from './vendor/blowfish-key.js'

/**
 * MIX 档案读取：文件名哈希与索引解析（含加密索引）。
 *
 * 原版 MIX 的索引不存文件名，只存 32 位哈希；要还原名字必须外挂哈希表
 * （XCC 的 global mix database）。这里只负责字节层，不做名字还原。
 *
 * 两种头：
 *  - 明文头（TD/RA 型）：文件数 + 数据区长度 + 条目表；
 *  - 加密头（RA2/TS 型，flags 含 0x00020000）：前 4 字节是 flags，紧接 80 字节密钥材料
 *    （4..83），第 84 字节起是加密索引。索引的头 8 字节同时充当"条目数 + 数据区长度"，
 *    因此解密第一块即可得到条目数，据此算出要解密多少字节。
 */

export const MIX_ENTRY_BYTES = 12

const FLAG_CHECKSUM = 0x00010000
const FLAG_ENCRYPTED = 0x00020000
const KNOWN_FLAGS = FLAG_CHECKSUM | FLAG_ENCRYPTED
/** 加密头布局：0..3 flags，4..83 密钥材料，84 起为加密索引（其前 8 字节兼作头部） */
const ENCRYPTED_KEY_OFFSET = 4
const ENCRYPTED_KEY_BYTES = 80
const ENCRYPTED_INDEX_OFFSET = ENCRYPTED_KEY_OFFSET + ENCRYPTED_KEY_BYTES

/** 原版文件名哈希：转大写 → 补位到 4 字节对齐 → CRC32。 */
export function hashFileName(fileName: string, crc32: (bytes: Uint8Array) => number): number {
  let processed = fileName.toUpperCase()
  const length = processed.length
  const remainder = length & 3
  if (remainder !== 0) {
    processed += String.fromCharCode(remainder)
    const padChar = processed.charCodeAt(length - remainder)
    for (let i = 0; i < 3 - remainder; i++) processed += String.fromCharCode(padChar)
  }
  const bytes = new Uint8Array(processed.length)
  for (let i = 0; i < processed.length; i++) bytes[i] = processed.charCodeAt(i) & 0xff
  return crc32(bytes) >>> 0
}

export interface MixEntry {
  readonly hash: number
  readonly offset: number
  readonly length: number
}

export interface MixIndex {
  /** 文件数据区在档案中的起始字节 */
  readonly dataStart: number
  /** 索引是否经过加密 */
  readonly encrypted: boolean
  readonly entries: readonly MixEntry[]
}

/** 解析 MIX 索引，自动识别明文头与加密头。 */
export function readMixIndex(bytes: Uint8Array): MixIndex {
  if (bytes.byteLength < 6) throw new TruncatedInputError(6, 0)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flags = view.getUint32(0, true)
  const flaggedOnly = (flags & ~KNOWN_FLAGS) === 0
  if (flaggedOnly && (flags & FLAG_ENCRYPTED) !== 0) return readEncryptedIndex(bytes, view)
  // 明文但带 flags（RA2 型，校验位）：条目表从第 4 字节开始
  if (flaggedOnly && (flags & FLAG_CHECKSUM) !== 0) return decodeIndex(view, 4, false)
  return decodeIndex(view, 0, false)
}

interface DecodedTable {
  readonly tableBytes: number
  readonly entries: readonly MixEntry[]
}

function decodeIndex(view: DataView, offset: number, encrypted: boolean): MixIndex {
  const decoded = decodeIndexTable(view, offset)
  return { dataStart: offset + decoded.tableBytes, encrypted, entries: decoded.entries }
}

/** 按明文布局解析条目表：uint16 文件数 + uint32 数据区长度 + N×(hash, offset, length)。 */
function decodeIndexTable(view: DataView, offset: number): DecodedTable {
  if (offset + 6 > view.byteLength) throw new TruncatedInputError(offset + 6, offset)
  const fileCount = view.getUint16(offset, true)
  const declaredDataSize = view.getUint32(offset + 2, true)
  const tableBytes = 6 + fileCount * MIX_ENTRY_BYTES
  if (offset + tableBytes > view.byteLength) throw new TruncatedInputError(offset + tableBytes, offset)

  const entries: MixEntry[] = []
  const seen = new Set<number>()
  for (let i = 0; i < fileCount; i++) {
    const at = offset + 6 + i * MIX_ENTRY_BYTES
    const hash = view.getUint32(at, true) >>> 0
    const entryOffset = view.getUint32(at + 4, true)
    const length = view.getUint32(at + 8, true)
    if (entryOffset + length > declaredDataSize) throw new TruncatedInputError(entryOffset + length, at)
    if (!seen.has(hash)) {
      seen.add(hash)
      entries.push({ hash, offset: entryOffset, length })
    }
  }
  return { tableBytes, entries }
}

/** 加密头：解密 8 字节头部拿到文件数，再按 8 字节对齐解密整张条目表。 */
function readEncryptedIndex(bytes: Uint8Array, view: DataView): MixIndex {
  if (bytes.byteLength < ENCRYPTED_INDEX_OFFSET) throw new TruncatedInputError(ENCRYPTED_INDEX_OFFSET, 0)
  const keyMaterial = bytes.subarray(ENCRYPTED_KEY_OFFSET, ENCRYPTED_INDEX_OFFSET)
  const cipher = new Blowfish(new BlowfishKey().decryptKey(keyMaterial))

  const headerWords = new Uint32Array([
    view.getUint32(ENCRYPTED_INDEX_OFFSET, true),
    view.getUint32(ENCRYPTED_INDEX_OFFSET + 4, true),
  ])
  const headerBytes = new Uint8Array(cipher.decrypt(headerWords).buffer)
  const fileCount = headerBytes[0]! | (headerBytes[1]! << 8)

  const tableBytes = 6 + fileCount * MIX_ENTRY_BYTES
  const wordCount = ((3 + tableBytes) / 4) | 0
  const paddedWordCount = wordCount + (wordCount % 2)
  const indexWords = new Uint32Array(paddedWordCount)
  for (let i = 0; i < paddedWordCount; i++) {
    const at = ENCRYPTED_INDEX_OFFSET + i * 4
    if (at + 4 > bytes.byteLength) throw new TruncatedInputError(at + 4, at)
    indexWords[i] = view.getUint32(at, true)
  }

  const plain = new Uint8Array(cipher.decrypt(indexWords).buffer)
  const decoded = decodeIndexTable(new DataView(plain.buffer, plain.byteOffset, plain.byteLength), 0)
  const padding = (1 + (~decoded.tableBytes >>> 0)) & 7
  return { dataStart: ENCRYPTED_INDEX_OFFSET + decoded.tableBytes + padding, encrypted: true, entries: decoded.entries }
}

/** 取出某个条目的原始字节（返回视图，不复制）。 */
export function readMixEntry(bytes: Uint8Array, index: MixIndex, entry: MixEntry): Uint8Array {
  const start = index.dataStart + entry.offset
  const end = start + entry.length
  if (end > bytes.byteLength) throw new TruncatedInputError(end, start)
  return bytes.subarray(start, end)
}

/** 按名字取条目（名字哈希大小写不敏感）；不存在返回 undefined。 */
export function findMixEntry(
  index: MixIndex,
  fileName: string,
  crc32: (bytes: Uint8Array) => number,
): MixEntry | undefined {
  const hash = hashFileName(fileName, crc32)
  return index.entries.find((entry) => entry.hash === hash)
}

/**
 * 把"档案套档案"里的条目偏移换算成父档案中的偏移。
 *
 * 内层条目的 offset 是相对内层数据区的，因此要叠加：内层容器的 offset（相对外层数据区）
 * + 内层数据区起点。子 MIX（如 RA2.MIX 里的 local.mix）必须走这一步，否则会读到错误位置。
 */
export function absoluteEntryOffset(container: MixEntry, innerIndex: MixIndex, entry: MixEntry): MixEntry {
  return { hash: entry.hash, offset: container.offset + innerIndex.dataStart + entry.offset, length: entry.length }
}

export interface MixFileLookup {
  readonly bytes: Uint8Array
  readonly fileName: string
  /** 顶层找不到时再进这个内嵌档案找一层（原版安装里 rules/美术在 local.mix 内） */
  readonly containerFileName?: string
}

/**
 * 按名字取文件字节：先查顶层，再（可选）查一层内嵌档案。
 *
 * 内嵌档案里的条目偏移是相对内层数据区的，必须用 `absoluteEntryOffset` 换算回父档案，
 * 否则会读到错误位置 —— 这里是唯一的换算实现，调用方不要再自己叠偏移。
 */
export function readMixFile(lookup: MixFileLookup): Uint8Array | undefined {
  const archive = readMixIndex(lookup.bytes)
  const direct = findMixEntry(archive, lookup.fileName, crc32)
  if (direct) return readMixEntry(lookup.bytes, archive, direct)
  if (!lookup.containerFileName) return undefined

  const container = findMixEntry(archive, lookup.containerFileName, crc32)
  if (!container) return undefined
  const inner = readMixIndex(readMixEntry(lookup.bytes, archive, container))
  const nested = findMixEntry(inner, lookup.fileName, crc32)
  if (!nested) return undefined
  return readMixEntry(lookup.bytes, archive, absoluteEntryOffset(container, inner, nested))
}

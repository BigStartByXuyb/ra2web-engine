import { TruncatedInputError, UnsupportedMixHeaderError } from './errors.js'

/**
 * MIX 档案读取：文件名哈希与索引解析。
 *
 * 原版 MIX 的索引不存文件名，只存 32 位哈希；要还原名字必须外挂哈希表（XCC 的
 * global mix database）。这里只负责字节层，不做名字还原。
 */

export const MIX_ENTRY_BYTES = 12

const FLAG_CHECKSUM = 0x00010000
const FLAG_ENCRYPTED = 0x00020000
const UNSUPPORTED_FLAG_MASK = ~(FLAG_CHECKSUM | FLAG_ENCRYPTED)

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
  readonly entries: readonly MixEntry[]
}

/** 解析 MIX 索引。加密头（RA/TS 型）尚未实现，遇到即抛。 */
export function readMixIndex(bytes: Uint8Array): MixIndex {
  if (bytes.byteLength < 6) throw new TruncatedInputError(6, 0)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flags = view.getUint32(0, true)
  const looksFlagged = (flags & UNSUPPORTED_FLAG_MASK) === 0
  if (looksFlagged && (flags & FLAG_ENCRYPTED) !== 0) throw new UnsupportedMixHeaderError(flags)

  const fileCount = view.getUint16(0, true)
  const declaredDataSize = view.getUint32(2, true)
  const tableEnd = 6 + fileCount * MIX_ENTRY_BYTES
  if (tableEnd > bytes.byteLength) throw new TruncatedInputError(tableEnd, 0)

  const entries: MixEntry[] = []
  const seen = new Set<number>()
  for (let i = 0; i < fileCount; i++) {
    const at = 6 + i * MIX_ENTRY_BYTES
    const hash = view.getUint32(at, true) >>> 0
    const offset = view.getUint32(at + 4, true)
    const length = view.getUint32(at + 8, true)
    if (offset + length > declaredDataSize) throw new TruncatedInputError(offset + length, at)
    if (!seen.has(hash)) {
      seen.add(hash)
      entries.push({ hash, offset, length })
    }
  }
  return { dataStart: tableEnd, entries }
}

/** 取出某个条目的原始字节（返回视图，不复制）。 */
export function readMixEntry(bytes: Uint8Array, index: MixIndex, entry: MixEntry): Uint8Array {
  const start = index.dataStart + entry.offset
  const end = start + entry.length
  if (end > bytes.byteLength) throw new TruncatedInputError(end, start)
  return bytes.subarray(start, end)
}

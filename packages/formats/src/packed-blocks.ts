import { ParseError, TruncatedInputError } from './errors.js'
import { decompressFormat80 } from './format80.js'
import { decompressLzo1x } from './lzo1x.js'

/**
 * 原版地图里的"分块包"容器：`[u16 压缩长度][u16 原始长度][压缩数据]` 依次排列。
 *
 * 同一个容器按段位选解码器 —— 原版 `[IsoMapPack5]` 用 LZO1X，`[OverlayPack]` /
 * `[OverlayDataPack]` / `[PreviewPack]` 用 Format80（LCW）。编码器只决定块内字节，
 * 切块方式相同，因此这里只留一份切块实现，解码器由调用方指定。
 *
 * 两种编码器对"块"的含义不同，这是实测出来的：
 *
 * - LZO1X：每块是独立流，各自解出自己声明的原始长度（块尾有 `11 00 00` 结束标记）。
 * - Format80：块只是传输分段，**整条流连续**，回抄下标是全局输出下标，会跨块引用
 *   （实测：第 2 块的 `f4 00 00` 回抄的是全局下标 0）。因此要把各段拼起来一次解完，
 *   但按段推进 —— 每段自带 `0x80` 收尾。
 *
 * 任一块的长度字段为 0 即视为结束（与客户端实现一致），此时已解出的部分照常返回。
 */

export type PackedBlockCodec = 'lzo1x' | 'format80'

export function readPackedBlocks(compressed: Uint8Array, codec: PackedBlockCodec): Uint8Array {
  const blocks: Array<{ readonly body: Uint8Array; readonly rawLength: number }> = []
  let offset = 0
  while (offset + 4 <= compressed.byteLength) {
    const header = new DataView(compressed.buffer, compressed.byteOffset + offset, 4)
    const compressedLength = header.getUint16(0, true)
    const rawLength = header.getUint16(2, true)
    if (compressedLength === 0 || rawLength === 0) break
    const start = offset + 4
    const end = start + compressedLength
    if (end > compressed.byteLength) throw new TruncatedInputError(end, compressed.byteLength)
    blocks.push({ body: compressed.subarray(start, end), rawLength })
    offset = end
  }

  if (codec === 'format80') {
    return decompressFormat80(
      concat(blocks.map((block) => block.body)),
      blocks.map((block) => block.rawLength),
    )
  }

  const chunks = blocks.map((block, index) => {
    const chunk = decompressLzo1x(block.body)
    if (chunk.byteLength !== block.rawLength) {
      throw new ParseError(`分块长度不符：头部 ${block.rawLength}，实际 ${chunk.byteLength}`, index)
    }
    return chunk
  })
  return concat(chunks)
}

function concat(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  const merged = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let at = 0
  for (const chunk of chunks) {
    merged.set(chunk, at)
    at += chunk.byteLength
  }
  return merged
}

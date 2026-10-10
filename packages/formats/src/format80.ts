import { ParseError } from './errors.js'

/**
 * Westwood Format80（LCW）解压。
 *
 * 命令字节：
 *
 *   `0x00..0x7F`：从已产出区域回抄，份数 = `(命令 >> 4) + 3`，距离 = `((命令 & 0x0F) << 8) + 下一字节`
 *   `0x80..0xBF`：字面量，份数 = `命令 & 0x3F`；`0x80`（份数为 0）表示本段结束
 *   `0xC0..0xFD`：从已产出区域的**全局下标**回抄，份数 = `(命令 & 0x3F) + 3`，下标 = 下一 `u16`
 *   `0xFE`：填充，份数 = 下一 `u16`，字节 = 下一字节
 *   `0xFF`：从已产出区域的全局下标回抄，份数 = 下一 `u16`，下标 = 再下一 `u16`
 *
 * 多字节字段是小端。三条判定依据都来自 `[OverlayPack]` 实测：
 *
 *  - 首段 `22 字节 → 8192 字节`：第一条填充命令按小端解出"7224 个 0xFF"，按大端会超出段长；
 *  - 份数取**高**半字节、距离取低半字节：按此解出该段恰好 8192 字节（按相反取法会多 1 字节）；
 *  - 回抄下标是**全局**下标：第二段开头的 `f4 00 00` 回抄的是全局下标 0。
 *
 * `segmentLengths` 是各传输段应产出的字节数（原版分块头里的原始长度）。段与段之间输出连续，
 * 每段以 `0x80` 收尾 —— 所以拼接后的字节不能当成一条无边界流来解，必须按段推进。
 */

/** 掩掉高两位之后剩下的类型值（`0xFE` / `0xFF`）。 */
const KIND_FILL = 0xfe & 0x3f
const KIND_COPY_LONG = 0xff & 0x3f

export function decompressFormat80(source: Uint8Array, segmentLengths: readonly number[]): Uint8Array {
  const output = new Uint8Array(segmentLengths.reduce((total, length) => total + length, 0))
  let read = 0
  let written = 0

  const nextByte = (): number => {
    if (read >= source.byteLength) throw new ParseError('Format80 流提前结束', read)
    return source[read++]!
  }
  const nextUint16 = (): number => nextByte() | (nextByte() << 8)
  /** 回抄允许与已产出区域重叠（距离 1 就是"重复上一字节"），因此只校验起点与输出上界。 */
  const copy = (from: number, count: number): void => {
    if (from < 0 || from >= written) throw new ParseError(`Format80 回抄越界：下标 ${from}，已产出 ${written}`, read)
    if (written + count > output.byteLength) throw new ParseError(`Format80 回抄超出输出：${written}+${count}`, read)
    for (let index = 0; index < count; index++) output[written + index] = output[from + index]!
    written += count
  }

  for (const length of segmentLengths) {
    const target = written + length
    while (written < target) {
      const command = nextByte()
      if ((command & 0x80) === 0) {
        const distance = ((command & 0x0f) << 8) + nextByte()
        if (distance === 0) throw new ParseError('Format80 回抄距离为 0', read)
        copy(written - distance, (command >> 4) + 3)
        continue
      }
      if ((command & 0x40) === 0) {
        const count = command & 0x3f
        if (count === 0) throw new ParseError(`Format80 段提前结束：已产出 ${written}，应为 ${target}`, read)
        if (written + count > output.byteLength)
          throw new ParseError(`Format80 字面量超出输出：${written}+${count}`, read)
        for (let index = 0; index < count; index++) output[written + index] = nextByte()
        written += count
        continue
      }
      const kind = command & 0x3f
      if (kind === KIND_FILL) {
        const count = nextUint16()
        const value = nextByte()
        if (written + count > output.byteLength)
          throw new ParseError(`Format80 填充超出输出：${written}+${count}`, read)
        output.fill(value, written, written + count)
        written += count
        continue
      }
      if (kind === KIND_COPY_LONG) {
        const count = nextUint16()
        copy(nextUint16(), count)
        continue
      }
      copy(nextUint16(), kind + 3)
    }
    if (written !== target) throw new ParseError(`Format80 段长度不符：${written} ≠ ${target}`, read)
    if (read < source.byteLength && source[read] === 0x80) read += 1
  }

  return output
}

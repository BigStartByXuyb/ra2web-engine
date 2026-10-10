import { TruncatedInputError } from './errors.js'

/**
 * LZO1X 解压。
 *
 * 原版地图把地形放进 `[IsoMapPack5]`：base64 → LZO1X 压缩流。判定依据是数据本身 ——
 * 解压前末三字节是 `11 00 00`（LZO 流的结束标记），解压后能按 12 字节一条完整切分。
 *
 * 实现按 LZO 参考实现（`lzo1x_decompress_safe`）逐分支翻译，保持输入/输出指针语义；
 * 越界一律抛 TruncatedInputError，不做静默截断。
 */

const M2_MAX_OFFSET = 0x0800
const M3_MAX_OFFSET = 0x4000
const INITIAL_OUTPUT_BYTES = 8192

type LzoState = 'outer' | 'firstLiteralRun' | 'match' | 'matchDone' | 'matchNext'

interface Match {
  readonly offset: number
  readonly count: number
  readonly isEnd: boolean
}

export function decompressLzo1x(source: Uint8Array): Uint8Array {
  return new LzoReader(source).decompress()
}

class LzoReader {
  private input = 0
  private output = new Uint8Array(INITIAL_OUTPUT_BYTES)
  private written = 0

  public constructor(private readonly source: Uint8Array) {}

  public decompress(): Uint8Array {
    const start = this.initialState()
    return this.run(start.state, start.token)
  }

  /** 首字节的特殊约定：>17 是字面量游程（<4 时等价于 match_next），>=16 直接进入匹配。 */
  private initialState(): { state: LzoState; token: number } {
    const token = this.byte()
    if (token > 17) {
      const literals = token - 17
      if (literals < 4) return { state: 'matchNext', token: literals }
      this.copyLiterals(literals)
      return { state: 'firstLiteralRun', token: 0 }
    }
    if (token >= 16) return { state: 'match', token }
    const length = token === 0 ? this.extendRun(15) : token
    this.copyLiterals(length + 3)
    return { state: 'firstLiteralRun', token: 0 }
  }

  private run(state: LzoState, token: number): Uint8Array {
    let current = state
    let value = token
    for (;;) {
      switch (current) {
        case 'outer': {
          value = this.byte()
          if (value >= 16) {
            current = 'match'
            break
          }
          this.copyLiterals((value === 0 ? this.extendRun(15) : value) + 3)
          current = 'firstLiteralRun'
          break
        }
        case 'firstLiteralRun': {
          value = this.byte()
          if (value >= 16) {
            current = 'match'
            break
          }
          this.copyNearMatch(value)
          current = 'matchDone'
          break
        }
        case 'match': {
          const match = this.readMatch(value)
          if (match.isEnd) return this.result()
          this.copyMatch(match.offset, match.count)
          current = 'matchDone'
          break
        }
        case 'matchDone': {
          const literals = this.source[this.input - 2]! & 3
          if (literals === 0) {
            current = 'outer'
            break
          }
          value = literals
          current = 'matchNext'
          break
        }
        case 'matchNext': {
          this.copyLiterals(value)
          value = this.byte()
          current = 'match'
          break
        }
      }
    }
  }

  /** 匹配分支：token 高两位决定偏移与长度的编码方式。 */
  private readMatch(token: number): Match {
    if (token >= 64) {
      const run = (token >> 5) - 1
      return { offset: 1 + ((token >> 2) & 7) + (this.byte() << 3), count: run + 2, isEnd: false }
    }
    if (token >= 32) {
      const raw = token & 31
      const run = raw === 0 ? this.extendRun(31) : raw
      const low = this.byte()
      const high = this.byte()
      return { offset: 1 + (low >> 2) + (high << 6), count: run + 2, isEnd: false }
    }
    if (token >= 16) {
      const raw = token & 7
      const run = raw === 0 ? this.extendRun(7) : raw
      const low = this.byte()
      const high = this.byte()
      const base = (low >> 2) + (high << 6)
      if (base === 0 && (token & 8) === 0) return { offset: 0, count: 0, isEnd: true }
      return { offset: base + ((token & 8) << 11) + M3_MAX_OFFSET, count: run + 2, isEnd: false }
    }
    return { offset: 1 + (token >> 2) + (this.byte() << 2), count: 2, isEnd: false }
  }

  /** 扩展游程长度：连续的 0 字节各贡献 255，最后加上基值与终结字节。 */
  private extendRun(base: number): number {
    let total = 0
    for (;;) {
      const next = this.byte()
      if (next !== 0) return total + base + next
      total += 255
    }
  }

  private copyNearMatch(token: number): void {
    this.copyMatch(1 + M2_MAX_OFFSET + (token >> 2) + (this.byte() << 2), 3)
  }

  private copyLiterals(count: number): void {
    if (this.input + count > this.source.length) throw new TruncatedInputError(this.input + count, this.input)
    this.ensure(this.written + count)
    this.output.set(this.source.subarray(this.input, this.input + count), this.written)
    this.input += count
    this.written += count
  }

  /** 逐字节拷贝：LZO 的匹配允许与输出重叠，不能整段 copy。 */
  private copyMatch(offset: number, count: number): void {
    if (offset <= 0 || offset > this.written) throw new TruncatedInputError(this.input, this.written)
    this.ensure(this.written + count)
    for (let index = 0; index < count; index++) {
      this.output[this.written] = this.output[this.written - offset]!
      this.written += 1
    }
  }

  private byte(): number {
    if (this.input >= this.source.length) throw new TruncatedInputError(this.input + 1, this.input)
    return this.source[this.input++]!
  }

  private ensure(size: number): void {
    if (size <= this.output.length) return
    let capacity = this.output.length
    while (capacity < size) capacity *= 2
    const grown = new Uint8Array(capacity)
    grown.set(this.output.subarray(0, this.written))
    this.output = grown
  }

  private result(): Uint8Array {
    return this.output.subarray(0, this.written)
  }
}

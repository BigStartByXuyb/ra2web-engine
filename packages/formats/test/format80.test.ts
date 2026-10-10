import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decompressFormat80 } from '../src/format80.js'

/** 填充命令：`0xFE` + u16 份数 + 字节。 */
function fill(count: number, value: number): number[] {
  return [0xfe, count & 0xff, count >> 8, value]
}

/** 字面量命令：`0x80 | 份数` + 各字节。 */
function literal(values: readonly number[]): number[] {
  return [0x80 | values.length, ...values]
}

const END = [0x80]

test('五种命令都能解出，且输出与手算一致', () => {
  const stream = Uint8Array.from([
    ...literal([0x41, 0x42, 0x43]),
    ...fill(4, 0),
    0x00,
    0x02, // 相对回抄：份数 (0>>4)+3 = 3，距离 2
    0xc1,
    0x00,
    0x00, // 绝对回抄：份数 (1)+3 = 4，下标 0
    0xff,
    0x08,
    0x00,
    0x00,
    0x00, // 长回抄：份数 8，下标 0
    ...literal([0x58, 0x59]),
    ...END,
  ])
  assert.deepEqual(
    [...decompressFormat80(stream, [24])],
    [0x41, 0x42, 0x43, 0, 0, 0, 0, 0, 0, 0, 0x41, 0x42, 0x43, 0, 0x41, 0x42, 0x43, 0, 0, 0, 0, 0, 0x58, 0x59],
  )
})

test('回抄允许重叠：距离 1 就是重复上一字节', () => {
  const stream = Uint8Array.from([...literal([0x41]), 0x00, 0x01, ...END]) // 份数 3、距离 1
  assert.deepEqual([...decompressFormat80(stream, [4])], [0x41, 0x41, 0x41, 0x41])
})

test('段与段之间输出连续，回抄可跨段', () => {
  const stream = Uint8Array.from([
    ...literal([0x41, 0x42]),
    ...END,
    0xc0,
    0x00,
    0x00, // 绝对回抄：份数 3，下标 0（落在上一段）
    ...END,
  ])
  assert.deepEqual([...decompressFormat80(stream, [2, 3])], [0x41, 0x42, 0x41, 0x42, 0x41])
})

test('回抄下标越界与段提前结束都报错', () => {
  assert.throws(() => decompressFormat80(Uint8Array.from([0xc1, 0x05, 0x00, ...END]), [4]), /回抄越界/)
  assert.throws(() => decompressFormat80(Uint8Array.from([...literal([0x41]), ...END]), [4]), /段提前结束/)
  assert.throws(() => decompressFormat80(Uint8Array.from([...fill(9, 0), ...END]), [4]), /填充超出输出/)
})

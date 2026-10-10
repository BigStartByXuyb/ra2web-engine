import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decompressLzo1x } from '../src/lzo1x.js'

/**
 * 手工构造的 LZO1X 流：这样可以在没有原版素材的情况下验证解码器的分支。
 *
 *  - 纯字面量：token(17+N) + N 字节 + `11 00 00`（流结束标记）
 *  - 字面量 + 一次匹配：token 108 是"偏移 4、长度 4"的编码，正好重复前 4 字节
 */

const END_MARKER = [0x11, 0x00, 0x00]

test('纯字面量流解出原始字节', () => {
  const payload = [0x41, 0x42, 0x43, 0x44]
  const stream = Uint8Array.from([17 + payload.length, ...payload, ...END_MARKER])
  assert.deepEqual([...decompressLzo1x(stream)], payload)
})

test('字面量之后的匹配按偏移复制', () => {
  const stream = Uint8Array.from([21, 0x41, 0x42, 0x43, 0x44, 108, 0x00, ...END_MARKER])
  assert.deepEqual([...decompressLzo1x(stream)], [0x41, 0x42, 0x43, 0x44, 0x41, 0x42, 0x43, 0x44])
})

test('匹配越界时抛错，不静默产出垃圾', () => {
  const stream = Uint8Array.from([21, 0x41, 0x42, 0x43, 0x44, 108, 0x80, ...END_MARKER])
  assert.throws(() => decompressLzo1x(stream), /truncated|needs/i)
})

test('缺少结束标记的流判为截断', () => {
  const stream = Uint8Array.from([21, 0x41, 0x42, 0x43, 0x44])
  assert.throws(() => decompressLzo1x(stream), /truncated|needs/i)
})

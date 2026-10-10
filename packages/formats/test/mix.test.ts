import assert from 'node:assert/strict'
import { test } from 'node:test'
import { crc32 } from '../src/crc32.js'
import { hashFileName, readMixIndex } from '../src/mix.js'
import { UnsupportedMixHeaderError } from '../src/errors.js'

test('文件名哈希与原版 MIX 索引一致', () => {
  // 期望值来自原版 RA2.MIX 的真实索引条目
  assert.equal(hashFileName('htnk.vxl', crc32), 0x77659939)
  assert.equal(hashFileName('htnktur.vxl', crc32), 0x8f537e7e)
  assert.equal(hashFileName('htnkbarl.vxl', crc32), 0x293cf40f)
  assert.equal(hashFileName('rules.ini', crc32), 0xf025a96c)
  assert.equal(hashFileName('art.ini', crc32), 0xf91b2c8b)
})

test('文件名哈希大小写不敏感', () => {
  assert.equal(hashFileName('HTNK.VXL', crc32), hashFileName('htnk.vxl', crc32))
})

test('解析无加密头的最小 MIX', () => {
  // 2 个条目：文件数据紧跟在索引之后
  const bytes = new Uint8Array(6 + 2 * 12 + 8)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 2, true)
  view.setUint32(2, 8, true)
  view.setUint32(6, 0x11111111, true)
  view.setUint32(10, 0, true)
  view.setUint32(14, 4, true)
  view.setUint32(18, 0x22222222, true)
  view.setUint32(22, 4, true)
  view.setUint32(26, 4, true)

  const index = readMixIndex(bytes)
  assert.equal(index.dataStart, 30)
  assert.equal(index.entries.length, 2)
  assert.deepEqual(index.entries[1], { hash: 0x22222222, offset: 4, length: 4 })
})

test('加密头 MIX 明确报不支持', () => {
  const bytes = new Uint8Array(64)
  new DataView(bytes.buffer).setUint32(0, 0x00020000, true)
  assert.throws(() => readMixIndex(bytes), UnsupportedMixHeaderError)
})

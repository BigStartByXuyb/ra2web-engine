import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readPalette } from '../src/pal.js'
import { TruncatedInputError } from '../src/errors.js'

function paletteBytes(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(768)
  values.forEach((value, index) => (bytes[index] = value))
  return bytes
}

test('6 位分量左移 2 位还原为 8 位', () => {
  const palette = readPalette(paletteBytes([63, 32, 0]))
  assert.deepEqual(palette.colors[0], { r: 252, g: 128, b: 0 })
  assert.equal(palette.colors.length, 256)
})

test('已经是 8 位的调色板原样返回', () => {
  const palette = readPalette(paletteBytes([255, 200, 100]))
  assert.deepEqual(palette.colors[0], { r: 255, g: 200, b: 100 })
})

test('长度不足报截断错误', () => {
  assert.throws(() => readPalette(new Uint8Array(767)), TruncatedInputError)
})

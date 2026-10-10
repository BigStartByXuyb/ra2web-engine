import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Palette, ShpFile } from '@ra2web/formats'
import { paintShpFrame } from '../src/shp-image.js'

const palette: Palette = {
  colors: Array.from({ length: 256 }, (_, index) => ({ r: index, g: index * 2, b: index * 3 })),
}

const shp: ShpFile = { width: 4, height: 3, frames: [] }

test('帧按自身 x/y 贴进整幅画布，索引 0 透明，画布其余部分也透明', () => {
  const image = paintShpFrame(
    shp,
    {
      x: 1,
      y: 1,
      width: 2,
      height: 2,
      compressionType: 0,
      pixels: Uint8Array.from([5, 0, 7, 9]),
      isEmpty: false,
    },
    palette,
  )
  assert.deepEqual([image.width, image.height], [4, 3])
  const pixel = (x: number, y: number): number[] => {
    const at = (y * image.width + x) * 4
    return [image.rgba[at]!, image.rgba[at + 1]!, image.rgba[at + 2]!, image.rgba[at + 3]!]
  }
  assert.deepEqual(pixel(1, 1), [5, 10, 15, 255])
  assert.deepEqual(pixel(2, 1), [0, 0, 0, 0], '索引 0 是透明')
  assert.deepEqual(pixel(1, 2), [7, 14, 21, 255])
  assert.deepEqual(pixel(2, 2), [9, 18, 27, 255])
  assert.deepEqual(pixel(0, 0), [0, 0, 0, 0])
})

test('空帧画出全透明画布', () => {
  const image = paintShpFrame(
    shp,
    { x: 0, y: 0, width: 0, height: 0, compressionType: 3, pixels: new Uint8Array(0), isEmpty: true },
    palette,
  )
  assert.equal(
    image.rgba.some((value, index) => index % 4 === 3 && value !== 0),
    false,
  )
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Palette, TmpFile, TmpSubTile } from '@ra2web/formats'
import { paintTmpSubTile } from '../src/tile-image.js'

const palette: Palette = {
  colors: Array.from({ length: 256 }, (_, index) => ({ r: index, g: index * 2, b: index * 3 })),
}

const tile: TmpFile = { cellsX: 1, cellsY: 1, cellWidth: 60, cellHeight: 30, subTiles: [] }

function subTileWith(pixels: Uint8Array): TmpSubTile {
  return {
    pixelX: 0,
    pixelY: 0,
    size: pixels.length,
    flags: 0,
    height: 0,
    terrainType: 0,
    rampType: 0,
    pixels,
    isEmpty: false,
  }
}

function colorAt(image: ReturnType<typeof paintTmpSubTile>, x: number, y: number): [number, number, number, number] {
  const at = (y * image.width + x) * 4
  return [image.rgba[at]!, image.rgba[at + 1]!, image.rgba[at + 2]!, image.rgba[at + 3]!]
}

test('菱形之内的像素按调色板上色，之外保持透明', () => {
  const pixels = new Uint8Array(900).fill(7)
  const image = paintTmpSubTile(tile, subTileWith(pixels), palette)
  assert.equal(image.width, 60)
  assert.equal(image.height, 30)

  // 首行只覆盖 x = 28..31，四角必须透明
  assert.deepEqual(colorAt(image, 28, 0), [7, 14, 21, 255])
  assert.deepEqual(colorAt(image, 0, 0), [0, 0, 0, 0])
  assert.deepEqual(colorAt(image, 59, 0), [0, 0, 0, 0])
  // 第 15 行起向右缩，左边界是 x = 2
  assert.deepEqual(colorAt(image, 1, 15), [0, 0, 0, 0])
  assert.deepEqual(colorAt(image, 2, 15), [7, 14, 21, 255])
  // 最后一行不落像素
  assert.deepEqual(colorAt(image, 30, 29), [0, 0, 0, 0])
})

test('索引 0 是透明索引，不是颜色', () => {
  const pixels = new Uint8Array(900).fill(200)
  pixels[0] = 0 // 首行首像素
  const image = paintTmpSubTile(tile, subTileWith(pixels), palette)
  assert.deepEqual(colorAt(image, 28, 0), [0, 0, 0, 0])
  assert.deepEqual(colorAt(image, 29, 0), [200, 144, 88, 255])
})

test('空槽位画出全透明图', () => {
  const empty: TmpSubTile = {
    pixelX: 0,
    pixelY: 0,
    size: 0,
    flags: 0,
    height: 0,
    terrainType: 0,
    rampType: 0,
    pixels: new Uint8Array(0),
    isEmpty: true,
  }
  const image = paintTmpSubTile(tile, empty, palette)
  const opaque = image.rgba.filter((_, index) => index % 4 === 3).some((alpha) => alpha !== 0)
  assert.equal(opaque, false)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RgbaImage } from '../src/image.js'
import { composeSpriteStrip } from '../src/sprite-strip.js'
import type { VoxelSprite } from '../src/voxel-sprite.js'

const GROUND = { r: 20, g: 24, b: 28, a: 255 }

/** 手工造"精灵"：只有首像素带标记，用于判断它被放到了哪一行哪一列。 */
function makeSprite(width: number, height: number, anchorX: number, anchorY: number, marker: number): VoxelSprite {
  const rgba = new Uint8Array(width * height * 4)
  rgba[0] = marker
  rgba[3] = 255
  return { facing: 0, width, height, rgba, originX: 0, originY: 0, anchorX, anchorY }
}

function pixelAt(image: RgbaImage, x: number, y: number): readonly number[] {
  const at = (y * image.width + x) * 4
  return [...image.rgba.slice(at, at + 4)]
}

/** 左档 3×4、贴地线在第 2 行；右档 2×6、贴地线在第 4 行。 */
function buildStrip(): RgbaImage {
  return composeSpriteStrip([makeSprite(3, 4, 1, 2, 10), makeSprite(2, 6, 0, 4, 20)], GROUND)
}

test('拼图宽度是各档之和，高度覆盖所有贴地线', () => {
  const strip = buildStrip()
  assert.equal(strip.width, 5)
  assert.equal(strip.height, 4 + 2, '贴地线取最高的一档，下方留出最长的一档')
})

test('各档按贴地线对齐', () => {
  const strip = buildStrip()
  assert.deepEqual(pixelAt(strip, 0, 0), [GROUND.r, GROUND.g, GROUND.b, 255], '左上角是底色')
  assert.equal(pixelAt(strip, 0, 2)[0], 10, '左档贴地线在其第 2 行处')
  assert.equal(pixelAt(strip, 3, 0)[0], 20, '右档从拼图第 0 行开始')
})

test('空输入返回空图', () => {
  assert.equal(composeSpriteStrip([], GROUND).rgba.length, 0)
})

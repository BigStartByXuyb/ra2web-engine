import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FACING_COUNT, normalizeFacing, renderVoxelSprite, type VoxelSprite } from '../src/voxel-sprite.js'
import { buildDemoVoxelModels } from '../src/demo-model.js'
import { positionVoxelModel, type PositionedModel } from '../src/voxel-model.js'
import { buildSingleVoxelModel, hashBytes } from './fixture.js'

/** 合成模型在 facing=0、每体素 1 像素、留 1 体素边距下的像素快照。 */
const SYNTHETIC_FACING_0_SNAPSHOT = '29d36f41'

function buildModel(): PositionedModel {
  return positionVoxelModel(buildDemoVoxelModels())
}

function renderAllFacings(model: PositionedModel, pixelsPerVoxel: number): readonly VoxelSprite[] {
  return Array.from({ length: FACING_COUNT }, (_unused, facing) => renderVoxelSprite(model, { facing, pixelsPerVoxel }))
}

test('单个体素：精灵按内容裁剪，尺寸只由像素尺度与边距决定', () => {
  const model = positionVoxelModel(buildSingleVoxelModel())
  const tight = renderVoxelSprite(model, { facing: 0, pixelsPerVoxel: 1, paddingInVoxels: 0 })
  assert.deepEqual([tight.width, tight.height, tight.anchorX, tight.anchorY], [1, 1, 0, 0])
  assert.equal(tight.rgba[3], 255, '被画的体素像素应当不透明')

  const padded = renderVoxelSprite(model, { facing: 0, pixelsPerVoxel: 3, paddingInVoxels: 2 })
  assert.deepEqual([padded.width, padded.height], [3 + 12, 3 + 12])
  assert.deepEqual([padded.anchorX, padded.anchorY], [6, 6], '锚点应落在边距中心')
})

test('8 个朝向互不相同，且朝向计数按 8 取模', () => {
  const model = buildModel()
  const hashes = renderAllFacings(model, 2).map((sprite) => hashBytes(sprite.rgba))
  assert.equal(new Set(hashes).size, FACING_COUNT, `朝向精灵有重复：${hashes.join(',')}`)
  assert.equal(normalizeFacing(8), 0)
  assert.equal(normalizeFacing(-1), FACING_COUNT - 1)
  assert.deepEqual(
    renderVoxelSprite(model, { facing: 8, pixelsPerVoxel: 2 }).rgba,
    renderVoxelSprite(model, { facing: 0, pixelsPerVoxel: 2 }).rgba,
  )
})

test('枢轴投影位置不随朝向变化（贴图对齐用）', () => {
  const model = buildModel()
  const pivots = renderAllFacings(model, 2).map(
    (sprite) => `${sprite.originX + sprite.anchorX}/${sprite.originY + sprite.anchorY}`,
  )
  assert.equal(new Set(pivots).size, 1, `枢轴随朝向漂移了：${pivots.join(',')}`)
})

test('背景按给定颜色填充，模型像素保持不透明', () => {
  const sprite = renderVoxelSprite(positionVoxelModel(buildSingleVoxelModel()), {
    facing: 0,
    pixelsPerVoxel: 1,
    paddingInVoxels: 1,
    background: { r: 20, g: 24, b: 28, a: 255 },
  })
  assert.deepEqual([...sprite.rgba.slice(0, 4)], [20, 24, 28, 255], '边距应当是背景色')
  assert.deepEqual([...sprite.rgba.slice(16, 20)], [4, 8, 12, 255], '中心是体素自身的颜色')
})

test('空模型返回零尺寸精灵，不产生 NaN', () => {
  const sprite = renderVoxelSprite(positionVoxelModel([]), { facing: 3, pixelsPerVoxel: 4 })
  assert.deepEqual([sprite.width, sprite.height, sprite.anchorX, sprite.anchorY], [0, 0, 0, 0])
  assert.equal(sprite.rgba.length, 0)
})

test('像素快照固定（回归用）', () => {
  const sprite = renderVoxelSprite(buildModel(), { facing: 0, pixelsPerVoxel: 1, paddingInVoxels: 1 })
  assert.deepEqual([sprite.width, sprite.height], [7, 7])
  assert.equal(hashBytes(sprite.rgba), SYNTHETIC_FACING_0_SNAPSHOT)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paletteColor, type VxlModel } from '@ra2web/formats'
import { buildDemoVoxelModels } from '../src/demo-model.js'
import { modelBounds, positionVoxelModel } from '../src/voxel-model.js'

/** 把体素列表压成可比对的稳定字符串（排序后比较，不依赖输入顺序）。 */
function describeVoxels(model: { voxels: readonly { x: number; y: number; z: number; colorIndex: number }[] }): string {
  return model.voxels
    .map((voxel) => `${voxel.x},${voxel.y},${voxel.z},${voxel.colorIndex}`)
    .sort()
    .join(' | ')
}

test('各节按包围盒平移后拼成整机坐标', () => {
  const model = positionVoxelModel(buildDemoVoxelModels())
  assert.equal(
    describeVoxels(model),
    [
      '0,0,0,10',
      '1,0,0,11',
      '2,0,0,12',
      '3,0,0,13',
      '0,1,0,14',
      '1,1,0,15',
      '2,1,0,16',
      '1,2,0,17',
      '1,1,1,18',
      '2,1,1,19',
      '1,1,3,20',
      '2,1,3,21',
    ]
      .sort()
      .join(' | '),
  )
  assert.deepEqual([model.spanX, model.spanY, model.spanZ], [4, 3, 4])
})

test('归一化到原点：整体平移不改变形状', () => {
  const shifted = buildDemoVoxelModels().map((source) => ({
    ...source,
    sections: source.sections.map((section) => ({
      ...section,
      bounds: {
        min: [section.bounds.min[0] - 3, section.bounds.min[1] + 2, section.bounds.min[2] + 5] as const,
        max: [section.bounds.max[0] - 3, section.bounds.max[1] + 2, section.bounds.max[2] + 5] as const,
      },
    })),
  })) satisfies readonly VxlModel[]

  const original = positionVoxelModel(buildDemoVoxelModels())
  const moved = positionVoxelModel(shifted)
  assert.equal(describeVoxels(moved), describeVoxels(original))
  assert.deepEqual([moved.spanX, moved.spanY, moved.spanZ], [4, 3, 4])
})

test('取第一份内嵌调色板，并保留 6 位 → 8 位的放大结果', () => {
  const model = positionVoxelModel(buildDemoVoxelModels())
  assert.ok(model.palette, '应当取到机体的内嵌调色板')
  assert.deepEqual(paletteColor(model.palette, 1), { r: 4, g: 8, b: 12 })
})

test('空输入返回空模型而不是抛异常', () => {
  const model = positionVoxelModel([])
  assert.equal(model.voxels.length, 0)
  assert.deepEqual([model.spanX, model.spanY, model.spanZ], [0, 0, 0])
  assert.equal(model.palette, undefined)
})

test('modelBounds 给出紧包围盒', () => {
  const bounds = modelBounds([
    { x: 2, y: -1, z: 0, colorIndex: 0, normalIndex: 0 },
    { x: -3, y: 4, z: 7, colorIndex: 0, normalIndex: 0 },
  ])
  assert.deepEqual(bounds, { minX: -3, minY: -1, minZ: 0, maxX: 2, maxY: 4, maxZ: 7 })
})

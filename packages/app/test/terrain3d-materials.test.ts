import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paletteColor, type Palette } from '@ra2web/formats'
import {
  fallbackMaterial,
  detailOctaveWeights,
  sampleTerrainMaterials,
  waterFrameAlbedos,
  TERRAIN_PBR_STYLE,
  type MaterialSampleInput,
} from '../src/game/terrain3d-materials.js'

/** 4 色测试调色板：0 黑(透明保留字)、1 纯红、2 纯绿、3 纯蓝 */
const TEST_PALETTE: Palette = {
  colors: [0, 1, 2, 3].map((channel) => ({
    r: channel === 1 ? 255 : 0,
    g: channel === 2 ? 255 : 0,
    b: channel === 3 ? 255 : 0,
  })),
}

const sample = (terrainType: number, ...pixelIndices: number[]): MaterialSampleInput => ({
  terrainType,
  pixelIndices: Uint8Array.from(pixelIndices),
})

test('按 terrainType 归组：像素均值进对应地块类型的 albedo', () => {
  // terrainType 13 → Clear：一半红一半绿 → 均值 (0.5, 0.5, 0)
  const materials = sampleTerrainMaterials([sample(13, 1, 1, 2, 2)], TEST_PALETTE)
  const clear = materials.get('Clear')!
  assert.deepEqual(clear.albedo.map((v) => Math.round(v * 100) / 100), [0.5, 0.5, 0])
})

test('同一类型跨子块累积，不互相覆盖', () => {
  const materials = sampleTerrainMaterials([sample(9, 1), sample(9, 2)], TEST_PALETTE)
  const water = materials.get('Water')!
  assert.deepEqual(water.albedo.map((v) => Math.round(v * 100) / 100), [0.5, 0.5, 0])
})

test('透明索引 0 不计入均值', () => {
  const materials = sampleTerrainMaterials([sample(13, 0, 1)], TEST_PALETTE)
  assert.deepEqual(materials.get('Clear')!.albedo, [1, 0, 0])
})

test('通道方差：全同色方差为 0，红/蓝各半时红通道标准差为 0.5', () => {
  const same = sampleTerrainMaterials([sample(13, 1, 1)], TEST_PALETTE).get('Clear')!
  assert.deepEqual(same.variance, [0, 0, 0])
  const redBlue = sampleTerrainMaterials([sample(14, 1, 3)], TEST_PALETTE).get('Rough')!
  // r 通道取值 [1,0]：均值 0.5、E[r2]=0.5 → 方差 0.25 → 标准差 0.5
  assert.ok(Math.abs(redBlue.variance[0]! - 0.5) < 1e-9, `红通道标准差应为 0.5，实际 ${redBlue.variance[0]}`)
  assert.equal(redBlue.variance[1]!, 0)
})

test('未认识的 terrainType（1..4、>15）不产生键，也不抛错', () => {
  const materials = sampleTerrainMaterials([sample(3, 1), sample(99, 2)], TEST_PALETTE)
  assert.equal(materials.size, 0)
})

test('回退档是有限数值，不为 NaN', () => {
  const fallback = fallbackMaterial()
  for (const value of [...fallback.albedo, ...fallback.variance]) {
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1)
  }
})

test('自定 PBR 参数表覆盖全部 11 种地块类型，roughness 落在 0..1', () => {
  for (const name of [
    'Clear', 'Road', 'Rock', 'Beach', 'Rough', 'Railroad', 'Weeds', 'Water', 'Wall', 'Tiberium', 'Cliff',
  ] as const) {
    const style = TERRAIN_PBR_STYLE[name]
    assert.ok(style.roughness >= 0 && style.roughness <= 1, `${name} roughness 越界`)
    assert.ok(style.metallic >= 0 && style.metallic <= 1, `${name} metallic 越界`)
    assert.ok(style.noiseScale > 0, `${name} noiseScale 必须为正`)
  }
})

test('空输入返回空表（调用方走回退档）', () => {
  assert.equal(sampleTerrainMaterials([], TEST_PALETTE).size, 0)
})

test('崖集分档采样：cliffSet 子块另立档位键，与 terrainType 桶互不混', () => {
  const inputs: MaterialSampleInput[] = [
    { terrainType: 15, pixelIndices: Uint8Array.from([1]) }, // Cliff 型像素 → Cliff 桶
    { terrainType: 15, pixelIndices: Uint8Array.from([2]), cliffSet: 'waterCliff' }, // 水崖集 → waterCliff 桶
    { terrainType: 15, pixelIndices: Uint8Array.from([3]), cliffSet: 'cliff' },
  ]
  const materials = sampleTerrainMaterials(inputs, TEST_PALETTE)
  const near = (v: readonly number[], want: number[]) => v.every((c, i) => Math.abs(c - want[i]!) < 1e-6)
  assert.ok(near(materials.get('waterCliff')!.albedo, [0, 1, 0]), 'waterCliff 档应只吃绿像素')
  assert.ok(near(materials.get('cliff')!.albedo, [0, 0, 1]), 'cliff 档应只吃蓝像素')
  assert.deepEqual(materials.get('Cliff')!.albedo, [1, 0, 0], 'terrainType 桶只应含未标崖集的子块')
})

test('水面帧色表：每帧取该帧像素均值，透明 0 不计', () => {
  const frames = [
    { pixelIndices: Uint8Array.from([1, 1]) }, // 纯红
    { pixelIndices: Uint8Array.from([2, 2]) }, // 纯绿
    { pixelIndices: Uint8Array.from([3]) },    // 纯蓝
  ]
  const table = waterFrameAlbedos(frames, TEST_PALETTE)
  assert.equal(table.length, 3)
  assert.deepEqual(table[0], [1, 0, 0])
  assert.deepEqual(table[1], [0, 1, 0])
  assert.deepEqual(table[2], [0, 0, 1])
})

test('水面帧色表：空像素帧给 undefined 占位（调用方回落前一帧）', () => {
  const frames = [{ pixelIndices: Uint8Array.from([1]) }, { pixelIndices: Uint8Array.from([]) }]
  const table = waterFrameAlbedos(frames, TEST_PALETTE)
  assert.deepEqual(table[0], [1, 0, 0])
  assert.equal(table[1], undefined)
})

test('水面帧色表：全空返回空表（缺 WaterSet 图时调用方走静态 Water 采样）', () => {
  assert.equal(waterFrameAlbedos([], TEST_PALETTE).length, 0)
})

test('细节层倍频权重：放大时三档全开，缩小时按 Nyquist 逐档关闭（防走样）', () => {
  // worldPerPixel = 每屏幕像素占多少世界像素；scale=1 → 1.0；zoom 放大 4 倍 → 0.25
  // 设计：三档参考频率 0.25/0.5/1.0（周期 4/2/1 世界像素）；权重 = clamp(2 − 2·wpp·f, 0, 1)
  // —— 周期 ≥2 屏幕像素才全权重（Nyquist），周期 ≤1 屏幕像素关到 0
  assert.deepEqual(detailOctaveWeights(0.25), [1, 1, 1], '放大 4 倍时三档全开（周期换算后全部 ≥2 屏幕像素）')
  assert.deepEqual(detailOctaveWeights(0.5), [1, 1, 1], '2 倍放大仍三档全开（1 世界像素=2 屏幕像素）')
  assert.deepEqual(detailOctaveWeights(1), [1, 1, 0], '100% 时 1 世界像素档（=1 屏幕像素）关闭')
  assert.deepEqual(detailOctaveWeights(2), [1, 0, 0], '缩小时逐档关闭')
  assert.deepEqual(detailOctaveWeights(4), [0, 0, 0], '2 倍缩小时细节全关（防闪烁）')
  assert.deepEqual(detailOctaveWeights(16), [0, 0, 0])
  let previous = 1
  for (const wpp of [0.1, 0.25, 0.5, 1, 2, 4, 8, 16]) {
    const weight = detailOctaveWeights(wpp)[2]!
    assert.ok(weight <= previous + 1e-9, `wpp=${wpp} 权重应单调不增`)
    previous = weight
  }
})

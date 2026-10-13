import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapCell, MapFile } from '@ra2web/formats'
import { buildMapPreview, type MapPreview } from '../src/game/map-preview.js'
import { buildTerrain3dGeometry, STRIDE } from '../src/game/terrain3d-geometry.js'

/** 造一张 width×height 的地图，每格 tileIndex=0/subTile=0，z 由 zOf 决定 */
function flatMap(width: number, height: number, zOf: (x: number, y: number) => number): MapPreview {
  const cells: MapCell[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      cells.push({ cellX: x, cellY: y, tileIndex: 0, subTile: 0, z: zOf(x, y) } as MapCell)
    }
  }
  const map = {
    width,
    height,
    cellBounds: { left: 0, top: 0, right: width, bottom: height },
    theater: 'snow',
    cells,
    placements: [],
  } as unknown as MapFile
  return buildMapPreview(map)
}

const allClear = () => 'Clear' as const
const noMaterials = undefined

test('常量：交错步长 11', () => {
  assert.equal(STRIDE, 11)
})

test('平地图：只有顶面，z 全 0，法线全朝上', () => {
  const data = buildTerrain3dGeometry(flatMap(2, 2, () => 0), 10, allClear, noMaterials)
  assert.equal(data.vertexCount % 6, 0)
  for (let i = 0; i < data.vertexCount; i++) {
    const at = i * STRIDE
    assert.equal(data.vertices[at + 2]!, 0, `顶点 ${i} z 应为 0`)
    assert.equal(data.vertices[at + 5]!, 1, `顶点 ${i} 法线 z 分量应为 1`)
    assert.equal(data.vertices[at + 3]!, 0)
    assert.equal(data.vertices[at + 4]!, 0)
  }
})

test('抬升格：顶面四角 z 相同且等于 level×zStep', () => {
  const data = buildTerrain3dGeometry(flatMap(2, 2, () => 3), 10, allClear, noMaterials)
  for (let i = 0; i < data.vertexCount; i++) {
    assert.equal(data.vertices[i * STRIDE + 2]!, 30, `顶点 ${i} z 应为 3×10`)
  }
})

test("landTypeAt 返回 'Unknown' 时落回退档（无 NaN）", () => {
  const data = buildTerrain3dGeometry(flatMap(1, 1, () => 0), 10, () => 'Unknown', noMaterials)
  for (let corner = 0; corner < 6; corner++) {
    const at = corner * STRIDE
    for (let channel = 6; channel <= 10; channel++) {
      assert.ok(Number.isFinite(data.vertices[at + channel]!), `通道 ${channel} 应有限`)
    }
  }
})

test('材质：landTypeAt 给 Water 时顶点带 Water 的 albedo', () => {
  const materials = new Map([
    ['Water', { albedo: [0.1, 0.2, 0.3] as const, variance: [0.01, 0.01, 0.01] as const }],
  ])
  const data = buildTerrain3dGeometry(flatMap(1, 1, () => 0), 10, () => 'Water', materials)
  assert.equal(data.vertexCount, 6)
  for (let corner = 0; corner < 6; corner++) {
    const at = corner * STRIDE
    // Float32 存储：按容差比
    for (const [channel, expected] of [[6, 0.1], [7, 0.2], [8, 0.3]] as const) {
      assert.ok(Math.abs(data.vertices[at + channel]! - expected) < 1e-6, `通道 ${channel} 应为 ${expected}`)
    }
  }
})

test('单级落差：出现崖壁面，上角 z 高、下角 z 低、同一竖直边上 worldY 相等', () => {
  // (x,0) 高 1、(x,1) 高 0 → 两格之间的边上生成崖壁
  const data = buildTerrain3dGeometry(flatMap(2, 2, (_x, y) => (y === 0 ? 1 : 0)), 10, allClear, noMaterials)
  let wallFaces = 0
  for (let face = 0; face < data.vertexCount / 6; face++) {
    const zs = [0, 1, 2, 3, 4, 5].map((corner) => data.vertices[(face * 6 + corner) * STRIDE + 2]!)
    if (new Set(zs).size === 1) continue // 顶面：6 顶点同 z
    assert.equal(new Set(zs).size, 2, `面 ${face} 应是崖壁（z 只有两档）`)
    wallFaces++
    // 竖直面校验：竖直棱两端的**真实 worldY** 相等。缓冲 y 通道 = corner.y + z（已折叠 z），
    // 直接读它；缓冲顶点序 = 四角 [0,1,2, 0,2,3]，两条竖直棱即 (idx1,idx2) 与 (idx0,idx5)
    const worldY = (bufferCorner: number) => data.vertices[(face * 6 + bufferCorner) * STRIDE + 1]!
    assert.equal(
      worldY(1).toFixed(4),
      worldY(2).toFixed(4),
      `面 ${face} 竖直棱 (1,2) 两端 worldY 不相等（不是竖直面）`,
    )
    assert.equal(
      worldY(0).toFixed(4),
      worldY(5).toFixed(4),
      `面 ${face} 竖直棱 (0,5) 两端 worldY 不相等（不是竖直面）`,
    )
  }
  assert.ok(wallFaces >= 1, '应至少有一个崖壁面')
})

test('崖壁法线水平朝外：z 分量为 0、xy 长度归一', () => {
  const data = buildTerrain3dGeometry(flatMap(2, 2, (_x, y) => (y === 0 ? 1 : 0)), 10, allClear, noMaterials)
  let checked = 0
  for (let face = 0; face < data.vertexCount / 6; face++) {
    const zs = [0, 1, 2].map((corner) => data.vertices[(face * 6 + corner) * STRIDE + 2]!)
    if (new Set(zs).size === 1) continue
    for (let corner = 0; corner < 3; corner++) {
      const at = (face * 6 + corner) * STRIDE
      const nx = data.vertices[at + 3]!
      const ny = data.vertices[at + 4]!
      const nz = data.vertices[at + 5]!
      assert.equal(nz, 0, '崖壁法线 z 分量应为 0')
      assert.ok(Math.abs(Math.hypot(nx, ny) - 1) < 1e-4, '崖壁法线应归一')
      checked++
    }
  }
  assert.ok(checked >= 3, '应检查到崖壁顶点')
})

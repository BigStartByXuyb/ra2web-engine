import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RA2_ISO_VIEW, type ScreenPoint } from '../src/iso.js'
import { RAMP_HEIGHTS, buildTerrainMesh, interpolateRampHeight, type TerrainFace } from '../src/terrain-mesh.js'

/**
 * 3D 地形网格：抬高必须与崖壁同时生成。
 *
 * 关键判据是**不留缝**：每块崖壁的上边与高的一侧的共边完全重合、下边与低的一侧的共边完全重合。
 * 只抬高不补面，就会在没有悬崖图块的地方漏出竖向空洞 —— 这几条就是那道红线的回归。
 */
const Z_STEP = 15

function meshOf(levels: ReadonlyMap<string, number>, cells: readonly { cellX: number; cellY: number }[]) {
  return buildTerrainMesh({
    view: RA2_ISO_VIEW,
    zStep: Z_STEP,
    cells,
    levelAt: (x, y) => levels.get(`${x},${y}`),
  })
}

function samePoint(left: ScreenPoint, right: ScreenPoint): boolean {
  return left.x === right.x && left.y === right.y
}

describe('3D 地形网格', () => {
  it('平地只有顶面，不生成崖壁', () => {
    const faces = meshOf(new Map([['0,0', 2]]), [{ cellX: 0, cellY: 0 }])
    assert.equal(faces.length, 1)
    assert.equal(faces[0]!.kind, 'top')
  })

  it('一格高出一级：共边处生成一块崖壁，且上下两条边与两侧顶面完全重合', () => {
    const faces = meshOf(
      new Map([
        ['0,0', 1],
        ['1,0', 0],
      ]),
      [
        { cellX: 0, cellY: 0 },
        { cellX: 1, cellY: 0 },
      ],
    )
    const walls = faces.filter((face) => face.kind === 'wall')
    assert.equal(walls.length, 1)

    const high = faces.find((face) => face.kind === 'top' && face.cellX === 0)!
    const low = faces.find((face) => face.kind === 'top' && face.cellX === 1)!
    const wall = walls[0]!

    // 上边 = 高格那条共边（右→下）
    assert.ok(samePoint(wall.corners[0], high.corners[1]!))
    assert.ok(samePoint(wall.corners[1], high.corners[2]!))
    // 下边 = 低格那条共边（左→上），方向与高格那条相反
    assert.ok(samePoint(wall.corners[2], low.corners[3]!))
    assert.ok(samePoint(wall.corners[3], low.corners[0]!))
    // 高度差就是一级
    assert.equal(wall.corners[2]!.y - wall.corners[1]!.y, Z_STEP)
  })

  it('高差几级，崖壁就有几级高', () => {
    const faces = meshOf(
      new Map([
        ['0,0', 6],
        ['1,0', 2],
      ]),
      [
        { cellX: 0, cellY: 0 },
        { cellX: 1, cellY: 0 },
      ],
    )
    const wall = faces.find((face) => face.kind === 'wall')!
    assert.equal(wall.corners[2]!.y - wall.corners[1]!.y, 4 * Z_STEP)
  })

  it('四邻都低：四条边各生成一块崖壁', () => {
    const levels = new Map([
      ['0,0', 2],
      ['1,0', 1],
      ['-1,0', 1],
      ['0,1', 1],
      ['0,-1', 1],
    ])
    const faces = meshOf(levels, [{ cellX: 0, cellY: 0 }])
    assert.equal(faces.filter((face) => face.kind === 'wall').length, 4)
  })

  it('地图外按同高处理：边界格不生成崖壁', () => {
    const faces = meshOf(new Map([['0,0', 5]]), [{ cellX: 0, cellY: 0 }])
    assert.equal(faces.filter((face) => face.kind === 'wall').length, 0)
  })

  it('高低混合的 3×3 上，每一条有落差的边都恰好补一块崖壁', () => {
    const levels = new Map<string, number>()
    const cells: { cellX: number; cellY: number }[] = []
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        // 左半边高、右半边低，中间那条缝横跨三格
        levels.set(`${x},${y}`, x < 1 ? 3 : 1)
        cells.push({ cellX: x, cellY: y })
      }
    }
    const faces = meshOf(levels, cells)
    const walls = faces.filter((face) => face.kind === 'wall')
    // 3 行里每行 x=0 与 x=1 之间一条缝 → 3 块崖壁
    assert.equal(walls.length, 3)
    for (const wall of walls) {
      assert.equal(wall.corners[2]!.y - wall.corners[1]!.y, 2 * Z_STEP)
    }
    assert.equal(faces.length, 9 + 3)
  })

  it('每一块面都有四个角与四个贴图坐标', () => {
    const faces: readonly TerrainFace[] = meshOf(
      new Map([
        ['0,0', 2],
        ['1,0', 0],
      ]),
      [
        { cellX: 0, cellY: 0 },
        { cellX: 1, cellY: 0 },
      ],
    )
    for (const face of faces) {
      assert.equal(face.corners.length, 4)
      assert.equal(face.uvs.length, 4)
    }
  })
})

describe('坡道插值', () => {
  it('四角取到表里对应的那一项（顺序按参考实现反解）', () => {
    for (const [rampType, corners] of RAMP_HEIGHTS.entries()) {
      assert.equal(interpolateRampHeight(0, 0, rampType), corners[1], `rampType ${rampType} 左上角`)
      assert.equal(interpolateRampHeight(1, 0, rampType), corners[2], `rampType ${rampType} 右上角`)
      assert.equal(interpolateRampHeight(0, 1, rampType), corners[0], `rampType ${rampType} 左下角`)
      assert.equal(interpolateRampHeight(1, 1, rampType), corners[3], `rampType ${rampType} 右下角`)
    }
  })

  it('不是坡道（rampType 0 与越界）一律返回 0', () => {
    assert.equal(interpolateRampHeight(0.5, 0.5, 0), 0)
    assert.equal(interpolateRampHeight(0.5, 0.5, -1), 0)
    assert.equal(interpolateRampHeight(0.5, 0.5, RAMP_HEIGHTS.length), 0)
  })

  it('线性坡道中点取四角平均', () => {
    // rampType 1 的四角是 [0,0,1,1]：左下 0、左上 0、右上 1、右下 1 → 中点 0.5
    assert.equal(interpolateRampHeight(0.5, 0.5, 1), 0.5)
    // 沿 x 线性：左半边 0、右半边 1
    assert.equal(interpolateRampHeight(0.25, 0.5, 1), 0.25)
    assert.equal(interpolateRampHeight(0.75, 0.5, 1), 0.75)
  })
})

describe('坡道（rampTypeAt，任务 2 加法扩展）', () => {
  it('坡道连接高低两格：坡面顶为斜面，两侧都不生成崖壁', () => {
    const faces = buildTerrainMesh({
      view: RA2_ISO_VIEW,
      zStep: Z_STEP,
      cells: [
        { cellX: 0, cellY: 0 },
        { cellX: 1, cellY: 0 },
      ],
      levelAt: (x, y) => new Map([['0,0', 0], ['1,0', 1]]).get(`${x},${y}`),
      // rampType 1：[0,0,1,1] 四角=0,0,1,1 → 角序映射后 E 侧两角抬 1 级
      rampTypeAt: (x, y) => (x === 0 && y === 0 ? 1 : 0),
    })
    assert.equal(faces.filter((face) => face.kind === 'wall').length, 0, '坡道右侧接高格、左侧无邻格，都不该有墙')
    const rampTop = faces.find((face) => face.kind === 'top' && face.cellX === 0)!
    assert.notEqual(rampTop.zs[0], rampTop.zs[1], '坡面四角 z 应不全同（斜面）')
    assert.equal(rampTop.zs[1], Z_STEP)
    assert.equal(rampTop.zs[0], 0)
  })

  it('对照：同几何没有 rampTypeAt 时是平顶 + 一格崖壁（证明坡道判据确实改变了几何）', () => {
    const faces = buildTerrainMesh({
      view: RA2_ISO_VIEW,
      zStep: Z_STEP,
      cells: [
        { cellX: 0, cellY: 0 },
        { cellX: 1, cellY: 0 },
      ],
      levelAt: (x, y) => new Map([['0,0', 0], ['1,0', 1]]).get(`${x},${y}`),
    })
    assert.equal(faces.filter((face) => face.kind === 'wall').length, 1)
    const flatTop = faces.find((face) => face.kind === 'top' && face.cellX === 0)!
    assert.deepEqual(flatTop.zs, [0, 0, 0, 0])
  })

  it('坡道下行方向（低邻格）不生成假墙', () => {
    const faces = buildTerrainMesh({
      view: RA2_ISO_VIEW,
      zStep: Z_STEP,
      cells: [
        { cellX: 0, cellY: 0 },
        { cellX: -1, cellY: 0 },
      ],
      levelAt: (x, y) => new Map([['0,0', 0], ['-1,0', 0]]).get(`${x},${y}`),
      rampTypeAt: (x) => (x === 0 ? 1 : 0),
    })
    // 坡格高侧朝 E、低侧朝 W；W 邻同高 0 级 → 无墙（坡面铺到地平）
    assert.equal(faces.filter((face) => face.kind === 'wall').length, 0)
  })
})

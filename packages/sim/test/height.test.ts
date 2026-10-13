import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ONE } from '../src/fixed.js'
import { unitCell } from '../src/unit.js'
import { createWorld, enqueueCommand, step } from '../src/world.js'

/**
 * Z 轴落位（docs/ENGINE-MAP.md「单位移动核心」+「一级高度 = 90 lepton」）：
 *
 * - 一级高度 = 90 lepton（`0x8529d0`，已核）；格心 z = 格高度级 × 90。
 * - 运动距离是 x/y/z 同权的平欧氏距离（`fn-4c3000` 的 dx²+dy²+dz²、fn-4ba410）——
 *   上下坡时 3D 路程更长，同速下格子耗时更长（这就是坡度减慢的几何本质，
 *   在此之上原版再乘 TrackedUphill/Downhill 等系数）。
 * - 单位 z 在移动中朝目标格心的 z 线性推进（插值口径为本项目自定，原版逐 tick
 *   插值式未核；距离按 3D 欧氏计有 fn-4c3000 直接证据）。
 */

/** 8×8 地图：x=4..5 两列之间有 4 级高差（坡），其余平地 */
function slopeWorld(zAt: (x: number) => number) {
  const heights = new Int8Array(8 * 8)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) heights[y * 8 + x] = zAt(x)
  }
  return createWorld({
    width: 8,
    height: 8,
    heights,
    units: [{ owner: 0, cell: { x: 2, y: 4 }, speed: ONE, health: 100 }],
    seed: 1,
  })
}

test('单位出生落在出生格的 z 上（格高度级 × 90 lepton）', () => {
  const world = slopeWorld((x) => (x >= 4 ? 4 : 0))
  const unit = world.units[0]!
  assert.equal(unit.z, 0, '出生格 (2,4) 高度级 0')
})

test('上坡移动：单位 z 逐 tick 上升，到位后 = 目标格 z × 90', () => {
  const world = slopeWorld((x) => (x >= 4 ? 4 : 0))
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 6, y: 4 } })
  const unit = world.units[0]!
  step(world)
  let sawRising = false
  let lastZ = unit.z
  for (let i = 0; i < 40 && unit.path.length > 0; i++) {
    step(world)
    if (unit.z > lastZ) sawRising = true
    lastZ = unit.z
  }
  assert.ok(sawRising, '爬坡途中 z 单调上升')
  assert.equal(unit.z, 4 * 90, '到位后 z = 目标格 4 级 × 90')
  assert.deepEqual(unitCell(unit), { x: 6, y: 4 })
})

test('平地移动 z 恒为 0', () => {
  const world = slopeWorld(() => 0)
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 6, y: 4 } })
  for (let i = 0; i < 40; i++) step(world)
  assert.equal(world.units[0]!.z, 0)
})

/**
 * 坡度乘数（fn-4a2670 + rules+0x690 系列，见 ENGINE-MAP「速度合成」）：
 * 爬坡（目标格 z > 当前格 z）× TrackedUphill / WheeledUphill；
 * 下坡 × TrackedDownhill / WheeledDownhill（实测 1.2 = 下坡提速 20%）。
 * 按单位移动方式选组（techno+0x5a4 == 1 → Track）。
 */
function moved3d(world: ReturnType<typeof createWorld>, targetX?: number): number {
  const u = world.units[0]!
  const before = { x: u.x, y: u.y, z: u.z }
  const target = targetX ?? (unitCell(u).x > 4 ? 1 : 7)
  // 初始朝向对齐目标方向（东西向），排除转向 tick 的干扰
  u.facing = target > unitCell(u).x ? 16384 : 49152
  enqueueCommand(world, world.tick + 1, { kind: 'move', unitId: u.id, target: { x: target, y: 4 } })
  step(world)
  const dx = u.x - before.x
  const dy = u.y - before.y
  const dz = u.z - before.z
  return Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz))
}

test('平地：每 tick 3D 位移 = 速度（无乘数）', () => {
  const world = slopeWorld(() => 0)
  assert.equal(moved3d(world), ONE)
})

/** x>=4 是 4 级高台、x<4 是平地；把单位放到坡沿（下一格就是坡） */
function slopeEdgeWorld(spawnX: number) {
  const world = slopeWorld((x) => (x >= 4 ? 4 : 0))
  const unit = world.units[0]!
  unit.x = spawnX * ONE + ONE / 2
  unit.y = 4 * ONE + ONE / 2
  unit.z = (world.heights![4 * 8 + spawnX] ?? 0) * 90
  return world
}

test('上坡：× Uphill 系数（0.5 → 半速）', () => {
  // 站在坡沿 (3,4)（z=0），下一格 (4,4) 是 4 级高台 → 爬升 × 0.5
  const world = slopeEdgeWorld(3)
  world.slopeFactors = { upTrack: 0.5, downTrack: 1.2, upOther: 1, downOther: 1 }
  world.units[0]!.slopeClass = 'track'
  assert.equal(moved3d(world), Math.floor(ONE * 0.5), '向高台爬升 × 0.5')
})

test('下坡：× Downhill 系数（1.2 → 提速 20%）', () => {
  // 站在高台坡沿 (4,4)（z=360），向西走到 (3,4) 平地 → 下坡 × 1.2
  const world = slopeEdgeWorld(4)
  world.slopeFactors = { upTrack: 1, downTrack: 1.2, upOther: 1, downOther: 1 }
  world.units[0]!.slopeClass = 'track'
  assert.equal(moved3d(world, 3), Math.floor(ONE * 1.2), '下坡 3D 位移 = 307')
})

test('slopeClass=other 走另一组系数', () => {
  const world = slopeEdgeWorld(3)
  world.slopeFactors = { upTrack: 1, downTrack: 1, upOther: 0.5, downOther: 1 }
  world.units[0]!.slopeClass = 'other'
  assert.equal(moved3d(world), Math.floor(ONE * 0.5), 'other 组用 upOther')
})

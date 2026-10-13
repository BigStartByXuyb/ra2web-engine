import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FACING_FULL } from '../src/direction.js'
import { advanceFacing, createFacing, facingIsIdle, setFacingTarget, facingRadians } from '../src/facing.js'

/**
 * FacingClass（战斗线取证，ENGINE-MAP「炮塔」节）：
 *   {+0x00 当前, +0x04 目标, +0x08 起始帧(−1=静止), +0x10 时长帧, +0x14 每帧转量}
 *   车体 @+0x2e0、炮塔 @+0x2f8；起步打点 0x4b8a30、按帧推进 0x4b8b10、读取 0x4b8be0。
 * sim 口径：帧 = tick；恒速段用"每 tick 转 rate、到点收敛"实现（与现有转向行为逐位一致，
 * 0x4b8b10 的帧算术精确差异归台账）。
 */

test('createFacing：初始静止、朝向归一化', () => {
  const state = createFacing(8192, 4096)
  assert.equal(state.current, 8192)
  assert.equal(state.target, 8192)
  assert.equal(state.startTick, -1)
  assert.equal(state.duration, 0)
  assert.equal(facingIsIdle(state), true)
  const wrapped = createFacing(FACING_FULL + 1000, 0)
  assert.equal(wrapped.current, 1000)
})

test('setFacingTarget：打点起始 tick、时长 = ⌈|Δ| / rate⌉（最短方向）', () => {
  const state = createFacing(0, 0)
  setFacingTarget(state, 8192, 4096, 10)
  assert.equal(state.target, 8192)
  assert.equal(state.startTick, 10)
  assert.equal(state.duration, 2) // 8192 / 4096 = 2 帧
  assert.equal(state.rate, 4096)
  assert.equal(facingIsIdle(state), false)
})

test('setFacingTarget：目标等于当前 → 保持静止（不打点）', () => {
  const state = createFacing(5000, 0)
  setFacingTarget(state, 5000, 4096, 10)
  assert.equal(facingIsIdle(state), true)
})

test('advanceFacing：恒速逐 tick 转、到点收敛并静止化', () => {
  const state = createFacing(0, 0)
  setFacingTarget(state, 8192, 4096, 0)
  advanceFacing(state, 0)
  assert.equal(state.current, 4096)
  advanceFacing(state, 1)
  assert.equal(state.current, 8192)
  assert.equal(facingIsIdle(state), true) // 到点：duration/rate 归零（0x4b8b10 到达分支）
})

test('advanceFacing：|Δ| ≤ rate 时一步到位（不越冲，与既有 rotateToward 口径一致）', () => {
  const state = createFacing(0, 0)
  setFacingTarget(state, 1000, 4096, 0)
  advanceFacing(state, 0)
  assert.equal(state.current, 1000)
})

test('advanceFacing：最短方向绕环（346° → 10° 走正向 4336 单位）', () => {
  const state = createFacing(63000, 0) // ≈346°
  setFacingTarget(state, 1800, 8192, 0) // ≈10°；最短路径 |Δ| = 4336 ≤ 8192 → 一步到点
  advanceFacing(state, 0)
  assert.equal(state.current, 1800)
})

test('advanceFacing：静止段（rate=0）不改变任何值', () => {
  const state = createFacing(1234, 0)
  advanceFacing(state, 5)
  assert.equal(state.current, 1234)
  assert.equal(state.startTick, -1)
})

test('转向中途换目标：重新打点', () => {
  const state = createFacing(0, 0)
  setFacingTarget(state, 16384, 4096, 0)
  advanceFacing(state, 0)
  assert.equal(state.current, 4096)
  setFacingTarget(state, 0, 4096, 1) // 反悔，转回去
  assert.equal(state.startTick, 1)
  assert.equal(state.duration, 1) // 4096/4096
})

test('facingRadians：16 位角 → 弧度（渲染用）', () => {
  assert.equal(facingRadians(FACING_FULL / 4), Math.PI / 2)
})

test('炮塔与车体是两份独立状态：炮塔滞后收敛（双 FacingClass 结构本身）', () => {
  const hull = createFacing(0, 8192)
  const turret = createFacing(0, 4096)
  // 车体目标转到 90°（16384）
  setFacingTarget(hull, 16384, 8192, 0)
  setFacingTarget(turret, 16384, 4096, 0)
  advanceFacing(hull, 0)
  advanceFacing(turret, 0)
  assert.equal(hull.current, 8192) // 车体一步 45°
  assert.equal(turret.current, 4096) // 炮塔一步 22.5°：滞后
  assert.ok(turret.current < hull.current)
})

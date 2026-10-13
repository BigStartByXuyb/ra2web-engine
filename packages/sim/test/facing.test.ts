import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ONE } from '../src/fixed.js'
import { FACING_PER_STEP } from '../src/direction.js'
import { unitCell } from '../src/unit.js'
import { createWorld, enqueueCommand, step } from '../src/world.js'

/**
 * 移动与朝向口径（docs/ENGINE-MAP.md「单位移动核心」）：
 *
 * - 单位沿"到下一格心的直线"推进（原版 lepton 步进表 0x851ac0 是斜向 (±256,±256)，
 *   欧氏距离消耗速度），不是先消 x 再消 y 的直角折线。
 * - 单位有朝向：16 位角顺时针 0=北，每 45° = 8192；转向按 tick 渐进（0x4b8be0 是插值器，
 *   原版转速与 rules ROT 的换算未核，本项目先用固定每 tick 增量并标注自定）。
 */

function worldWith(target: { x: number; y: number }, speed = ONE) {
  const world = createWorld({
    width: 16,
    height: 16,
    units: [{ owner: 0, cell: { x: 2, y: 2 }, speed, health: 100 }],
    seed: 1,
  })
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target })
  return world
}

test('斜向移动是直线：一个 tick 里 x 与 y 同时前进', () => {
  // 半格速度；单位初始朝向已对齐东南（排除转向 tick），测推进 tick——
  // 直线推进两轴各前进 ~90；曼哈顿式只前进 x（128, 0）
  const world = worldWith({ x: 4, y: 4 }, ONE / 2)
  world.units[0]!.facing = 3 * FACING_PER_STEP // 已朝东南
  const unit = world.units[0]!
  const before = { x: unit.x, y: unit.y }
  step(world) // 推进 tick
  const dx = unit.x - before.x
  const dy = unit.y - before.y
  assert.ok(dx > 40, `x 应已沿斜线前进（实际 ${dx}）`)
  assert.ok(dy > 40, `y 应已同时前进（实际 ${dy}）——曼哈顿式推进只会动一个轴`)
  assert.ok(Math.abs(dx - dy) <= 2, `斜线两轴等量前进（dx=${dx}, dy=${dy}）`)
})

test('单位有朝向且转向移动方向：向东走最终朝向 0x4000', () => {
  const world = worldWith({ x: 8, y: 2 })
  const unit = world.units[0]!
  assert.equal(unit.facing, 0, '初始朝向北')
  for (let i = 0; i < 40; i++) step(world)
  assert.equal(unit.facing, 2 * FACING_PER_STEP, '走完后朝向 = 东（0x4000）')
  assert.deepEqual(unitCell(unit), { x: 8, y: 2 })
})

test('转向是渐进的：中途朝向介于起点与终点之间', () => {
  const world = worldWith({ x: 10, y: 2 })
  const unit = world.units[0]!
  step(world)
  step(world)
  assert.ok(unit.facing > 0, `已开始顺时针转（实际 ${unit.facing}）`)
  assert.ok(unit.facing < 4 * FACING_PER_STEP, '还没转到正东')
})

test('转向时序：朝向未对齐前不位移（原版先转后走，fn-4a2670 转向分支）', () => {
  const world = worldWith({ x: 6, y: 2 })
  const unit = world.units[0]!
  const posAfter = (): { x: number; y: number; z: number } => ({ x: unit.x, y: unit.y, z: unit.z })
  step(world) // 应用指令并推进第一个 tick
  // 朝向 0（北）→ 目标东（0x4000）差 90°；每 tick 转 45°，第一个 tick 还没对齐
  assert.equal(unit.facing, FACING_PER_STEP, '第一个 tick 在转向')
  assert.deepEqual(posAfter(), { x: 2 * ONE + ONE / 2, y: 2 * ONE + ONE / 2, z: 0 }, '转向 tick 不位移')
  step(world)
  assert.equal(unit.facing, 2 * FACING_PER_STEP, '第二个 tick 转到位')
  assert.deepEqual(posAfter(), { x: 2 * ONE + ONE / 2, y: 2 * ONE + ONE / 2, z: 0 }, '刚对齐也先不位移，下一 tick 起步')
  step(world)
  const before = { x: unit.x, y: unit.y }
  step(world)
  assert.equal(unit.x, before.x + ONE, '对齐后按速度直线推进')
})

test('炮塔朝向：无战斗目标时跟随车体（独立字段，战斗目标追踪归战斗线）', () => {
  const world = worldWith({ x: 8, y: 2 })
  const unit = world.units[0]!
  assert.equal(unit.turretFacing, 0, '初始炮塔与车体同向（北）')
  step(world)
  step(world)
  assert.equal(unit.turretFacing, unit.facing, '车体转向时炮塔跟随')
  assert.notEqual(unit.turretFacing, 0, '已跟随到新方向')
})

test('向南走朝向 0x8000，向西走朝向 0xc000（顺时针口径）', () => {
  const south = worldWith({ x: 2, y: 8 })
  for (let i = 0; i < 40; i++) step(south)
  assert.equal(south.units[0]!.facing, 8 * (FACING_PER_STEP / 2))

  const westWorld = createWorld({
    width: 16,
    height: 16,
    units: [{ owner: 0, cell: { x: 10, y: 4 }, speed: ONE, health: 100 }],
    seed: 1,
  })
  enqueueCommand(westWorld, 1, { kind: 'move', unitId: 1, target: { x: 2, y: 4 } })
  for (let i = 0; i < 40; i++) step(westWorld)
  assert.equal(westWorld.units[0]!.facing, 12 * (FACING_PER_STEP / 2))
})

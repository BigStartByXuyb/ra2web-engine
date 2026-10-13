import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ONE } from '../src/fixed.js'
import { unitCell } from '../src/unit.js'
import { createWorld, enqueueCommand, step } from '../src/world.js'

/**
 * 地表速度系数（docs/ENGINE-MAP.md「单位移动核心」速度合成节）：
 * 原版在推进核心（fn-4a2670）里取 `min(1.0, 地表表[0x850ea0][移动类型 + 地表×9])`
 * 乘在速度上；系数为 0 时兜底取 0.5（该格本应不可通行，属防御分支）。
 * 系数取"当前格"还是"进入格"未核，本项目按当前格（自定，待核）。
 */

function worldOn(factor: number | undefined, speed = ONE) {
  const terrainSpeed = factor === undefined ? undefined : new Float32Array(8 * 8).fill(factor)
  const world = createWorld({
    width: 8,
    height: 8,
    units: [{ owner: 0, cell: { x: 1, y: 4 }, speed, health: 100 }],
    seed: 1,
    ...(terrainSpeed ? { terrainSpeed } : {}),
  })
  // 目标在正东：初始朝向对齐东（0x4000），排除转向 tick 的干扰
  world.units[0]!.facing = 16384
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 7, y: 4 } })
  return world
}

test('无地表系数时全速前进', () => {
  const world = worldOn(undefined)
  step(world) // 应用指令并推进
  const unit = world.units[0]!
  assert.equal(unit.x - (1 * ONE + ONE / 2), ONE, '一个 tick 走 256 lepton（一格）')
})

test('系数 0.5：每 tick 只走一半', () => {
  const world = worldOn(0.5)
  step(world)
  const unit = world.units[0]!
  assert.equal(unit.x - (1 * ONE + ONE / 2), ONE / 2, '0.5 系数下一个 tick 走 128 lepton')
})

test('系数超过 1 封顶为 1（原版 min(1.0, …)）', () => {
  const world = worldOn(1.5)
  step(world)
  const unit = world.units[0]!
  assert.equal(unit.x - (1 * ONE + ONE / 2), ONE, '1.5 与 1.0 等效')
})

test('系数 0 兜底为 0.5（原版防御分支；该格本应不可通行）', () => {
  const world = worldOn(0)
  step(world)
  const unit = world.units[0]!
  assert.equal(unit.x - (1 * ONE + ONE / 2), ONE / 2, '0 系数按 0.5 兜底')
})

test('系数只影响速度不影响可达性（可达性由通行性判定管）', () => {
  const world = worldOn(0.2)
  runSome(world, 400)
  assert.deepEqual(unitCell(world.units[0]!), { x: 7, y: 4 }, '慢速最终仍到达目标')
})

function runSome(world: ReturnType<typeof createWorld>, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world)
}

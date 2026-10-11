import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ONE } from '../src/fixed.js'
import { MAX_MOVEMENT_PER_TICK, speedToMovementPerTick } from '../src/movement-scale.js'
import { unitCell } from '../src/unit.js'
import { createWorld, enqueueCommand, run, step } from '../src/world.js'

/**
 * Speed 是百分比而不是 lepton/tick：每 tick 位移 = min( min(Speed,100) * 256/100, 255 )。
 * 依据：ModEnc 的 `Speed` 条目给出的原版式子。
 */
test('Speed 按百分比换算成每 tick 位移', () => {
  assert.equal(speedToMovementPerTick(6), 15, '犀牛 Speed=6 → 15.36 → 15 lepton/tick')
  assert.equal(speedToMovementPerTick(7), 18, '灰熊 Speed=7 → 17.92 → 18')
  assert.equal(speedToMovementPerTick(4), 10, '基地车/步兵 Speed=4 → 10.24 → 10')
  assert.equal(speedToMovementPerTick(0), 0)
  assert.equal(speedToMovementPerTick(-3), 0)
  assert.equal(speedToMovementPerTick(100), MAX_MOVEMENT_PER_TICK, 'Speed=100 → 256 会被 255 截断')
  assert.equal(speedToMovementPerTick(1000), MAX_MOVEMENT_PER_TICK, '超过 100 一律按 100')
})

test('换算后的速度真的落在模拟里：犀牛一格约 17 tick', () => {
  const world = createWorld({
    width: 8,
    height: 3,
    units: [{ owner: 0, cell: { x: 0, y: 1 }, speed: speedToMovementPerTick(6), health: 100 }],
    seed: 1,
  })
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 3, y: 1 } })
  // 起点在格心：到第 3 格中心共 768 lepton，256/15 ≈ 17.1 tick/格，约 51 tick
  run(world, 30)
  assert.ok(unitCell(world.units[0]!).x < 3, `30 tick 时还没到第 3 格（现在 ${unitCell(world.units[0]!).x}）`)
  run(world, 30)
  assert.deepEqual(unitCell(world.units[0]!), { x: 3, y: 1 })
  assert.equal(world.units[0]!.x, 3 * ONE + (ONE >> 1), '停在格心')
})

test('单位按速度推进并停在目标格中心', () => {
  const world = createWorld({
    width: 12,
    height: 12,
    units: [{ owner: 0, cell: { x: 1, y: 1 }, speed: ONE / 2, health: 100 }],
    seed: 1,
  })
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 5, y: 1 } })
  run(world, 40)

  const unit = world.units[0]!
  assert.deepEqual(unitCell(unit), { x: 5, y: 1 })
  assert.equal(unit.x, 5 * ONE + (ONE >> 1))
  assert.equal(unit.y, 1 * ONE + (ONE >> 1))
  assert.equal(unit.path.length, 0)
})

test('stop 指令清空路径，单位停在原地', () => {
  const world = createWorld({
    width: 12,
    height: 12,
    units: [{ owner: 0, cell: { x: 1, y: 1 }, speed: ONE / 4, health: 100 }],
    seed: 1,
  })
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 9, y: 1 } })
  run(world, 4)
  const moving = world.units[0]!.x
  enqueueCommand(world, world.tick + 1, { kind: 'stop', unitId: 1 })
  run(world, 4)
  const stopped = world.units[0]!.x
  run(world, 20)
  assert.equal(stopped, moving)
  assert.equal(world.units[0]!.x, stopped)
})

test('指令在指定 tick 才生效', () => {
  const world = createWorld({
    width: 8,
    height: 8,
    units: [{ owner: 0, cell: { x: 1, y: 1 }, speed: ONE, health: 100 }],
    seed: 1,
  })
  enqueueCommand(world, 10, { kind: 'move', unitId: 1, target: { x: 4, y: 1 } })
  run(world, 5)
  assert.equal(world.units[0]!.path.length, 0)
  run(world, 6)
  assert.ok(world.units[0]!.pathIndex >= 0)
  run(world, 20)
  assert.deepEqual(unitCell(world.units[0]!), { x: 4, y: 1 })
})

test('step 是唯一的推进入口：单步与批量推进等价', () => {
  const a = createWorld({
    width: 8,
    height: 8,
    units: [{ owner: 0, cell: { x: 0, y: 0 }, speed: ONE / 3, health: 100 }],
    seed: 3,
  })
  const b = createWorld({
    width: 8,
    height: 8,
    units: [{ owner: 0, cell: { x: 0, y: 0 }, speed: ONE / 3, health: 100 }],
    seed: 3,
  })
  enqueueCommand(a, 1, { kind: 'move', unitId: 1, target: { x: 6, y: 6 } })
  enqueueCommand(b, 1, { kind: 'move', unitId: 1, target: { x: 6, y: 6 } })
  for (let i = 0; i < 30; i++) step(a)
  run(b, 30)
  assert.deepEqual(a.units[0], b.units[0])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ONE } from '../src/fixed.js'
import { unitCell } from '../src/unit.js'
import { createWorld, enqueueCommand, run, step } from '../src/world.js'

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

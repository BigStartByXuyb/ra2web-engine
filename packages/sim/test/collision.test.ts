import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ONE } from '../src/fixed.js'
import { unitCell } from '../src/unit.js'
import { createWorld, enqueueCommand, run, step } from '../src/world.js'

/**
 * 单位间碰撞（docs/ENGINE-MAP.md「单位移动核心」）：
 * 原版每步推进前查 `Can_Enter_Cell`（父虚表 +0x194），目标格被别的单位占着就进不去
 * （返回 6/7），原地等待后重试；等待/绕行的具体口径是本项目自定（原版随机等待的
 * 分布与重规划时机未核）。
 */

function twoUnitWorld(a: { x: number; y: number }, b: { x: number; y: number }) {
  return createWorld({
    width: 16,
    height: 16,
    units: [
      { owner: 0, cell: a, speed: ONE, health: 100 },
      { owner: 0, cell: b, speed: ONE, health: 100 },
    ],
    seed: 7,
  })
}

test('目标格被静止单位占着：绕行到达，从不进入它的格', () => {
  const world = twoUnitWorld({ x: 2, y: 4 }, { x: 6, y: 4 })
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 10, y: 4 } })
  run(world, 40)
  const a = world.units[0]!
  const b = world.units[1]!
  assert.deepEqual(unitCell(b), { x: 6, y: 4 }, 'B 没动')
  assert.deepEqual(unitCell(a), { x: 10, y: 4 }, `A 绕行到达目标（实际 ${unitCell(a).x},${unitCell(a).y}）`)
})

test('无可绕行（单格走廊）：停在挡路车相邻格等待，不重叠', () => {
  // 全宽双排墙夹出单格走廊（y=4），B 堵在 (6,4)，A 从西边进来只能停在 (5,4)
  const walls: { x: number; y: number }[] = []
  for (let x = 0; x < 16; x++) {
    if (x === 2) continue // A 的出发格上方留口让 A 进走廊
    walls.push({ x, y: 3 }, { x, y: 5 })
  }
  const world = createWorld({
    width: 16,
    height: 16,
    blocked: walls,
    units: [
      { owner: 0, cell: { x: 2, y: 4 }, speed: ONE, health: 100 },
      { owner: 0, cell: { x: 6, y: 4 }, speed: 0, health: 100 },
    ],
    seed: 7,
  })
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 10, y: 4 } })
  run(world, 40)
  const a = world.units[0]!
  assert.deepEqual(unitCell(a), { x: 5, y: 4 }, `A 停在 B 西侧相邻格（实际 ${unitCell(a).x},${unitCell(a).y}）`)
})

test('两车不能走进同一个格', () => {
  const world = twoUnitWorld({ x: 2, y: 4 }, { x: 4, y: 6 })
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 8, y: 4 } })
  enqueueCommand(world, 1, { kind: 'move', unitId: 2, target: { x: 6, y: 8 } })
  run(world, 30)
  const a = world.units[0]!
  const b = world.units[1]!
  const occupied = new Set([unitCell(a), unitCell(b)].map((c) => `${c.x},${c.y}`))
  assert.equal(occupied.size, 2, `两车最终不在同一格（${[...occupied]}）`)
})

test('挡路车开走后，等待的车继续走完原目标', () => {
  const world = twoUnitWorld({ x: 2, y: 4 }, { x: 6, y: 4 })
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 10, y: 4 } })
  run(world, 6)
  enqueueCommand(world, world.tick + 1, { kind: 'move', unitId: 2, target: { x: 6, y: 10 } })
  run(world, 80)
  assert.deepEqual(unitCell(world.units[0]!), { x: 10, y: 4 }, 'A 最终到达原目标')
  assert.deepEqual(unitCell(world.units[1]!), { x: 6, y: 10 }, 'B 到达自己的目标')
})

test('被挡的场景也是确定性的：跑两遍逐 tick 一致', () => {
  const build = () => {
    const world = twoUnitWorld({ x: 2, y: 4 }, { x: 6, y: 4 })
    enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 10, y: 4 } })
    return world
  }
  const left = build()
  const right = build()
  for (let i = 0; i < 50; i++) {
    step(left)
    step(right)
    assert.deepEqual(left.units[0], right.units[0], `tick ${i + 1} 状态不一致`)
  }
})

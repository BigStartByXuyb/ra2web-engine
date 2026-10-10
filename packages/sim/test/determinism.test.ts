import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ONE } from '../src/fixed.js'
import { hashWorld } from '../src/hash.js'
import { createWorld, enqueueCommand, step, type World } from '../src/world.js'

/**
 * P1 的退出条件：同一初始状态 + 同一指令序列 → 逐 tick 状态一致。
 * 这里用同一份脚本跑两遍，逐 tick 比对哈希；任何不确定来源都会被这一步抓住。
 */

function scriptedWorld(): World {
  return createWorld({
    width: 20,
    height: 20,
    blocked: [
      { x: 6, y: 4 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 6, y: 7 },
      { x: 10, y: 12 },
      { x: 11, y: 12 },
      { x: 12, y: 12 },
    ],
    units: [
      { owner: 0, cell: { x: 1, y: 1 }, speed: ONE / 3, health: 300 },
      { owner: 0, cell: { x: 2, y: 2 }, speed: ONE / 4, health: 200 },
      { owner: 1, cell: { x: 18, y: 18 }, speed: ONE / 5, health: 400 },
    ],
    seed: 20261010,
  })
}

function script(world: World): void {
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 15, y: 3 } })
  enqueueCommand(world, 3, { kind: 'move', unitId: 2, target: { x: 12, y: 9 } })
  enqueueCommand(world, 7, { kind: 'move', unitId: 3, target: { x: 4, y: 17 } })
  enqueueCommand(world, 40, { kind: 'stop', unitId: 2 })
  enqueueCommand(world, 41, { kind: 'move', unitId: 2, target: { x: 3, y: 16 } })
  enqueueCommand(world, 90, { kind: 'move', unitId: 1, target: { x: 1, y: 1 } })
}

test('同一脚本两次运行逐 tick 哈希一致', () => {
  const left = scriptedWorld()
  const right = scriptedWorld()
  script(left)
  script(right)
  const hashes: string[] = []
  for (let tick = 0; tick < 200; tick++) {
    step(left)
    step(right)
    const a = hashWorld(left)
    const b = hashWorld(right)
    assert.equal(a, b, `tick ${tick + 1} 状态不一致`)
    hashes.push(a)
  }
  // 中途与末尾都必须变化，否则说明哈希没覆盖到实际状态
  assert.notEqual(hashes[0], hashes[199])
  assert.equal(new Set(hashes).size > 50, true)
})

test('末态哈希固定（回归快照）', () => {
  const world = scriptedWorld()
  script(world)
  for (let tick = 0; tick < 200; tick++) step(world)
  assert.equal(hashWorld(world), GOLDEN_HASH)
})

/**
 * 由 `npm run sim:scenario` 打印并人工确认后写入。
 * 改动模拟逻辑时该值会变化，属预期 —— 变化本身即是"行为被改动了"的证据。
 */
const GOLDEN_HASH = '52a0b076'

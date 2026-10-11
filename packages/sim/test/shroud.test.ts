import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashWorld } from '../src/hash.js'
import { createWorld, enqueueCommand, run, step } from '../src/world.js'
import { exploredCount, isExplored, isVisible } from '../src/shroud.js'

/**
 * 战争迷雾：欧氏半径揭开、永久保留、视野实时变化。
 * 判据来自客户端 `Shroud`：等级 0/2、`(dx)² + (dy)² <= r² + 1`。
 */

function scout(sight = 3, cell = { x: 10, y: 10 }, speed = 0) {
  return createWorld({
    width: 24,
    height: 24,
    units: [{ owner: 0, cell, speed, health: 100, sight }],
    seed: 20261011,
  })
}

test('迷雾按欧氏半径揭开：r=3 时中心与斜角都在内', () => {
  const world = scout(3)
  // 建立世界时就按初始位置揭开一次
  assert.equal(isExplored(world.shroud, 0, 10, 10), true)
  assert.equal(isExplored(world.shroud, 0, 13, 10), true, '正东 3 格')
  assert.equal(isExplored(world.shroud, 0, 12, 12), true, '斜角 √8 ≈ 2.83 < 3')
  assert.equal(isExplored(world.shroud, 0, 13, 13), false, '斜角 √18 ≈ 4.24 > 3')
  assert.equal(isExplored(world.shroud, 0, 14, 10), false, '正东 4 格超出')
  // 揭开格数 = 圆内格数（含边界 +1 的容差）
  let expected = 0
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= 3 * 3 + 1) expected++
  }
  assert.equal(exploredCount(world.shroud, 0), expected)
})

test('揭开是单向的：走开以后仍然保留，视野则实时收回', () => {
  const world = scout(2, { x: 10, y: 10 }, 32)
  assert.equal(isVisible(world.shroud, 0, 12, 10), true)
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 20, y: 10 } })
  run(world, 80)
  const unit = world.units[0]!
  assert.ok(Math.trunc(unit.x / 256) > 15, `单位应当已经走远，现在在 ${Math.trunc(unit.x / 256)}`)
  assert.equal(isExplored(world.shroud, 0, 12, 10), true, '旧位置必须保持已探索')
  assert.equal(isVisible(world.shroud, 0, 12, 10), false, '旧位置已不在当前视野')
  assert.equal(isVisible(world.shroud, 0, Math.trunc(unit.x / 256), Math.trunc(unit.y / 256)), true)
  assert.ok(exploredCount(world.shroud, 0) > 0)
})

test('敌方单位只有落在自己视野里才算可见', () => {
  const world = createWorld({
    width: 30,
    height: 30,
    units: [
      { owner: 0, cell: { x: 5, y: 5 }, speed: 0, health: 100, sight: 3 },
      { owner: 1, cell: { x: 25, y: 25 }, speed: 0, health: 100, sight: 3 },
    ],
    seed: 20261011,
  })
  assert.equal(isVisible(world.shroud, 0, 25, 25), false, '远处敌人不在玩家 0 的视野内')
  assert.equal(isVisible(world.shroud, 1, 5, 5), false, '反过来也一样')
  // 玩家 1 的敌人是"自己"，永远可见
  assert.equal(isVisible(world.shroud, 1, 25, 25), true)
})

test('迷雾改变世界哈希：同种子不同探索进度哈希不同', () => {
  assert.notEqual(hashWorld(scout(1)), hashWorld(scout(4)), '同样位置、不同视野 → 揭开范围不同 → 哈希不同')
  // 同输入必须同结果：两个完全一样的世界推进同样步数后哈希相同
  const left = scout(3, { x: 6, y: 6 })
  const right = scout(3, { x: 6, y: 6 })
  run(left, 10)
  run(right, 10)
  assert.equal(hashWorld(left), hashWorld(right))
  step(left)
  assert.notEqual(hashWorld(left), hashWorld(right), 'tick 变了哈希就要变')
})

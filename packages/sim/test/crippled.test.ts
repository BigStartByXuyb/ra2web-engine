import assert from 'node:assert/strict'
import { createFacing } from '../src/facing.js'
import { test } from 'node:test'
import { ONE } from '../src/fixed.js'
import { createWorld, enqueueCommand, step } from '../src/world.js'

/**
 * 伤车慢速（docs/ENGINE-MAP.md「单位移动核心」速度合成节）：
 * 推进核心 fn-4a2670 里 `FUN_005d4540() ≤ rules[+0x1368]` 时系数 ×0.75。
 * FUN_005d4540 = 血量%（当前血 ÷ 类型满血，虚表 +0x84）；rules+0x1368 = INI
 * `[General] ConditionYellow`（真实档案实测 `ConditionYellow=50%`）。
 * 即：掉到黄血线（≤50%）的车辆移速 ×0.75。
 */

function worldWith(
  health: number,
  maxHealth: number | undefined,
  crippled: { threshold: number; factor: number } | undefined,
) {
  const world = createWorld({
    width: 8,
    height: 8,
    units: [
      {
        owner: 0,
        cell: { x: 1, y: 4 },
        speed: ONE,
        health,
        ...(maxHealth !== undefined ? { maxHealth } : {}),
      },
    ],
    seed: 1,
    ...(crippled ? { crippled } : {}),
  })
  // 移动目标在正东：初始朝向对齐东（0x4000），排除转向 tick 的干扰
  world.units[0]!.hull = createFacing(16384)
  return world
}

function moveDelta(world: ReturnType<typeof createWorld>): number {
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 7, y: 4 } })
  step(world)
  return world.units[0]!.x - (1 * ONE + ONE / 2)
}

test('满血时全速（不触发伤车）', () => {
  const delta = moveDelta(worldWith(100, 100, { threshold: 0.5, factor: 0.75 }))
  assert.equal(delta, ONE, '100/100 = 1.0 > 0.5，不减速')
})

test('血量 ≤ ConditionYellow：移速 ×0.75', () => {
  const delta = moveDelta(worldWith(40, 100, { threshold: 0.5, factor: 0.75 }))
  assert.equal(delta, ONE * 0.75, '40/100 = 0.4 ≤ 0.5，走 3/4')
})

test('血量高于阈值：不减速', () => {
  const delta = moveDelta(worldWith(60, 100, { threshold: 0.5, factor: 0.75 }))
  assert.equal(delta, ONE, '60/100 = 0.6 > 0.5，全速')
})

test('不给 crippled 选项时永远全速（默认关闭）', () => {
  const delta = moveDelta(worldWith(10, 100, undefined))
  assert.equal(delta, ONE, '没有阈值就没有伤车减速')
})

test('maxHealth 缺省取 health（此时永远满血）', () => {
  const delta = moveDelta(worldWith(40, undefined, { threshold: 0.5, factor: 0.75 }))
  assert.equal(delta, ONE, '没有 maxHealth 就没有"受伤"的概念')
})

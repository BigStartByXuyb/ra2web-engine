import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GOLDEN_FINAL_HASH, SCENARIO_TICKS, runScenario, worldAtTick } from '@ra2web/scenarios'

/**
 * P1 的退出条件：同一初始状态 + 同一指令序列 → 逐 tick 状态一致。
 *
 * 场景与脚本来自 `@ra2web/scenarios`（Node 与浏览器共用），这里只负责"跑两遍并比对"，
 * 不在测试里另写一份场景 —— 否则测的就不是线上那份代码了。
 */

test('同一场景两次运行逐 tick 哈希一致', () => {
  const left = runScenario(SCENARIO_TICKS)
  const right = runScenario(SCENARIO_TICKS)
  assert.equal(left.hashes.length, SCENARIO_TICKS)
  for (let index = 0; index < left.hashes.length; index++) {
    assert.equal(left.hashes[index], right.hashes[index], `tick ${index + 1} 状态不一致`)
  }
  // 哈希必须随状态变化，否则说明它没覆盖到真正的状态
  assert.notEqual(left.hashes[0], left.hashes[left.hashes.length - 1])
  assert.ok(new Set(left.hashes).size > 50)
})

test('末态哈希固定（回归快照）', () => {
  assert.equal(runScenario(SCENARIO_TICKS).finalHash, GOLDEN_FINAL_HASH)
})

test('worldAtTick 与整段运行结果一致', () => {
  assert.equal(runScenario(120).finalHash, runScenario(SCENARIO_TICKS).hashes[119])
  assert.equal(worldAtTick(0).tick, 0)
})

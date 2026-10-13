import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acesApprox, applyTonemap } from '../src/game/tonemap.js'

test('ACES 近似：0 进 0 出，1 附近压到 <1，单调不减', () => {
  assert.deepEqual(acesApprox([0, 0, 0]), [0, 0, 0])
  const one = acesApprox([1, 1, 1])
  assert.ok(one[0]! > 0.7 && one[0]! < 0.9, `1.0 映射后应在 0.7-0.9，实际 ${one[0]}`)
  const two = acesApprox([2, 2, 2])
  assert.ok(two[0]! > one[0]!, '2.0 应比 1.0 更亮（高光仍可区分）')
  assert.ok(two[0]! <= 1, 'ACES 输出上界 1')
})

test('曝光：整体线性缩放后进曲线；增益与压暗对称', () => {
  const base = applyTonemap([0.5, 0.5, 0.5], { exposure: 1, enabled: true })
  const brighter = applyTonemap([0.5, 0.5, 0.5], { exposure: 1.5, enabled: true })
  const darker = applyTonemap([0.5, 0.5, 0.5], { exposure: 0.5, enabled: true })
  assert.ok(brighter[0]! > base[0]! && base[0]! > darker[0]!, `E=1.5/1/0.5 应单调：${brighter[0]},${base[0]},${darker[0]}`)
})

test('开关关闭时原样返回（默认零影响的核心语义）', () => {
  assert.deepEqual(applyTonemap([0.3, 0.6, 0.9], { exposure: 2, enabled: false }), [0.3, 0.6, 0.9])
})

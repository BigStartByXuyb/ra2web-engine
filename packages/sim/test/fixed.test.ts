import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ONE, fixedDiv, fixedLength, fixedMul, fromFixed, fromFixedExact, isqrt, toFixed } from '../src/fixed.js'

test('定点与格坐标互转', () => {
  assert.equal(toFixed(3), 3 * ONE)
  assert.equal(fromFixed(3 * ONE + 200), 3)
  assert.equal(fromFixed(-ONE - 5), -1)
})

test('绘制用的格坐标保留小数，与截断取格号是两件事', () => {
  // 犀牛每 tick 走 15 lepton（Speed=6，见 movement-scale）。从格心出发走 8 个 tick 共 120 lepton，
  // 还在同一格里：截断值一个都不变，精确值每个 tick 都不同。
  const start = 3 * ONE + (ONE >> 1)
  const truncated = new Set<number>()
  const exact = new Set<number>()
  for (let tick = 0; tick <= 8; tick++) {
    truncated.add(fromFixed(start + tick * 15))
    exact.add(fromFixedExact(start + tick * 15))
  }
  assert.equal(truncated.size, 1, '截断后这段时间里格号不变（"一格一格跳"就是这么来的）')
  assert.equal(exact.size, 9)
  assert.equal(fromFixedExact(2 * ONE), 2)
  assert.equal(fromFixedExact(3 * ONE + 128), 3.5)
})

test('定点乘除截断，不做四舍五入', () => {
  assert.equal(fixedMul(ONE, ONE), ONE)
  assert.equal(fixedMul(ONE / 2, ONE / 2), ONE / 4)
  assert.equal(fixedDiv(ONE, 2 * ONE), ONE / 2)
  assert.equal(fixedDiv(ONE, 3 * ONE), 85)
})

test('整数平方根', () => {
  assert.equal(isqrt(0), 0)
  assert.equal(isqrt(1), 1)
  assert.equal(isqrt(15), 3)
  assert.equal(isqrt(16), 4)
  assert.equal(isqrt(9999), 99)
})

test('定点长度用于距离比较', () => {
  assert.equal(fixedLength(3 * ONE, 4 * ONE), 5 * ONE)
  assert.equal(fixedLength(0, 0), 0)
})

test('除以零显式报错，不产生 NaN', () => {
  assert.throws(() => fixedDiv(ONE, 0))
})

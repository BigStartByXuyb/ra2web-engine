import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ONE, fixedDiv, fixedLength, fixedMul, fromFixed, isqrt, toFixed } from '../src/fixed.js'

test('定点与格坐标互转', () => {
  assert.equal(toFixed(3), 3 * ONE)
  assert.equal(fromFixed(3 * ONE + 200), 3)
  assert.equal(fromFixed(-ONE - 5), -1)
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

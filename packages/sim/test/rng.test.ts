import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRng, nextBelow, nextUint32 } from '../src/rng.js'

test('同种子产生同序列', () => {
  const a = createRng(12345)
  const b = createRng(12345)
  const left = Array.from({ length: 8 }, () => nextUint32(a))
  const right = Array.from({ length: 8 }, () => nextUint32(b))
  assert.deepEqual(left, right)
})

test('不同种子产生不同序列', () => {
  const a = createRng(1)
  const b = createRng(2)
  assert.notDeepEqual([nextUint32(a), nextUint32(a)], [nextUint32(b), nextUint32(b)])
})

test('nextBelow 落在范围内且分布可复现', () => {
  const a = createRng(7)
  const b = createRng(7)
  const left = Array.from({ length: 64 }, () => nextBelow(a, 6))
  const right = Array.from({ length: 64 }, () => nextBelow(b, 6))
  assert.deepEqual(left, right)
  assert.ok(left.every((value) => value >= 0 && value < 6))
})

test('nextBelow 拒绝非法上界', () => {
  const rng = createRng(1)
  assert.throws(() => nextBelow(rng, 0))
})

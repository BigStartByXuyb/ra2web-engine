import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FACING_COUNT } from '@ra2web/render'
import { facingFromDelta } from '../src/game/unit-art.js'

/**
 * 朝向的口径：`facingFromDelta` 用**屏幕位移**算出的 8 向编号，精灵帧与 3D 模型共用同一份。
 *
 * 这一条是被一次真实回归逼出来的：曾经在 3D 那条路里额外补了 π 想"对齐精灵帧"，
 * 结果移动时车头全反了。朝向只有一个来源 —— 位移；静帧上"炮管朝哪边"受机位遮挡影响，
 * 不能拿来当判据。
 */
test('位移方向 → 朝向编号：屏幕 +x 是 0，顺时针每 45° 进一位', () => {
  assert.equal(facingFromDelta(1, 0), 0, '往右走 = 0')
  assert.equal(facingFromDelta(1, 1), 1)
  assert.equal(facingFromDelta(0, 1), 2, '往下走 = 2')
  assert.equal(facingFromDelta(-1, 1), 3)
  assert.equal(facingFromDelta(-1, 0), 4, '往左走 = 4')
  assert.equal(facingFromDelta(-1, -1), 5)
  assert.equal(facingFromDelta(0, -1), 6, '往上走 = 6')
  assert.equal(facingFromDelta(1, -1), 7)
})

test('没有位移时停在 0，且编号永远落在 0..7', () => {
  assert.equal(facingFromDelta(0, 0), 0)
  for (const [x, y] of [
    [0.001, 0],
    [-0.001, 0],
    [3.7, -0.2],
    [-1, 40],
  ] as const) {
    const facing = facingFromDelta(x, y)
    assert.ok(Number.isInteger(facing) && facing >= 0 && facing < FACING_COUNT, `${x},${y} → ${facing}`)
  }
})

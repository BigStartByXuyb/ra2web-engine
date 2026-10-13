import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyVerses, canDamage, versesMultiplier } from '../src/combat.js'

/**
 * Warhead→Armor 伤害修正（docs/ENGINE-MAP「武器与弹头」+「开火判定链」节）：
 * Verses = 11×double @ Warhead+0xa0（缺省全 1.0、%×0.01），Armor 枚举 @ TechnoType+0x9c
 * （0..10），有效性判定 `Verses[armor] != 0.0`（fn-6c1380/fn-6d3400），乘法 double。
 * 取整时点归阶段 4，本组测试不涉及取整。
 */

const FULL_ONES = Array.from({ length: 11 }, () => 1)

test('缺省表（全 1.0）下所有护甲乘数为 1', () => {
  for (let armor = 0; armor < 11; armor++) {
    assert.equal(versesMultiplier(FULL_ONES, armor), 1)
    assert.equal(applyVerses(100, FULL_ONES, armor), 100)
  }
})

test('典型表值按 armor 下标生效（对应原版 +0xa0 + armor*8 取 double）', () => {
  // RA2 档案典型 AP 弹：对 heavy=50%、concrete=40%、infantry(无 甲=none)=100%
  const verses = [1, 0.9, 0.85, 0.75, 0.6, 0.5, 0.65, 0.7, 0.4, 0.2, 0.1]
  assert.equal(applyVerses(100, verses, 0), 100) // none
  assert.equal(applyVerses(100, verses, 5), 50) // heavy
  assert.equal(applyVerses(100, verses, 8), 40) // concrete
  assert.equal(applyVerses(7, verses, 10), 0.7000000000000001) // special_2（IEEE-754 double 积，与原版 fmul 位一致）
})

test('Verses 含 0 项：该护甲不可伤害（fn-6c1380 的 !=0.0 口径）', () => {
  const verses = [1, 0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5]
  assert.equal(canDamage(verses, 2), false)
  assert.equal(canDamage(verses, 4), true)
  assert.equal(applyVerses(80, verses, 3), 0)
})

test('armor 下标越界：乘数按 1 处理（本项目自定防御口径，原版无越界分支）', () => {
  assert.equal(versesMultiplier(FULL_ONES, -1), 1)
  assert.equal(versesMultiplier(FULL_ONES, 11), 1)
  assert.equal(canDamage([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 11), true)
})

test('表长度不足 11：已有项生效，缺失项按 1（与 rules 解析兜底一致，本项目自定）', () => {
  assert.equal(applyVerses(100, [0.5], 0), 50)
  assert.equal(applyVerses(100, [0.5], 5), 100)
})

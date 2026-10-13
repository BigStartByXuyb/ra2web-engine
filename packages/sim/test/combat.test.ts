import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyExplosion,
  applyVerses,
  canDamage,
  hasDamage,
  isInRange,
  versesMultiplier,
  UNLIMITED_RANGE,
} from '../src/combat.js'

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

// ---- 射程口径（fn-6c4bb0）----

test('无限射程哨兵 -512 直通（fn-6c4bb0 的 Range==-0x200）', () => {
  assert.equal(isInRange({ range: UNLIMITED_RANGE, minRange: 0 }, 9999, false, 0), true)
  assert.equal(
    isInRange({ range: UNLIMITED_RANGE, minRange: 0 }, 9999, true, 3),
    true,
  )
})

test('对空加成只在目标空中时生效（TechnoType+0x5b4）', () => {
  const w = { range: 10, minRange: 0 }
  assert.equal(isInRange(w, 12, false, 3), false) // 地面目标：10 格封顶
  assert.equal(isInRange(w, 12, true, 3), true) // 空中目标：10+3
})

test('MinRange 拒发：距离小于最小射程（fn-6c4bb0 的 +0xb8 检查）', () => {
  assert.equal(isInRange({ range: 10, minRange: 3 }, 2.5, false, 0), false)
  assert.equal(isInRange({ range: 10, minRange: 3 }, 3, false, 0), true)
})

test('上限比较含等号（本项目自定口径，原版相等分支未逐指令核对）', () => {
  assert.equal(isInRange({ range: 10, minRange: 0 }, 10, false, 0), true)
})

// ---- 爆炸承载（fn-421710/fn-70e470）----

test('DamageRadius=0 的爆炸动画不造成伤害（本项目自定口径，原版运行时门控为 ExpireAnim!=0，见 combat.ts 注释）', () => {
  const an = { verses: FULL_ONES, damageRadius: 0 }
  assert.equal(hasDamage(an), false)
  assert.deepEqual(applyExplosion(an, 100, [{ armorIndex: 5 }]), [100])
})

test('爆炸 AoE：半径内目标逐个 Verses 修正（顺序保持，不取整）', () => {
  const an = { verses: [1, 0.9, 0.85, 0.75, 0.6, 0.5, 0.65, 0.70, 0.4, 0.2, 0.1], damageRadius: 3 }
  const targets = [{ armorIndex: 0 }, { armorIndex: 5 }, { armorIndex: 8 }]
  assert.deepEqual(applyExplosion(an, 100, targets), [100, 50, 40])
})

test('爆炸 AoE 对不可伤护甲落 0（Verses=0 项），不剔除目标', () => {
  const an = { verses: [1, 0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5], damageRadius: 2 }
  assert.deepEqual(applyExplosion(an, 80, [{ armorIndex: 2 }, { armorIndex: 0 }]), [0, 80])
})

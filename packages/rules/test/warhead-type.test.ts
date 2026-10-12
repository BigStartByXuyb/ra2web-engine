import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadRules } from '../src/raw-rules.js'
import { armorIndex } from '../src/armor-type.js'
import { listWarheadIds, parseWarheadType } from '../src/warhead-type.js'

// 期望值证据：WarheadTypeClass::Read_INI = 0x7204e0（work/decompiled/ra2-engine/fn-7204e0.md）
// - Verses 键 0x7fb1d8，默认串 0x7fb1e0（"100%%," ×11 → 11 项全 1.0）
// - Verses → 11 个 double（实例 +0xa0..+0xf8），带 % 的项 ×0.01，无 % 的项按浮点直存
// - 护甲下标 = 指针表 0x79ddf8：none/flak/plate/light/medium/heavy/wood/steel/concrete/special_1/special_2

const RULES = loadRules([
  {
    name: 'rules.ini',
    text: [
      '[HE]',
      'CellSpread=.18',
      'Verses=110%,80%,70%,60%,50%,40%,30%,20%,10%,5%,1%',
      '',
      '[AP]',
      'Verses=120%,130%,110%,100%,100%,100%,85%,85%,85%,100%,100%',
      '',
      '[FloatVerses]',
      'Verses=1.5,0.5,0.25,1,1,1,1,1,1,1,1',
      '',
      '[ShortList]',
      'Verses=50%',
      '',
      '[Warheads]',
      '1=HE',
      '2=AP',
      '3=AP',
    ].join('\n'),
  },
])

test('Verses 按 11 项护甲序解析为 0..1 小数', () => {
  const warhead = parseWarheadType(RULES, 'HE')
  assert.ok(warhead)
  assert.equal(warhead.verses.length, 11)
  assert.equal(warhead.verses[armorIndex('none')!], 1.1)
  assert.equal(warhead.verses[armorIndex('flak')!], 0.8)
  assert.equal(warhead.verses[armorIndex('heavy')!], 0.4)
  assert.equal(warhead.verses[armorIndex('concrete')!], 0.1)
  assert.equal(warhead.verses[armorIndex('special_1')!], 0.05)
  assert.equal(warhead.verses[armorIndex('special_2')!], 0.01)
})

test('不带百分号的项按浮点直存（原版两分支口径）', () => {
  const warhead = parseWarheadType(RULES, 'FloatVerses')
  assert.ok(warhead)
  assert.equal(warhead.verses[armorIndex('none')!], 1.5)
  assert.equal(warhead.verses[armorIndex('flak')!], 0.5)
})

test('键缺省时全 1.0（默认串证据）', () => {
  const rules = loadRules([{ name: 'x', text: '[NoVerses]\nCellSpread=0.3\n' }])
  const warhead = parseWarheadType(rules, 'NoVerses')
  assert.ok(warhead)
  assert.deepEqual(warhead.verses, Array(11).fill(1.0))
})

test('列表长度不足 11 时补 1.0 并记 issue（补值口径为本项目自定）', () => {
  const warhead = parseWarheadType(RULES, 'ShortList')
  assert.ok(warhead)
  assert.equal(warhead.verses[armorIndex('none')!], 0.5)
  assert.equal(warhead.verses[armorIndex('flak')!], 1.0)
  assert.equal(
    warhead.issues.some((issue) => issue.key === 'Verses'),
    true,
  )
})

test('CellSpread 按浮点解析', () => {
  const warhead = parseWarheadType(RULES, 'HE')
  assert.equal(warhead?.cellSpread, 0.18)
})

test('Warheads 列表按索引排序（列表键 "Warheads" 见 0x6437f0 引用）', () => {
  assert.deepEqual(listWarheadIds(RULES), ['HE', 'AP', 'AP'])
  assert.deepEqual(listWarheadIds(RULES, 'NotExist'), [])
})

test('不存在的弹头返回 undefined', () => {
  assert.equal(parseWarheadType(RULES, 'NOPE'), undefined)
})

test('护甲名查下标：大小写不敏感，未知返回 undefined', () => {
  assert.equal(armorIndex('Heavy'), 5)
  assert.equal(armorIndex('concrete'), 8)
  assert.equal(armorIndex('special_2'), 10)
  assert.equal(armorIndex('alien'), undefined)
})

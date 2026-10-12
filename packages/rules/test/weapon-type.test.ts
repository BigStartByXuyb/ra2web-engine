import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listWeaponIds, parseWeaponType } from '../src/weapon-type.js'
import { loadRules } from '../src/raw-rules.js'

// 期望值证据：WeaponTypeClass::Read_INI = 0x733220（fn-733220.md / fn-733220.c）
// - Damage=+0xa4(int)、ROF=+0xb0(int)、Range/MinimumRange=+0xb4/+0xb8（float 读入四舍五入取整）
// - Speed=+0xa8：FUN_00469cd0，0..100 百分比 → (v<<8)/100 定点，钳 ≤0xff（255 = Speed 100 封顶）
// - Burst=+0x9c、Projectile=+0xa0 与 Warhead=+0xac 为按名引用

const RULES = loadRules([
  {
    name: 'rules.ini',
    text: [
      '[120mm]',
      'Damage=110',
      'ROF=50',
      'Range=5',
      'MinimumRange=1',
      'Burst=2',
      'Speed=100',
      'Projectile=InvisibleAll',
      'Warhead=HE',
      'Report=120mmA',
      '',
      '[FVulcan]',
      'Damage=10',
      'ROF=16',
      'Range=4',
      'Speed=50',
      'Projectile=InvisibleLow',
      'Warhead=SA',
      '',
      '[ClampCase]',
      'Damage=1',
      'Speed=150',
      '',
      '[ZeroSpeed]',
      'Speed=0',
      '',
      '[NegativeSpeed]',
      'Speed=-1',
      '',
      '[HalfRange]',
      'Range=5.5',
      '',
      '[NegativeRange]',
      'Range=-1',
      '',
      '[BadValues]',
      'Damage=abc',
      'ROF=1.5',
      'Range=xyz',
      'Speed=fast',
      '',
      '[Weapons]',
      '1=60mm',
      '2=120mm',
      '10=FVulcan',
    ].join('\n'),
  },
])

test('核心战斗字段被解析为强类型', () => {
  const weapon = parseWeaponType(RULES, '120mm')
  assert.ok(weapon)
  assert.equal(weapon.damage, 110)
  assert.equal(weapon.rof, 50)
  assert.equal(weapon.range, 5)
  assert.equal(weapon.minimumRange, 1)
  assert.equal(weapon.burst, 2)
  // Speed=100 → (100<<8)/100 = 256 → 钳到 255（原版上限）
  assert.equal(weapon.speed, 255)
  assert.equal(weapon.projectile, 'InvisibleAll')
  assert.equal(weapon.warhead, 'HE')
  assert.deepEqual(weapon.issues, [])
})

test('Speed 百分比按 (v<<8)/100 定点换算并封顶', () => {
  // 50 → (50<<8)/100 = 128
  assert.equal(parseWeaponType(RULES, 'FVulcan')?.speed, 128)
  // 150 → 先钳 100 → 255
  assert.equal(parseWeaponType(RULES, 'ClampCase')?.speed, 255)
  // 0 → 0
  assert.equal(parseWeaponType(RULES, 'ZeroSpeed')?.speed, 0)
  // -1 = 原版"保留现值"口径 → 未写入
  assert.equal(parseWeaponType(RULES, 'NegativeSpeed')?.speed, undefined)
})

test('Range 按原版 float 读入并四舍五入为格数整数', () => {
  assert.equal(parseWeaponType(RULES, 'HalfRange')?.range, 6)
  // -1.0 是原版"未提供"哨兵 → 未写入
  assert.equal(parseWeaponType(RULES, 'NegativeRange')?.range, undefined)
  assert.equal(parseWeaponType(RULES, 'FVulcan')?.minimumRange, undefined)
})

test('非法值记录为 issue 而不是静默丢弃', () => {
  const weapon = parseWeaponType(RULES, 'BadValues')
  assert.equal(weapon?.damage, undefined)
  assert.equal(weapon?.rof, undefined)
  assert.equal(weapon?.range, undefined)
  assert.equal(weapon?.speed, undefined)
  assert.deepEqual(weapon?.issues.map((issue) => issue.key).sort(), ['Damage', 'ROF', 'Range', 'Speed'])
})

test('未映射字段保留在 raw 里', () => {
  const weapon = parseWeaponType(RULES, '120mm')
  assert.equal(weapon?.raw.get('report'), '120mmA')
})

test('武器列表按索引排序', () => {
  assert.deepEqual(listWeaponIds(RULES), ['60mm', '120mm', 'FVulcan'])
  assert.deepEqual(listWeaponIds(RULES, 'NotExist'), [])
})

test('不存在的武器返回 undefined', () => {
  assert.equal(parseWeaponType(RULES, 'NOPE'), undefined)
})

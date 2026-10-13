import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listUnitIds, parseUnitType } from '../src/unit-type.js'
import { loadRules } from '../src/raw-rules.js'

const RULES = loadRules([
  {
    name: 'rules.ini',
    text: [
      '[HTNK]',
      'UIName=Name:HTNK',
      'Name=Rhino Heavy Tank',
      'Image=HTNK',
      'Category=AFV',
      'Strength=400',
      'Armor=heavy',
      'Speed=6',
      'ROT=5',
      'SpeedType=Track',
      'Sight=8',
      'Cost=900',
      'TechLevel=2',
      'Primary=120mm',
      'Turret=yes',
      'Owner=Russians,Confederation,Africans,Arabs',
      'Prerequisite=NAWEAP',
      'FutureField=whatever',
      '',
      '[VehicleTypes]',
      '3=APOC',
      '4=HTNK',
      '10=MTNK',
    ].join('\n'),
  },
])

test('核心字段被解析为强类型', () => {
  const unit = parseUnitType(RULES, 'HTNK')
  assert.ok(unit)
  assert.equal(unit.displayName, 'Rhino Heavy Tank')
  assert.equal(unit.strength, 400)
  assert.equal(unit.speed, 6)
  assert.equal(unit.rot, 5)
  assert.equal(unit.speedType, 'Track')
  assert.equal(unit.sight, 8)
  assert.equal(unit.cost, 900)
  assert.equal(unit.techLevel, 2)
  assert.equal(unit.armor, 'heavy')
  assert.equal(unit.primary, '120mm')
  assert.equal(unit.turret, true)
  assert.deepEqual(unit.owners, ['Russians', 'Confederation', 'Africans', 'Arabs'])
  assert.deepEqual(unit.prerequisites, ['NAWEAP'])
  assert.deepEqual(unit.issues, [])
})

test('未映射字段仍保留在 raw 里', () => {
  const unit = parseUnitType(RULES, 'HTNK')
  assert.equal(unit?.raw.get('futurefield'), 'whatever')
})

test('非法值记录为 issue 而不是静默丢弃', () => {
  const rules = loadRules([{ name: 'x', text: '[BAD]\nStrength=abc\nTurret=maybe\nName=\n' }])
  const unit = parseUnitType(rules, 'BAD')
  assert.equal(unit?.strength, undefined)
  assert.equal(unit?.turret, false)
  assert.deepEqual(unit?.issues.map((issue) => issue.key).sort(), ['Name', 'Strength', 'Turret'])
  // 键不存在不算问题：只有"写了但写错"才记录
  assert.equal(unit?.uiName, undefined)
  assert.equal(
    unit?.issues.some((issue) => issue.key === 'UIName'),
    false,
  )
})

test('类型列表按索引排序，忽略注释', () => {
  assert.deepEqual(listUnitIds(RULES, 'VehicleTypes'), ['APOC', 'HTNK', 'MTNK'])
  assert.deepEqual(listUnitIds(RULES, 'NotExist'), [])
})

test('不存在的单位返回 undefined', () => {
  assert.equal(parseUnitType(RULES, 'NOPE'), undefined)
})

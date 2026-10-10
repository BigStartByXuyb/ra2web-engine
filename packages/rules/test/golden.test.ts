import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { loadRules } from '../src/raw-rules.js'
import { parseUnitType } from '../src/unit-type.js'

/**
 * 原版数值核对：只在本地提供原版 rules.ini 时运行。
 * 设定 `RA2_RULES_INI=<路径>` 即启用；仓库里不放受版权保护的原始文件。
 */
const rulesPath = process.env.RA2_RULES_INI

test('原版 rules.ini 的犀牛数值与本项目解析一致', { skip: !rulesPath ? '未设置 RA2_RULES_INI' : false }, () => {
  const rules = loadRules([{ name: 'rules.ini', text: fs.readFileSync(rulesPath!, 'latin1') }])
  const unit = parseUnitType(rules, 'HTNK')
  assert.ok(unit, 'rules.ini 里应当存在 [HTNK]')
  assert.equal(unit.strength, 400)
  assert.equal(unit.speed, 6)
  assert.equal(unit.cost, 900)
  assert.equal(unit.rot, 5)
  assert.equal(unit.armor, 'heavy')
  assert.equal(unit.techLevel, 2)
  assert.equal(unit.sight, 8)
  assert.equal(unit.primary, '120mm')
  assert.equal(unit.turret, true)
  assert.deepEqual(unit.owners, ['Russians', 'Confederation', 'Africans', 'Arabs'])
  assert.deepEqual(unit.issues, [])
})

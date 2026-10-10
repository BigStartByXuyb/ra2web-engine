import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadRules, valueOf } from '../src/raw-rules.js'

test('后加载文件逐键覆盖，未提到的键保持原值', () => {
  const rules = loadRules([
    { name: 'rules.ini', text: '[HTNK]\nStrength=400\nSpeed=6\nCost=900\n' },
    { name: 'rulescd.ini', text: '[HTNK]\nStrength=420\n' },
  ])
  assert.equal(valueOf(rules, 'htnk', 'strength'), '420')
  assert.equal(valueOf(rules, 'htnk', 'speed'), '6')
  assert.equal(valueOf(rules, 'htnk', 'cost'), '900')
})

test('节名与键名大小写不敏感', () => {
  const rules = loadRules([{ name: 'a', text: '[Htnk]\nStrength=400\n' }])
  assert.equal(valueOf(rules, 'HTNK', 'STRENGTH'), '400')
})

test('加载顺序被记录下来，未知节不丢失', () => {
  const rules = loadRules([
    { name: 'rules.ini', text: '[A]\nX=1\n' },
    { name: 'art.ini', text: '[B]\nY=2\n' },
  ])
  assert.deepEqual(rules.loadedFiles, ['rules.ini', 'art.ini'])
  assert.deepEqual(rules.document.order, ['a', 'b'])
  assert.equal(valueOf(rules, 'b', 'y'), '2')
})

test('同名节出现在多个文件时合并而非替换', () => {
  const rules = loadRules([
    { name: 'a', text: '[T]\nX=1\nY=1\n' },
    { name: 'b', text: '[T]\nX=2\n' },
  ])
  assert.equal(valueOf(rules, 't', 'x'), '2')
  assert.equal(valueOf(rules, 't', 'y'), '1')
  assert.deepEqual(rules.document.order, ['t'])
})

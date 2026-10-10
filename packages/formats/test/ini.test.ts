import assert from 'node:assert/strict'
import { test } from 'node:test'
import { iniValue, parseIni } from '../src/ini.js'

const SAMPLE = [
  '; 顶部注释',
  '[HTNK]',
  'UIName=Name:HTNK',
  'Name=Rhino Heavy Tank   ; 行尾注释',
  '',
  '[htnk]          ; 同名节大小写不同 → 并入同一节',
  'Strength=400',
  'Strength=500',
  '   ',
  'Primary=120mm',
].join('\r\n')

test('节与键按大小写不敏感合并', () => {
  const document = parseIni(SAMPLE)
  assert.deepEqual(document.order, ['htnk'])
  assert.equal(document.sections.size, 1)
})

test('重复键以后出现的为准（MOD 覆盖机制）', () => {
  const document = parseIni(SAMPLE)
  assert.equal(iniValue(document, 'HTNK', 'strength'), '500')
})

test('行尾注释被剥离，值保留内部空格', () => {
  const document = parseIni(SAMPLE)
  assert.equal(iniValue(document, 'htnk', 'name'), 'Rhino Heavy Tank')
  assert.equal(iniValue(document, 'htnk', 'uiname'), 'Name:HTNK')
})

test('未知节与未知键返回 undefined', () => {
  const document = parseIni(SAMPLE)
  assert.equal(iniValue(document, 'nope', 'strength'), undefined)
  assert.equal(iniValue(document, 'htnk', 'nope'), undefined)
})

test('节外键值被忽略', () => {
  const document = parseIni('Stray=1\n[S]\nA=2')
  assert.equal(document.sections.size, 1)
  assert.equal(iniValue(document, 's', 'stray'), undefined)
})

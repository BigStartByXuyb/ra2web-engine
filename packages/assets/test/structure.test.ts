import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { openStructures, openTheater, loadTheaterPalette } from '../src/index.js'

/**
 * 建筑美术：地图里的类型名 → art.ini → 按剧场规则取 SHP。
 */
const mixPath = process.env.RA2_MIX
const skip = !mixPath || !fs.existsSync(mixPath) ? '未设置 RA2_MIX' : undefined

test('原版建筑能取到图形与地基尺寸', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const structures = openStructures(archive, 'snow')
  assert.ok(structures)

  // 民房：art.ini 里 Theater=yes → carus02a.sno 一类
  const house = structures.loadStructure('CARUS02A')
  assert.ok(house, 'CARUS02A 应当能取到图形')
  assert.ok(house.shp.frames.some((frame) => !frame.isEmpty))
  assert.ok(house.foundationWidth >= 1 && house.foundationHeight >= 1)

  // 防空炮是雪地那张地图上数量最多的建筑之一
  assert.ok(structures.loadStructure('NAFLAK'))

  // 不存在的类型返回 undefined，不抛错
  assert.equal(structures.loadStructure('NO_SUCH_BUILDING'), undefined)
})

test('图形名按 art.ini Image= → rules.ini Image= → 类型名 取', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const structures = openStructures(archive, 'snow')!

  // TESLA 在 art.ini 里没有条目，rules.ini 写 `Image=NATSLA` → natsla.shp
  const tesla = structures.loadStructure('TESLA')
  assert.ok(tesla, '磁暴线圈应当按 rules.ini 的 Image=NATSLA 取到 natsla.shp')
  assert.ok(tesla.shp.frames.some((frame) => !frame.isEmpty))

  // ATESLA 同理：rules.ini 写 `Image=GAPRIS`
  assert.ok(structures.loadStructure('ATESLA'), 'ATESLA 应当按 rules.ini 的 Image=GAPRIS 取到图形')

  // 灯柱类四种类型共用 rules.ini 的 `Image=GALITE`
  for (const type of ['INGALITE', 'INBLULMP', 'INYELWLAMP', 'INREDLMP', 'NEGLAMP']) {
    assert.ok(structures.loadStructure(type), `${type} 应当按 rules.ini 的 Image=GALITE 取到图形`)
  }
})

test('本剧场的包里没有的图形会去别的剧场包里找', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  // gapowr.shp 只存在于 snow.mix（实测 8 个主战图形如此），温带地图也必须能取到它
  const temperate = openStructures(archive, 'temperate')!
  assert.ok(temperate.loadStructure('GAPOWR'), '温带下也应当取到只存在 snow.mix 里的 gapowr.shp')
  assert.ok(temperate.loadStructure('NAPOWR'))
  assert.ok(temperate.loadStructure('GAPILL'))
})

test('建筑与单位共用地形色板与单位色板，两套都能取到', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  assert.ok(loadTheaterPalette(archive, 'snow', 'iso'))
  const unit = loadTheaterPalette(archive, 'snow', 'unit')
  assert.ok(unit, 'unitsno.pal 应当能取到')
  assert.notDeepEqual(unit.colors[100], loadTheaterPalette(archive, 'snow', 'iso')!.colors[100], '两套色板不应相同')
  assert.ok(openTheater(archive, 'snow'))
})

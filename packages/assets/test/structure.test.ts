import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { openStructures, openTheater, loadTheaterPalette } from '../src/index.js'

/**
 * 建筑美术：地图里的类型名 → art.ini → 按剧场规则取 SHP。
 * 实测 `Maps01.mix` 第 0 张的 268 个建筑里 227 个能取到图形（其余在原版里也没有独立图形）。
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

  // 磁暴线圈是**体素建筑**（`.vxl`），本层只取 SHP，因此取不到 —— 待接体素建筑
  assert.equal(structures.loadStructure('TESLA'), undefined, '体素建筑尚未接入')
})

test('建筑与单位共用地形色板与单位色板，两套都能取到', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  assert.ok(loadTheaterPalette(archive, 'snow', 'iso'))
  const unit = loadTheaterPalette(archive, 'snow', 'unit')
  assert.ok(unit, 'unitsno.pal 应当能取到')
  assert.notDeepEqual(unit.colors[100], loadTheaterPalette(archive, 'snow', 'iso')!.colors[100], '两套色板不应相同')
  assert.ok(openTheater(archive, 'snow'))
})

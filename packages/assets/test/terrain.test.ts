import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { crc32, findMixEntry, readMixEntry, readMixIndex, readTheaterIni } from '@ra2web/formats'
import { test } from 'node:test'
import { buildPassability } from '../src/terrain.js'

const SYNTHETIC = [
  '[General]',
  'ClearTile = 0',
  'WaterSet = 2',
  'BlackTile = 3',
  '',
  '[TileSet0000]',
  'SetName = Clear',
  'FileName = Clear',
  'TilesInSet = 2',
  '',
  '[TileSet0001]',
  'SetName = Roads',
  'FileName = Road',
  'TilesInSet = 3',
  '',
  '[TileSet0002]',
  'SetName = Water',
  'FileName = Water',
  'TilesInSet = 2',
  '',
  '[TileSet0003]',
  'SetName = Blank',
  'FileName = blank',
  'TilesInSet = 1',
  '',
].join('\r\n')

test('通行性按地块集分类：水与空白不可通行', () => {
  const ini = readTheaterIni(new Uint8Array(Buffer.from(SYNTHETIC, 'latin1')))
  const passability = buildPassability(ini)
  assert.equal(passability.blockedByTile.length, 8)
  assert.deepEqual([...passability.blockedByTile], [0, 0, 0, 0, 0, 1, 1, 1])
  assert.deepEqual(passability.blockedSetNames, ['Water', 'Blank'])
})

/** 原版：水域与悬崖集不可通行，Clear 地块可通行。 */
const mixPath = process.env.RA2_MIX
const skip = !mixPath || !fs.existsSync(mixPath) ? '未设置 RA2_MIX' : false

test('原版 snow.ini 的通行性判定', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const root = readMixIndex(archive)
  const localBytes = readMixEntry(archive, root, findMixEntry(root, 'local.mix', crc32)!)
  const local = readMixIndex(localBytes)
  const ini = readTheaterIni(readMixEntry(localBytes, local, findMixEntry(local, 'snow.ini', crc32)!))
  const passability = buildPassability(ini)

  assert.deepEqual(passability.blockedSetNames, [
    'Blank',
    'Cliff Set',
    'Cliff/Water pieces',
    'Water',
    'Destroyable Cliffs',
  ])
  assert.equal(passability.blockedByTile[0], 0, 'Clear 地块可通行')
  // WaterSet=21 → 第 21 个集的首块编号
  const waterStart = ini.sets.slice(0, 21).reduce((sum, set) => sum + set.tilesInSet, 0)
  assert.equal(passability.blockedByTile[waterStart], 1, '水域首块不可通行')
  const blockedCount = passability.blockedByTile.reduce((sum, value) => sum + value, 0)
  // 实测 85 块（Blank 1 + Cliff Set 40 + Cliff/Water 28 + Water 14 + Destroyable Cliffs 2）
  assert.ok(blockedCount >= 50 && blockedCount <= 200, `不可通行地块数异常：${blockedCount}`)
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { crc32 } from '../src/crc32.js'
import { findMixEntry, readMixEntry, readMixIndex } from '../src/mix.js'
import { readTheaterIni, theaterNumber, tileFileName } from '../src/theater.js'

const SYNTHETIC = [
  '; 合成地块控制文件',
  '[General]',
  'ClearTile = 0',
  'RoughTile = 5',
  '',
  '[TileSet0000]',
  'SetName = LAT Snow',
  'FileName = Clear',
  'TilesInSet = 1',
  '',
  '[TileSet0001]',
  'SetName = Empty',
  'FileName = blank',
  'TilesInSet = 0',
  '',
  '[TileSet0002]',
  'SetName = Slopes',
  'FileName = slope',
  'TilesInSet = 3',
  '',
].join('\r\n')

test('地块控制文件：集顺序决定全局编号', () => {
  const ini = readTheaterIni(new Uint8Array(Buffer.from(SYNTHETIC, 'latin1')))
  assert.equal(ini.sets.length, 3)
  assert.equal(ini.tiles.length, 4, '0 块的那一集不贡献地块')
  assert.equal(theaterNumber(ini, 'ClearTile'), 0)
  assert.equal(theaterNumber(ini, 'RoughTile'), 5)

  assert.deepEqual(
    ini.tiles.map((tile) => `${tile.fileName}${tile.tileNumber}`),
    ['Clear1', 'slope1', 'slope2', 'slope3'],
  )
  assert.equal(tileFileName(ini.tiles[1]!, '.sno'), 'slope01.sno')
})

test('没有地块集的 INI 会得到空表', () => {
  const ini = readTheaterIni(new Uint8Array(Buffer.from('[General]\r\nClearTile=0\r\n', 'latin1')))
  assert.equal(ini.tiles.length, 0)
})

/**
 * 原版地块控制文件的端到端核对：`RA2_MIX` 的 local.mix 里应有 snow.ini，
 * 且它的地块图形能在 isosnow.mix 里按规则找到。
 */
const mixPath = process.env.RA2_MIX
const skip = !mixPath || !fs.existsSync(mixPath) ? '未设置 RA2_MIX' : false

test('原版 snow.ini 的地块表与图形文件名一致', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const root = readMixIndex(archive)
  const localBytes = readMixEntry(archive, root, findMixEntry(root, 'local.mix', crc32)!)
  const local = readMixIndex(localBytes)
  const ini = readTheaterIni(readMixEntry(localBytes, local, findMixEntry(local, 'snow.ini', crc32)!))

  assert.equal(ini.sets.length, 75)
  assert.equal(ini.tiles.length, 798)
  assert.equal(ini.tiles[0]!.fileName, 'Clear')
  assert.equal(theaterNumber(ini, 'ClearTile'), 0)

  const theaterBytes = readMixEntry(archive, root, findMixEntry(root, 'isosnow.mix', crc32)!)
  const theater = readMixIndex(theaterBytes)
  assert.ok(findMixEntry(theater, tileFileName(ini.tiles[0]!, '.sno'), crc32), 'Clear01.sno 应当存在')

  // 覆盖率：按"无字母 / a..c"试名，应当覆盖大部分地块
  let resolved = 0
  for (const tile of ini.tiles) {
    const base = tileFileName(tile, '.sno')
    if (
      findMixEntry(theater, base, crc32) ??
      ['a', 'b', 'c'].some((letter) => findMixEntry(theater, `${base.slice(0, -4)}${letter}.sno`, crc32))
    ) {
      resolved += 1
    }
  }
  assert.ok(resolved / ini.tiles.length > 0.5, `命中率过低：${resolved}/${ini.tiles.length}`)
})

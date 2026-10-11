import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { crc32, findMixEntry, readMixEntry, readMixIndex } from '@ra2web/formats'
import { imageFileCandidates, openOverlays, openTheater } from '../src/index.js'

const NO_THEATER = { theaterExtension: false }

test('剧场后缀只在 Theater=yes 时使用', () => {
  assert.deepEqual(imageFileCandidates('SROCK01', { theaterExtension: true }, '.tem', 'T'), ['srock01.tem'])
  assert.deepEqual(imageFileCandidates('TREE01', NO_THEATER, '.tem', 'T'), ['tree01.shp'])
})

test('名字首字母 GNCY、次字母 ATUDLN 时换第 2 个字符，再试通用字母 g，再退回原名', () => {
  assert.deepEqual(imageFileCandidates('NAWALL', NO_THEATER, '.tem', 'T'), ['ntwall.shp', 'ngwall.shp', 'nawall.shp'])
  // 剧场字母与原名第 2 个字符相同时去重
  assert.deepEqual(imageFileCandidates('GASAND', NO_THEATER, '.tem', 'A'), ['gasand.shp', 'ggsand.shp'])
  // 首字母不在 GNCY 里，规则不适用
  assert.deepEqual(imageFileCandidates('TREE01', NO_THEATER, '.tem', 'T'), ['tree01.shp'])
  // 次字母不在 ATUDLN 里，规则不适用
  assert.deepEqual(imageFileCandidates('NAWALL'.replace('A', 'Z'), NO_THEATER, '.tem', 'T'), ['nzwall.shp'])
})

/** 原版美术：只有本机提供原版档案时才运行。 */
const mixPath = process.env.RA2_MIX
const skip = !mixPath || !fs.existsSync(mixPath) ? '未设置 RA2_MIX' : undefined

test('原版覆盖物能按 art.ini 的规则取到图形与帧', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))

  const temperate = openOverlays(archive, 'temperate')!
  // 102 = LOBRDG26：art.ini 里 Theater=yes → lobrdg26.tem（在 isotemp.mix 里）
  const bridge = temperate.loadOverlay({ id: 102, data: 6 })!
  assert.equal(bridge.name, 'LOBRDG26')
  assert.deepEqual([bridge.shp.width, bridge.shp.height], [180, 120])
  // 附加字节 6 对应的帧是空的，退回第一个非空帧
  assert.equal(bridge.frame.isEmpty, false)
  assert.deepEqual([bridge.frame.width, bridge.frame.height], [128, 77])

  // 171 = SROCK01：art.ini 里 Theater=yes → srock01.tem（在 temperat.mix 里）
  const rock = temperate.loadOverlay({ id: 171, data: 0 })!
  assert.equal(rock.name, 'SROCK01')
  assert.deepEqual([rock.shp.width, rock.shp.height], [120, 120])
  assert.deepEqual([rock.frame.width, rock.frame.height], [28, 27])

  // 编号未定义（rules.ini 的 [OverlayTypes] 从 1 起）、或美术不存在，都返回 undefined
  assert.equal(temperate.loadOverlay({ id: 0, data: 0 }), undefined)
  assert.equal(temperate.loadOverlay({ id: 241, data: 0 }), undefined, 'BRIDGEB1 在 art.ini 里没有条目')
})

test('名字替换：温带落到 NTWALL.shp，雪地落到 NAWALL.shp', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const root = readMixIndex(archive)
  const mixNames = (name: string, fileName: string): boolean => {
    const entry = findMixEntry(root, name, crc32)
    if (!entry) return false
    const bytes = readMixEntry(archive, root, entry)
    return Boolean(findMixEntry(readMixIndex(bytes), fileName, crc32))
  }
  // 温带的剧场字母是 T：NAWALL → NTWALL.shp；雪地剧场字母是 A：NAWALL 保持 NAWALL.shp
  assert.equal(mixNames('temperat.mix', 'NTWALL.shp'), true)
  assert.equal(mixNames('snow.mix', 'NAWALL.shp'), true)

  const temperate = openTheater(archive, 'temperate')!
  const snow = openTheater(archive, 'snow')!
  assert.ok(temperate.loadImage('NAWALL', NO_THEATER), '温带应当取到 NTWALL.shp')
  assert.ok(snow.loadImage('NAWALL', NO_THEATER), '雪地应当取到 NAWALL.shp')
  assert.equal(temperate.loadImage('NOSUCHNAME', NO_THEATER), undefined)
})

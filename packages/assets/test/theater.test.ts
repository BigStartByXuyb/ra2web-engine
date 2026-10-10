import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { crc32, findMixEntry, hashFileName, paletteColor, readMixEntry, readMixIndex } from '@ra2web/formats'
import { loadTerrainPalette, openTheater } from '../src/theater.js'

/** 拼一个明文头 MIX（无加密、无校验位），仅供测试使用。 */
function buildMix(entries: ReadonlyArray<{ name: string; data: Uint8Array }>): Uint8Array {
  const tableBytes = 6 + entries.length * 12
  const dataSize = entries.reduce((total, entry) => total + entry.data.length, 0)
  const bytes = new Uint8Array(tableBytes + dataSize)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, entries.length, true)
  view.setUint32(2, dataSize, true)
  let offset = 0
  entries.forEach((entry, index) => {
    const at = 6 + index * 12
    view.setUint32(at, hashFileName(entry.name, crc32), true)
    view.setUint32(at + 4, offset, true)
    view.setUint32(at + 8, entry.data.length, true)
    bytes.set(entry.data, tableBytes + offset)
    offset += entry.data.length
  })
  return bytes
}

function paletteBytes(entries: Readonly<Record<number, readonly [number, number, number]>>): Uint8Array {
  const bytes = new Uint8Array(768)
  for (const [index, color] of Object.entries(entries)) {
    const at = Number(index) * 3
    bytes[at] = color[0]
    bytes[at + 1] = color[1]
    bytes[at + 2] = color[2]
  }
  return bytes
}

const TEMPERATE_PALETTE = paletteBytes({ 0: [0, 0, 31], 119: [35, 36, 21], 255: [63, 63, 63] })
const SNOW_PALETTE = paletteBytes({ 21: [62, 63, 63] })

function archiveWith(palettes: ReadonlyArray<{ name: string; data: Uint8Array }>): Uint8Array {
  return buildMix([{ name: 'cache.mix', data: buildMix(palettes) }])
}

test('地形调色板按剧场名从 cache.mix 取，6 位分量左移 2 位', () => {
  const archive = archiveWith([
    { name: 'isotem.pal', data: TEMPERATE_PALETTE },
    { name: 'isosno.pal', data: SNOW_PALETTE },
  ])
  const temperate = loadTerrainPalette(archive, 'temperate')
  assert.deepEqual(paletteColor(temperate!, 119), { r: 140, g: 144, b: 84 })
  assert.deepEqual(paletteColor(temperate!, 0), { r: 0, g: 0, b: 124 })

  const snow = loadTerrainPalette(archive, 'snow')
  assert.deepEqual(paletteColor(snow!, 21), { r: 248, g: 252, b: 252 })
})

test('剧场名大小写与空白无关，未知剧场返回 undefined', () => {
  const archive = archiveWith([{ name: 'isotem.pal', data: TEMPERATE_PALETTE }])
  assert.ok(loadTerrainPalette(archive, ' Temperate '))
  assert.equal(loadTerrainPalette(archive, 'lunar'), undefined)
  assert.equal(loadTerrainPalette(archive, undefined), undefined)
  assert.equal(loadTerrainPalette(archiveWith([]), 'temperate'), undefined, '缺 isotem.pal 时不给别的调色板')
  assert.equal(loadTerrainPalette(buildMix([]), 'temperate'), undefined, '缺 cache.mix 时返回 undefined')
})

/** 原版：地形调色板在 RA2.MIX 的 cache.mix 里，按剧场名区分。 */
const mixPath = process.env.RA2_MIX
const skip = !mixPath || !fs.existsSync(mixPath) ? '未设置 RA2_MIX' : false

test('原版 cache.mix 的地形调色板与草地/雪地颜色一致', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const temperate = loadTerrainPalette(archive, 'temperate')
  const snow = loadTerrainPalette(archive, 'snow')
  assert.ok(temperate && snow)

  // 温带草地（实测色，(140,144,84) 与 (132,144,68) 都在原始截图的直方图里）
  assert.deepEqual(paletteColor(temperate, 119), { r: 140, g: 144, b: 84 })
  assert.deepEqual(paletteColor(temperate, 121), { r: 132, g: 144, b: 68 })
  // 雪地地形亮度高、几乎无色偏
  const snowGround = paletteColor(snow, 21)
  assert.ok(snowGround.r > 200 && snowGround.g > 200 && snowGround.b > 200, `雪地色异常：${JSON.stringify(snowGround)}`)
  // 两份调色板必须是不同文件，用错会把绿地画成棕褐色
  assert.notDeepEqual(paletteColor(temperate, 119), paletteColor(snow, 119))
})

test('原版剧场地块表能打开', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const theater = openTheater(archive, 'snow')
  assert.ok(theater)
  assert.equal(theater.ini.tiles.length, 798)
  assert.ok(theater.loadTile(0), '首块 Clear 应当有图形')
})

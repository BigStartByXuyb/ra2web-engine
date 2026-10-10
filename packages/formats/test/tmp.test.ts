import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { crc32 } from '../src/crc32.js'
import { findMixEntry, readMixEntry, readMixIndex } from '../src/mix.js'
import { readTmp, tmpTileRows } from '../src/tmp.js'

/**
 * 合成 TMP：2×1 格、每格 4×2 像素（缩小尺寸便于手写），两个子块。
 * 子块头 52 字节，像素数是格宽×格高的一半；第二个子块带 z 数据（flags bit1）。
 */
const CELL_WIDTH = 4
const CELL_HEIGHT = 2
const PIXEL_COUNT = (CELL_WIDTH * CELL_HEIGHT) / 2
const SUB_TILE_HEADER = 52

function buildSyntheticTmp(): Uint8Array {
  const cellsX = 2
  const cellsY = 1
  const sizes = [SUB_TILE_HEADER + PIXEL_COUNT, SUB_TILE_HEADER + PIXEL_COUNT * 2]
  const total = sizes[0]! + sizes[1]!
  const bytes = new Uint8Array(16 + cellsX * cellsY * 4 + total)
  const view = new DataView(bytes.buffer)
  view.setInt32(0, cellsX, true)
  view.setInt32(4, cellsY, true)
  view.setInt32(8, CELL_WIDTH, true)
  view.setInt32(12, CELL_HEIGHT, true)

  const starts: number[] = []
  let cursor = 16 + cellsX * cellsY * 4
  for (const size of sizes) {
    starts.push(cursor)
    cursor += size
  }
  starts.forEach((at, index) => view.setInt32(16 + index * 4, at, true))

  starts.forEach((at, index) => {
    view.setInt32(at, index * 2, true)
    view.setInt32(at + 4, index, true)
    view.setUint32(at + 8, sizes[index]!, true)
    view.setUint32(at + 12, SUB_TILE_HEADER + PIXEL_COUNT, true)
    view.setUint32(at + 36, index === 1 ? 0x2 : 0x0, true)
    for (let pixel = 0; pixel < PIXEL_COUNT; pixel++) bytes[at + SUB_TILE_HEADER + pixel] = index * 10 + pixel
  })
  return bytes
}

test('合成 TMP：头部、子块偏移与像素', () => {
  const tmp = readTmp(buildSyntheticTmp())
  assert.deepEqual([tmp.cellsX, tmp.cellsY, tmp.cellWidth, tmp.cellHeight], [2, 1, CELL_WIDTH, CELL_HEIGHT])
  assert.equal(tmp.subTiles.length, 2)

  const first = tmp.subTiles[0]!
  assert.deepEqual([first.pixelX, first.pixelY], [0, 0])
  assert.equal(first.size, SUB_TILE_HEADER + PIXEL_COUNT)
  assert.deepEqual([...first.pixels], [0, 1, 2, 3])

  const second = tmp.subTiles[1]!
  assert.deepEqual([second.pixelX, second.pixelY], [2, 1])
  assert.deepEqual([...second.pixels], [10, 11, 12, 13])
  assert.equal(second.isEmpty, false)
})

test('偏移为 0 的槽位表示"这一格没有图形"', () => {
  const bytes = buildSyntheticTmp()
  new DataView(bytes.buffer).setInt32(16 + 4, 0, true)
  const tmp = readTmp(bytes)
  assert.equal(tmp.subTiles[1]!.isEmpty, true)
  assert.equal(tmp.subTiles[1]!.pixels.length, 0)
  assert.equal(tmp.subTiles[0]!.isEmpty, false)
})

test('子块的 size 与像素区结束位置必须自洽', () => {
  const badSize = buildSyntheticTmp()
  new DataView(badSize.buffer).setUint32(16 + 8 + 8, 999, true)
  assert.throws(() => readTmp(badSize), /长度不合理/)

  const badEnd = buildSyntheticTmp()
  new DataView(badEnd.buffer).setUint32(16 + 8 + 12, 999, true)
  assert.throws(() => readTmp(badEnd), /像素区结束位置不合理/)
})

test('头部不合理时报错，不静默给空地块', () => {
  assert.throws(() => readTmp(new Uint8Array(16)), /头部不合理/)
  assert.throws(() => readTmp(new Uint8Array(8)), /truncated/i)
})

test('菱形行布局：行宽 4、8、…、满格宽，再对称收缩', () => {
  const rows = tmpTileRows(60, 30)
  assert.equal(rows.length, 30)
  assert.equal(
    rows.reduce((total, row) => total + row.width, 0),
    900,
    '像素数 = 格宽 × 格高 / 2',
  )
  assert.deepEqual(rows.slice(0, 3), [
    { y: 0, x: 28, width: 4 },
    { y: 1, x: 26, width: 8 },
    { y: 2, x: 24, width: 12 },
  ])
  assert.deepEqual(rows[14], { y: 14, x: 0, width: 60 })
  assert.deepEqual(rows[15], { y: 15, x: 2, width: 56 })
  assert.deepEqual(rows[27], { y: 27, x: 26, width: 8 })
  assert.deepEqual(rows[28], { y: 28, x: 28, width: 4 })
  assert.deepEqual(rows[29], { y: 29, x: 30, width: 0 })
})

/**
 * 原版地块的端到端核对：只有本机提供原版档案时才运行。
 * 设定 `RA2_MIX=<RA2.MIX 路径>` 启用，地块从同档案的 isotemp.mix 取。
 */
const mixPath = process.env.RA2_MIX
const skip = !mixPath || !fs.existsSync(mixPath) ? '未设置 RA2_MIX' : false

test('原版 isotemp.mix 的地块能被完整解出', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const root = readMixIndex(archive)
  const theaterBytes = readMixEntry(archive, root, findMixEntry(root, 'isotemp.mix', crc32)!)
  const theater = readMixIndex(theaterBytes)

  const sevenByFour = readTmp(readMixEntry(theaterBytes, theater, theater.entries[0]!))
  assert.deepEqual([sevenByFour.cellsX, sevenByFour.cellsY], [7, 4])
  assert.deepEqual([sevenByFour.cellWidth, sevenByFour.cellHeight], [60, 30])
  assert.equal(sevenByFour.subTiles.length, 28)

  // 子块按 iso 斜向排布：每步 (+30, +15) 像素 = 一格
  assert.deepEqual(
    sevenByFour.subTiles.slice(0, 3).map((sub) => [sub.pixelX, sub.pixelY]),
    [
      [0, 0],
      [30, 15],
      [60, 30],
    ],
  )
  // 像素 900 字节（菱形）+ z 数据 900 字节 + 头 52 字节
  const sizes = new Set(sevenByFour.subTiles.filter((sub) => !sub.isEmpty).map((sub) => sub.size))
  assert.deepEqual([...sizes], [1852])

  const single = readTmp(readMixEntry(theaterBytes, theater, theater.entries[1]!))
  assert.deepEqual([single.cellsX, single.cellsY], [1, 1])
  assert.equal(single.subTiles.length, 1)
  assert.equal(single.subTiles[0]!.pixels.length, 900)

  // 悬崖图块是多格的，允许空槽位（雪地档案里有 Cliff*.sno）
  const snowBytes = readMixEntry(archive, root, findMixEntry(root, 'isosnow.mix', crc32)!)
  const snow = readMixIndex(snowBytes)
  const cliffEntry = findMixEntry(snow, 'Cliff03.sno', crc32)
  assert.ok(cliffEntry, 'Cliff03.sno 应当存在')
  const cliff = readTmp(readMixEntry(snowBytes, snow, cliffEntry!))
  assert.deepEqual([cliff.cellsX, cliff.cellsY], [2, 3])
  assert.equal(cliff.subTiles.filter((sub) => sub.isEmpty).length, 2)
})

test('原版 isotemp.mix 全部地块都能解出（含带额外数据的）', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const root = readMixIndex(archive)
  const theaterBytes = readMixEntry(archive, root, findMixEntry(root, 'isotemp.mix', crc32)!)
  const theater = readMixIndex(theaterBytes)

  let tiles = 0
  let withExtraData = 0
  for (const entry of theater.entries) {
    let parsed
    try {
      parsed = readTmp(readMixEntry(theaterBytes, theater, entry))
    } catch {
      // 剧场档案里混着 SHP（签名 00 00 宽 高 帧数），不是地块，跳过
      continue
    }
    tiles += 1
    for (const sub of parsed.subTiles) {
      if (!sub.isEmpty && (sub.flags & 0x1) !== 0) withExtraData += 1
    }
  }
  assert.ok(tiles > 600, `解出的地块太少：${tiles}`)
  assert.ok(withExtraData > 0, '应当有带额外数据的地块，用于覆盖该分支')
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { crc32 } from '../src/crc32.js'
import { findMixEntry, readMixEntry, readMixIndex } from '../src/mix.js'
import { readTmp } from '../src/tmp.js'

/**
 * 合成 TMP：2×1 格、每格 4×2 像素（缩小尺寸便于手写），两个子块。
 * 子块头 16 字节 = pixelX, pixelY, size, reserved；像素 = cx×cy 字节；尾部 2 字节。
 */
function buildSyntheticTmp(): Uint8Array {
  const cellsX = 2
  const cellsY = 1
  const cellWidth = 4
  const cellHeight = 2
  const pixelsPerCell = cellWidth * cellHeight
  const trailing = 2
  const size = 16 + pixelsPerCell + trailing

  const bytes = new Uint8Array(16 + cellsX * cellsY * 4 + cellsX * cellsY * size)
  const view = new DataView(bytes.buffer)
  view.setInt32(0, cellsX, true)
  view.setInt32(4, cellsY, true)
  view.setInt32(8, cellWidth, true)
  view.setInt32(12, cellHeight, true)

  const subTiles: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [2, 1],
  ]
  subTiles.forEach(([pixelX, pixelY], index) => {
    const at = 16 + subTiles.length * 4 + index * size
    view.setInt32(16 + index * 4, at, true)
    view.setInt32(at, pixelX, true)
    view.setInt32(at + 4, pixelY, true)
    view.setUint32(at + 8, size, true)
    view.setUint32(at + 12, 952, true)
    for (let pixel = 0; pixel < pixelsPerCell; pixel++) {
      bytes[at + 16 + pixel] = index * 10 + pixel
    }
    bytes[at + 16 + pixelsPerCell] = 0xaa
    bytes[at + 16 + pixelsPerCell + 1] = 0xbb
  })
  return bytes
}

test('合成 TMP：头部、子块偏移与像素', () => {
  const tmp = readTmp(buildSyntheticTmp())
  assert.deepEqual([tmp.cellsX, tmp.cellsY, tmp.cellWidth, tmp.cellHeight], [2, 1, 4, 2])
  assert.equal(tmp.subTiles.length, 2)

  const first = tmp.subTiles[0]!
  assert.deepEqual([first.pixelX, first.pixelY, first.reserved], [0, 0, 952])
  assert.deepEqual([...first.pixels], [0, 1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual([...first.trailing], [0xaa, 0xbb])

  const second = tmp.subTiles[1]!
  assert.deepEqual([second.pixelX, second.pixelY], [2, 1])
  assert.equal(second.trailing.length, 2)
  assert.equal(second.isEmpty, false)
})

test('偏移为 0 的槽位表示"这一格没有图形"', () => {
  const bytes = buildSyntheticTmp()
  const view = new DataView(bytes.buffer)
  view.setInt32(16 + 1 * 4, 0, true) // 第二个子块改成空槽
  const tmp = readTmp(bytes)
  assert.equal(tmp.subTiles.length, 2)
  assert.equal(tmp.subTiles[1]!.isEmpty, true)
  assert.equal(tmp.subTiles[1]!.pixels.length, 0)
  assert.equal(tmp.subTiles[0]!.isEmpty, false)
})

test('头部不合理时报错，不静默给空地块', () => {
  assert.throws(() => readTmp(new Uint8Array(16)), /头部不合理/)
  assert.throws(() => readTmp(new Uint8Array(8)), /truncated/i)
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
  // 子块大小与偏移步长一致
  const sizes = new Set(sevenByFour.subTiles.map((sub) => sub.size))
  assert.deepEqual([...sizes], [1852])

  const single = readTmp(readMixEntry(theaterBytes, theater, theater.entries[1]!))
  assert.deepEqual([single.cellsX, single.cellsY], [1, 1])
  assert.equal(single.subTiles.length, 1)
  assert.equal(single.subTiles[0]!.pixels.length, 1800)

  // 悬崖图块是多格的，允许空槽位（雪地档案里有 Cliff*.sno）
  const snowBytes = readMixEntry(archive, root, findMixEntry(root, 'isosnow.mix', crc32)!)
  const snow = readMixIndex(snowBytes)
  const cliffEntry = findMixEntry(snow, 'Cliff03.sno', crc32)
  assert.ok(cliffEntry, 'Cliff03.sno 应当存在')
  const cliff = readTmp(readMixEntry(snowBytes, snow, cliffEntry!))
  assert.deepEqual([cliff.cellsX, cliff.cellsY], [2, 3])
  assert.equal(cliff.subTiles.filter((sub) => sub.isEmpty).length, 2)
})

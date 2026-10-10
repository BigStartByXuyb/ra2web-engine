import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { crc32 } from '../src/crc32.js'
import { findMixEntry, readMixEntry, readMixIndex } from '../src/mix.js'
import { readShp } from '../src/shp.js'

const HEADER_BYTES = 8
const FRAME_HEADER_BYTES = 24

interface SyntheticFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly compressionType: number
  readonly data: readonly number[]
}

/** 合成 SHP：三帧（原样、空帧、行程编码），帧表 24 字节/帧。 */
function buildSyntheticShp(frames: readonly SyntheticFrame[]): Uint8Array {
  const tableEnd = HEADER_BYTES + frames.length * FRAME_HEADER_BYTES
  const total = tableEnd + frames.reduce((sum, frame) => sum + frame.data.length, 0)
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0, true)
  view.setUint16(2, 4, true)
  view.setUint16(4, 2, true)
  view.setUint16(6, frames.length, true)

  let cursor = tableEnd
  frames.forEach((frame, index) => {
    const at = HEADER_BYTES + index * FRAME_HEADER_BYTES
    view.setInt16(at, frame.x, true)
    view.setInt16(at + 2, frame.y, true)
    view.setInt16(at + 4, frame.width, true)
    view.setInt16(at + 6, frame.height, true)
    bytes[at + 8] = frame.compressionType
    view.setInt32(at + 20, frame.data.length === 0 ? 0 : cursor, true)
    bytes.set(frame.data, cursor)
    cursor += frame.data.length
  })
  return bytes
}

test('合成 SHP：原样帧、空帧、行程编码帧', () => {
  const shp = readShp(
    buildSyntheticShp([
      { x: 0, y: 0, width: 4, height: 2, compressionType: 0, data: [1, 2, 3, 4, 5, 6, 7, 8] },
      { x: 0, y: 0, width: 0, height: 0, compressionType: 3, data: [] },
      // 第 0 行：两个像素 + 2 个零；第 1 行：2 个零 + 一个像素 + 1 个零
      {
        x: 1,
        y: 1,
        width: 4,
        height: 2,
        compressionType: 3,
        data: [6, 0, 0x0a, 0x0b, 0x00, 0x02, 7, 0, 0x00, 0x02, 0x0c, 0x00, 0x01],
      },
    ]),
  )
  assert.deepEqual([shp.width, shp.height], [4, 2])
  assert.equal(shp.frames.length, 3)

  assert.deepEqual([...shp.frames[0]!.pixels], [1, 2, 3, 4, 5, 6, 7, 8])
  assert.equal(shp.frames[0]!.isEmpty, false)

  assert.equal(shp.frames[1]!.isEmpty, true)
  assert.equal(shp.frames[1]!.pixels.length, 0)

  const rle = shp.frames[2]!
  assert.deepEqual([rle.x, rle.y], [1, 1])
  assert.deepEqual([...rle.pixels], [0x0a, 0x0b, 0, 0, 0, 0, 0x0c, 0])
})

test('签名不是 0 时报错', () => {
  const bytes = buildSyntheticShp([
    { x: 0, y: 0, width: 4, height: 2, compressionType: 0, data: [1, 2, 3, 4, 5, 6, 7, 8] },
  ])
  new DataView(bytes.buffer).setUint16(0, 9, true)
  assert.throws(() => readShp(bytes), /不是 SHP/)
})

/** 原版图形：只有本机提供原版档案时才运行。 */
const mixPath = process.env.RA2_MIX
const skip = !mixPath || !fs.existsSync(mixPath) ? '未设置 RA2_MIX' : undefined

test('原版 isotemp.mix / temperat.mix 的 SHP 能解出', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const root = readMixIndex(archive)

  const temperatEntry = findMixEntry(root, 'temperat.mix', crc32)!
  const temperatBytes = readMixEntry(archive, root, temperatEntry)
  const temperat = readMixIndex(temperatBytes)

  // 石头：120×120 画布、2 帧，本体 28×27 落在 (48,41)
  const rock = readShp(readMixEntry(temperatBytes, temperat, findMixEntry(temperat, 'SROCK01.tem', crc32)!))
  assert.deepEqual([rock.width, rock.height], [120, 120])
  assert.equal(rock.frames.length, 2)
  assert.deepEqual(
    [
      rock.frames[0]!.x,
      rock.frames[0]!.y,
      rock.frames[0]!.width,
      rock.frames[0]!.height,
      rock.frames[0]!.compressionType,
    ],
    [48, 41, 28, 27, 3],
  )
  assert.equal(
    rock.frames[0]!.pixels.reduce((count, value) => count + (value === 0 ? 0 : 1), 0),
    543,
  )

  // 低桥板：6 帧里只有第 1 帧有图形，其余是空帧
  const isotempBytes = readMixEntry(archive, root, findMixEntry(root, 'isotemp.mix', crc32)!)
  const isotemp = readMixIndex(isotempBytes)
  const bridge = readShp(readMixEntry(isotempBytes, isotemp, findMixEntry(isotemp, 'LOBRDG26.tem', crc32)!))
  assert.equal(bridge.frames.length, 6)
  assert.deepEqual(
    bridge.frames.map((frame) => frame.isEmpty),
    [true, false, true, true, true, true],
  )
  assert.deepEqual([bridge.frames[1]!.width, bridge.frames[1]!.height], [128, 77])
})

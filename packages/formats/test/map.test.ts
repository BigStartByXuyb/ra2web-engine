import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { readMixEntry, readMixIndex } from '../src/mix.js'
import { MAP_RECORD_BYTES, readMap } from '../src/map.js'

/**
 * 合成地图：3×2 → 记录数 (2×3−1)×2 = 10 条、原始 110 字节。
 * 记录整体当成纯字面量流压缩（token + 字节 + 结束标记），测试因此不依赖原版素材。
 */
function buildSyntheticMap(): Uint8Array {
  const cells: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ]
  const records: number[] = []
  for (let index = 0; index < 10; index++) {
    const [cellX, cellY] = cells[index % cells.length]!
    const diamondX = cellX + cellY + 1
    const diamondY = cellY - cellX + 3
    records.push(
      diamondX & 0xff,
      diamondX >> 8,
      diamondY & 0xff,
      diamondY >> 8,
      (100 + index) & 0xff,
      (100 + index) >> 8,
      0,
      0,
      index % 4,
      index,
      0,
    )
  }
  assert.equal(records.length, 10 * MAP_RECORD_BYTES)

  const stream = Uint8Array.from([17 + records.length, ...records, 0x11, 0x00, 0x00])
  const block = new Uint8Array(4 + stream.length)
  const view = new DataView(block.buffer)
  view.setUint16(0, stream.length, true)
  view.setUint16(2, records.length, true)
  block.set(stream, 4)

  return new Uint8Array(
    Buffer.from(
      [
        '[Map]',
        'Size=0,0,3,2',
        'LocalSize=0,0,3,2',
        'Theater=TEMPERATE',
        '',
        '[IsoMapPack5]',
        `1=${Buffer.from(block).toString('base64')}`,
        '',
      ].join('\r\n'),
      'latin1',
    ),
  )
}

test('合成地图：尺寸、剧场、记录与方格坐标', () => {
  const map = readMap(buildSyntheticMap())
  assert.deepEqual(map.bounds, { left: 0, top: 0, right: 3, bottom: 2 })
  assert.deepEqual([map.width, map.height], [3, 2])
  assert.equal(map.theater, 'TEMPERATE')
  assert.equal(map.cells.length, (2 * 3 - 1) * 2)

  const first = map.cells[0]!
  assert.deepEqual([first.cellX, first.cellY], [0, 0])
  assert.equal(first.tileIndex, 100)
  assert.equal(first.subTile, 0)
  assert.equal(first.z, 0)
})

test('缺少 [IsoMapPack5] 时报错，而不是静默给一张空地图', () => {
  const text = new Uint8Array(Buffer.from('[Map]\r\nSize=0,0,3,2\r\n', 'latin1'))
  assert.throws(() => readMap(text), /IsoMapPack5/)
})

/**
 * 合成覆盖物：`[OverlayPack]` 只填"要出现的那一格"，其余用填充命令盖成 255（即没有覆盖物）。
 *
 * Format80 流：`0xFE + u16 份数 + 字节` 是填充，`0x80|份数 + 字节们` 是字面量，`0x80` 收尾。
 * 网格下标 = 菱形横坐标 + 512 × 菱形纵坐标，因此 3×2 地图里最大下标是 2050。
 */
function buildFormat80OverlayPack(targetIndex: number, value: number, gridBytes: number): string {
  const stream: number[] = []
  if (targetIndex > 0) stream.push(0xfe, targetIndex & 0xff, targetIndex >> 8, 0xff)
  stream.push(0x81, value)
  const rest = gridBytes - targetIndex - 1
  if (rest > 0) stream.push(0xfe, rest & 0xff, rest >> 8, 0xff)
  stream.push(0x80)

  const block = new Uint8Array(4 + stream.length)
  const view = new DataView(block.buffer)
  view.setUint16(0, stream.length, true)
  view.setUint16(2, gridBytes, true)
  block.set(Uint8Array.from(stream), 4)
  return Buffer.from(block).toString('base64')
}

test('合成地图：覆盖物按菱形坐标落格', () => {
  const gridBytes = 2051
  const base = Buffer.from(buildSyntheticMap()).toString('latin1')
  const text = new Uint8Array(
    Buffer.from(
      [
        base,
        '[OverlayPack]',
        `1=${buildFormat80OverlayPack(1537, 42, gridBytes)}`,
        '',
        '[OverlayDataPack]',
        `1=${buildFormat80OverlayPack(1537, 7, gridBytes)}`,
        '',
      ].join('\r\n'),
      'latin1',
    ),
  )
  const map = readMap(text)
  // 下标 1537 = 菱形坐标 (1,3) = 方格 (0,0)
  assert.deepEqual(map.cells[0]!.overlay, { id: 42, data: 7 })
  assert.equal(map.cells[0]!.cellX, 0)
  assert.equal(map.cells[0]!.cellY, 0)
  assert.equal(map.cells[1]!.overlay, undefined)
})

test('没有覆盖物段时不报错，覆盖物全部为空', () => {
  const map = readMap(buildSyntheticMap())
  assert.equal(
    map.cells.some((cell) => cell.overlay !== undefined),
    false,
  )
})

/**
 * 原版地图的端到端核对：只有本机提供原版档案时才运行。
 * 设定 `RA2_MIX=<RA2.MIX 路径>` 启用，地图从同目录的 Maps01.mix 取。
 */
const mixPath = process.env.RA2_MIX
const mapsPath = mixPath ? path.join(path.dirname(mixPath), 'Maps01.mix') : undefined
const skip = !mapsPath || !fs.existsSync(mapsPath) ? '未提供 RA2_MIX（或同目录没有 Maps01.mix）' : false

test('原版 Maps01.mix 的地形包能被完整解出', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mapsPath!))
  const index = readMixIndex(archive)
  const map = readMap(readMixEntry(archive, index, index.entries[0]!))

  assert.deepEqual([map.width, map.height], [70, 96])
  assert.equal(map.theater, 'SNOW')
  assert.equal(map.cells.length, (2 * map.width - 1) * map.height)

  // 记录数 = 菱形格数 (2×宽−1)×高，其中正好"每格一条"落在方格范围内，
  // 其余是同格的另一半菱形位置 —— 这条恒等式同时验证了坐标换算。
  const inRange = map.cells.filter(
    (cell) => cell.cellX >= 0 && cell.cellY >= 0 && cell.cellX < map.width && cell.cellY < map.height,
  )
  assert.equal(inRange.length, map.width * map.height, '每格应当正好一条记录')
  assert.equal(
    new Set(inRange.map((cell) => `${cell.cellX},${cell.cellY}`)).size,
    map.width * map.height,
    '方格不应重复',
  )
  assert.ok(Math.max(...map.cells.map((cell) => cell.tileIndex)) < 4096, 'tile 索引应在合理范围内')
})

test('原版 Maps01.mix 的覆盖物能被解出并落到格上', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mapsPath!))
  const index = readMixIndex(archive)
  const map = readMap(readMixEntry(archive, index, index.entries[0]!))

  const inRange = map.cells.filter(
    (cell) =>
      cell.overlay !== undefined &&
      cell.cellX >= 0 &&
      cell.cellY >= 0 &&
      cell.cellX < map.width &&
      cell.cellY < map.height,
  )
  assert.equal(inRange.length, 122)
  const ids = new Set(inRange.map((cell) => cell.overlay!.id))
  for (const id of [102, 240, 241, 171]) assert.ok(ids.has(id), `应当有覆盖物编号 ${id}`)
})

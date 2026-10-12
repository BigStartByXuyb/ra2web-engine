import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { readMixEntry, readMixIndex } from '../src/mix.js'
import { MAP_RECORD_BYTES, TILE_NONE, readMap } from '../src/map.js'

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
    // 记录里的 X、Y 就是格坐标 + 1（原版口径：格下标 = Y × 512 + X）
    const diamondX = cellX + 1
    const diamondY = cellY + 1
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

  return new Uint8Array(
    Buffer.from(
      [
        '[Map]',
        'Size=0,0,3,2',
        'LocalSize=0,0,3,2',
        'Theater=TEMPERATE',
        '',
        '[IsoMapPack5]',
        `1=${packedBlock(Uint8Array.from(records))}`,
        '',
      ].join('\r\n'),
      'latin1',
    ),
  )
}

/** 把一个字节序列包成"单个 LZO 块"并转成 base64：首字节是字面量游程，末尾是结束标记。 */
function packedBlock(payload: Uint8Array): string {
  const stream = Uint8Array.from([17 + payload.length, ...payload, 0x11, 0x00, 0x00])
  const block = new Uint8Array(4 + stream.length)
  const view = new DataView(block.buffer)
  view.setUint16(0, stream.length, true)
  view.setUint16(2, payload.length, true)
  block.set(stream, 4)
  return Buffer.from(block).toString('base64')
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

test('合成地图：覆盖物按方格坐标落格', () => {
  const gridBytes = 2051
  const base = Buffer.from(buildSyntheticMap()).toString('latin1')
  const text = new Uint8Array(
    Buffer.from(
      [
        base,
        '[OverlayPack]',
        `1=${buildFormat80OverlayPack(0, 42, gridBytes)}`,
        '',
        '[OverlayDataPack]',
        `1=${buildFormat80OverlayPack(0, 7, gridBytes)}`,
        '',
      ].join('\r\n'),
      'latin1',
    ),
  )
  const map = readMap(text)
  // 下标 = x + 512 × y，方格 (0,0) 就是 0（原版 GAME.EXE 的 FUN_005db670 按这个下标读）
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
  assert.equal(map.preview, undefined, '没有 [Preview] 段时没有预览图')
  assert.deepEqual(map.placements, [], '没有放置段时没有对象')
})

test('合成地图：建筑与单位坐标就是格坐标', () => {
  const text = new Uint8Array(
    Buffer.from(
      [
        Buffer.from(buildSyntheticMap()).toString('latin1'),
        '[Structures]',
        '1024=Neutral,CABHUT,256,20,30,0,None,0,0,1,0,0,None,None,None,0,0',
        '',
        '[Units]',
        '1025=BadGuy1,HTNK,256,7,9,64,None,0,0,1',
        '',
        '[Terrain]',
        '1026=10,07ED09FC',
        '',
      ].join('\r\n'),
      'latin1',
    ),
  )
  const map = readMap(text)
  assert.equal(map.placements.length, 2, '[Terrain] 的键是坐标，不按放置段解析')
  assert.deepEqual(map.placements[0], {
    kind: 'structure',
    owner: 'Neutral',
    type: 'CABHUT',
    health: 256,
    cellX: 20,
    cellY: 30,
    facing: 0,
  })
  assert.deepEqual(map.placements[1], {
    kind: 'unit',
    owner: 'BadGuy1',
    type: 'HTNK',
    health: 256,
    cellX: 7,
    cellY: 9,
    facing: 64,
  })
})

test('合成地图：官方预览图按 24 位 RGB 解出', () => {
  const rgb = Uint8Array.from([10, 20, 30, 40, 50, 60])
  const text = new Uint8Array(
    Buffer.from(
      [
        Buffer.from(buildSyntheticMap()).toString('latin1'),
        '[Preview]',
        'Size=0,0,2,1',
        '',
        '[PreviewPack]',
        `1=${packedBlock(rgb)}`,
        '',
      ].join('\r\n'),
      'latin1',
    ),
  )
  const map = readMap(text)
  assert.deepEqual(map.preview, { width: 2, height: 1, rgb })
})

test('预览图长度对不上时按"没有预览图"处理，不挡住地图本身', () => {
  const text = new Uint8Array(
    Buffer.from(
      [
        Buffer.from(buildSyntheticMap()).toString('latin1'),
        '[Preview]',
        'Size=0,0,9,9',
        '',
        '[PreviewPack]',
        `1=${packedBlock(Uint8Array.from([1, 2, 3]))}`,
        '',
      ].join('\r\n'),
      'latin1',
    ),
  )
  const map = readMap(text)
  assert.equal(map.preview, undefined)
  assert.equal(map.cells.length, 10, '地图本身照常解出')
})

/**
 * 原版地图的端到端核对：只有本机提供原版档案时才运行。
 * 设定 `RA2_MIX=<RA2.MIX 路径>` 启用，地图从同目录的 Maps01.mix 取。
 */
const mixPath = process.env.RA2_MIX
const mapsPath = mixPath ? path.join(path.dirname(mixPath), 'Maps01.mix') : undefined
const multiPath = mixPath ? path.join(path.dirname(mixPath), 'MULTI.MIX') : undefined
const skip = !mapsPath || !fs.existsSync(mapsPath) ? '未提供 RA2_MIX（或同目录没有 Maps01.mix）' : false

test('原版 Maps01.mix 的地形包能被完整解出', { skip }, () => {
  const archive = new Uint8Array(fs.readFileSync(mapsPath!))
  const index = readMixIndex(archive)
  const map = readMap(readMixEntry(archive, index, index.entries[0]!))

  assert.deepEqual([map.width, map.height], [70, 96])
  assert.equal(map.theater, 'SNOW')
  assert.equal(map.cells.length, (2 * map.width - 1) * map.height)

  // 格 = 记录里的 (X, Y) − 1，格空间是 `cellBounds` 那个斜置区域（原版按 `下标 = Y×512 + X` 取格，
  // 见 `readCells` 的判定依据）：坐标必须唯一、非负、落在格空间里。
  assert.equal(
    new Set(map.cells.map((cell) => `${cell.cellX},${cell.cellY}`)).size,
    map.cells.length,
    '同一格不应出现两条记录',
  )
  for (const cell of map.cells) {
    assert.ok(cell.cellX >= 0 && cell.cellY >= 0, '格坐标应当从 0 起')
    assert.ok(
      cell.cellX < map.cellBounds.right && cell.cellY < map.cellBounds.bottom,
      `格坐标 (${cell.cellX},${cell.cellY}) 超出格空间 ${JSON.stringify(map.cellBounds)}`,
    )
  }
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
  assert.equal(inRange.length, 101)
  const ids = new Set(inRange.map((cell) => cell.overlay!.id))
  for (const id of [102, 240, 241, 171]) assert.ok(ids.has(id), `应当有覆盖物编号 ${id}`)
})

test('原版 MULTI.MIX 的官方预览图能解出', { skip: multiPath ? false : '同目录没有 MULTI.MIX' }, () => {
  const archive = new Uint8Array(fs.readFileSync(multiPath!))
  const index = readMixIndex(archive)
  const map = readMap(readMixEntry(archive, index, index.entries[7]!))
  assert.equal(map.theater, 'TEMPERATE')
  assert.deepEqual([map.preview?.width, map.preview?.height], [102, 52])
  assert.deepEqual([...map.preview!.rgb.subarray(0, 3)], [176, 184, 80], '首像素是草地绿')
})

test('原版地图的建筑站在真有地块的格上（坐标就是格坐标）', { skip: multiPath ? false : '同目录没有 MULTI.MIX' }, () => {
  const archive = new Uint8Array(fs.readFileSync(multiPath!))
  const index = readMixIndex(archive)
  const map = readMap(readMixEntry(archive, index, index.entries[7]!))
  const structures = map.placements.filter((placement) => placement.kind === 'structure')
  assert.equal(structures.length, 38)

  // 判据：民用建筑必须站在**真有地块**的格上（原版对落在空格 `TILE_NONE` 或格空间之外的对象就是忽略）。
  // 旧口径"坐标除以 2"只有少数命中，建筑会整体偏出地形、画面上表现为"飘在地图外面"。
  const tileByCell = new Map<string, number>()
  for (const cell of map.cells) tileByCell.set(`${cell.cellX},${cell.cellY}`, cell.tileIndex)
  const onTerrain = structures.filter((structure) => {
    const tile = tileByCell.get(`${structure.cellX},${structure.cellY}`)
    return tile !== undefined && tile !== TILE_NONE
  })
  assert.ok(
    onTerrain.length >= Math.ceil(structures.length * 0.7),
    `站在真有地块上的建筑只有 ${onTerrain.length}/${structures.length}`,
  )
  // 文件里第一栋是 `CABHUT,256,31,53` → 原值就是格坐标 → (31, 53)
  assert.deepEqual([structures[0]!.type, structures[0]!.cellX, structures[0]!.cellY], ['CABHUT', 31, 53])
  assert.ok(new Set(structures.map((structure) => structure.type)).size > 1)
})

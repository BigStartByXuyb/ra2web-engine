import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { readMap, readMixEntry, readMixIndex, type MapCell } from '@ra2web/formats'
import { loadRules, readLandRules, speedFactor } from '@ra2web/rules'
import { buildPassability, heightBlocksStep, landTypeOfTerrainType, KNOWN_TERRAIN_TYPES } from '../src/index.js'
import { readLocalText } from '../src/local-ini.js'
import { openTheater } from '../src/theater.js'

test('TMP terrainType → 地块类型：只认映射表里的 12 个值', () => {
  assert.deepEqual(KNOWN_TERRAIN_TYPES, [0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  assert.equal(landTypeOfTerrainType(13), 'Clear')
  assert.equal(landTypeOfTerrainType(0), 'Clear')
  assert.equal(landTypeOfTerrainType(9), 'Water')
  assert.equal(landTypeOfTerrainType(10), 'Beach')
  assert.equal(landTypeOfTerrainType(11), 'Road')
  assert.equal(landTypeOfTerrainType(12), 'Road')
  assert.equal(landTypeOfTerrainType(14), 'Rough')
  assert.equal(landTypeOfTerrainType(15), 'Cliff')
  assert.equal(landTypeOfTerrainType(6), 'Railroad')
  assert.equal(landTypeOfTerrainType(7), 'Rock')
  assert.equal(landTypeOfTerrainType(8), 'Rock')
  assert.equal(landTypeOfTerrainType(5), 'Cliff')
  // 1..4 是枚举里没有名字的槽位，映射表里也没有 —— 不猜
  for (const unknown of [1, 2, 3, 4, 16, 255]) assert.equal(landTypeOfTerrainType(unknown), undefined)
})

test('相邻格高度差小于 2 才能迈过去', () => {
  assert.equal(heightBlocksStep(3, 3), false)
  assert.equal(heightBlocksStep(3, 4), false)
  assert.equal(heightBlocksStep(4, 3), false)
  assert.equal(heightBlocksStep(4, 6), true)
  // z 是字节：越界回绕到 0 与"高度差为 0"不是一回事
  assert.equal(heightBlocksStep(254, 1), true)
})

/** 本机原版档案：映射表判定的地形类型必须与地块集的分类自洽。 */
const mixPath = process.env.RA2_MIX
const skip = !mixPath || !fs.existsSync(mixPath) ? '未设置 RA2_MIX' : false
const mapArchivePath = process.env.RA2_MAP_ARCHIVE
const skipMap = skip || !mapArchivePath || !fs.existsSync(mapArchivePath) ? '未设置 RA2_MIX / RA2_MAP_ARCHIVE' : false

test('原版雪地地图：水与悬崖不可通行，草地/道路可通行', { skip: skipMap }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const mapArchive = new Uint8Array(fs.readFileSync(mapArchivePath!))
  const index = readMixIndex(mapArchive)
  const map = readMap(readMixEntry(mapArchive, index, index.entries[0]!))
  const theater = openTheater(archive, map.theater!)
  const rulesText = readLocalText(archive, 'rules.ini')!
  const land = readLandRules(loadRules([{ name: 'rules.ini', text: rulesText }]))
  const track = (name: Parameters<typeof speedFactor>[1]) => speedFactor(land, name, 'Track')

  // rules.ini 的系数表：[Water] Track=0%、[Rock] Track=0%、[Clear] Track=100%
  assert.equal(track('Water'), 0)
  assert.equal(track('Rock'), 0)
  assert.equal(track('Clear'), 1)
  // 悬崖没有自己的段，按 [Rock] 判
  assert.equal(track('Cliff'), 0)
  assert.equal(land.get('Cliff')!.name, 'Cliff')

  const passability = buildPassability(map, theater, {
    speedType: 'Track',
    speedFactor: (landType) => track(landType),
  })
  assert.deepEqual(passability.unknownTerrainTypes, [], '原版地图的地形类型应当全部在映射表里')

  // 逐格核对：被判不可通行的格子，其地块类型必须确实是 0 系数
  const blockedIndices = new Set(passability.blocked.map((cell) => cell.y * map.width + cell.x))
  let checkedBlocked = 0
  let checkedPassable = 0
  for (const cell of map.cells) {
    if (cell.cellX < 0 || cell.cellY < 0 || cell.cellX >= map.width || cell.cellY >= map.height) continue
    const landType = landTypeAt(theater, cell)!
    const blocked = blockedIndices.has(cell.cellY * map.width + cell.cellX)
    if (blocked) {
      assert.equal(track(landType), 0, `(${cell.cellX},${cell.cellY}) 判不可通行但地块类型是 ${landType}`)
      checkedBlocked++
    } else {
      assert.ok(track(landType) > 0, `(${cell.cellX},${cell.cellY}) 判可通行但地块类型是 ${landType}`)
      checkedPassable++
    }
  }
  const summary = [...passability.landTypeCounts]
    .sort((left, right) => right[1] - left[1])
    .map(([name, count]) => `${name}=${count}`)
    .join(' ')
  assert.ok(checkedPassable > 1000, `可通行格太少：${checkedPassable}（${summary}）`)
  assert.equal(checkedBlocked, passability.blocked.length, '每个不可通行格都要能追到 0 系数')
  // 不可通行格数 = 所有 0 系数地块类型（水/岩石/悬崖）的格数之和
  const impassableByLandType = [...passability.landTypeCounts]
    .filter(([name]) => track(name) === 0)
    .reduce((sum, [, count]) => sum + count, 0)
  assert.equal(passability.blocked.length, impassableByLandType, `不可通行格数与地块类型不符（${summary}）`)
  assert.ok((passability.landTypeCounts.get('Cliff') ?? 0) > 0, `这张图应当有悬崖（${summary}）`)
  // 这张城市图没有水域：草地、道路、崎岖地形都可通行，只有 373 格悬崖挡路
  assert.equal(passability.landTypeCounts.get('Water'), undefined)
})

function landTypeAt(theater: ReturnType<typeof openTheater>, cell: MapCell) {
  const subTile = theater?.loadTile(cell.tileIndex)?.subTiles[cell.subTile]
  return subTile ? landTypeOfTerrainType(subTile.terrainType) : undefined
}

test('带水域的地图：水域按 [Water] 判为不可通行，海滩可通行', { skip: skipMap }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const mapArchive = new Uint8Array(fs.readFileSync(mapArchivePath!))
  const index = readMixIndex(mapArchive)
  const rulesText = readLocalText(archive, 'rules.ini')!
  const land = readLandRules(loadRules([{ name: 'rules.ini', text: rulesText }]))
  const track = (name: Parameters<typeof speedFactor>[1]) => speedFactor(land, name, 'Track')

  let found: { water: number; beach: number; blockedWater: number } | undefined
  for (const entry of index.entries) {
    let map
    try {
      map = readMap(readMixEntry(mapArchive, index, entry))
    } catch {
      continue
    }
    const theater = openTheater(archive, map.theater ?? 'temperate')
    if (!theater) continue
    const passability = buildPassability(map, theater, {
      speedType: 'Track',
      speedFactor: (landType) => track(landType),
    })
    const water = passability.landTypeCounts.get('Water') ?? 0
    if (water === 0) continue
    const blockedIndices = new Set(passability.blocked.map((cell) => cell.y * map.width + cell.x))
    let blockedWater = 0
    for (const cell of map.cells) {
      if (cell.cellX < 0 || cell.cellY < 0 || cell.cellX >= map.width || cell.cellY >= map.height) continue
      if (landTypeAt(theater, cell) !== 'Water') continue
      if (blockedIndices.has(cell.cellY * map.width + cell.cellX)) blockedWater++
    }
    found = { water, beach: passability.landTypeCounts.get('Beach') ?? 0, blockedWater }
    break
  }
  assert.ok(found, '档案里应当至少有一张带水域的地图')
  assert.equal(found!.blockedWater, found!.water, '水域的每一格都要判为不可通行')
  assert.equal(track('Beach'), 0, '海滩对履带也是 0%')
})

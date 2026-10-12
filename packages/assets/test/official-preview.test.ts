import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { readMap, readMixEntry, readMixIndex } from '@ra2web/formats'
import { openTheater } from '../src/index.js'

/**
 * 官方预览图的投影：按**菱形坐标一像素一格**（横 = X − Y + 宽 − 1，再 +1 的实测偏移；纵 = (X + Y − 宽 − 1) / 2）。
 *
 * 判据用"水面"这种大块特征：地图里按地块集判定的水面格，应当与预览图上同坐标的蓝像素吻合。
 * 实测（`MULTI.MIX` 第 5 张，84×92、11.2% 是水）一致率 98.8%；换成等距/斜切等投影只有 4%~14% ——
 * 这一条把"预览与战场形状不同"钉死成投影差异，而不是我们读错了地块。
 *
 * 注意预览图与地形记录是**两套空间**：记录里的 (X, Y) 是引擎格坐标，预览图用的是菱形序号。
 */
const mixPath = process.env.RA2_MIX
const multiPath = mixPath ? path.join(path.dirname(mixPath), 'MULTI.MIX') : undefined
const skip = !multiPath || !fs.existsSync(multiPath!) ? '同目录没有 MULTI.MIX' : false

interface WaterAgreement {
  readonly theater: string
  readonly agree: number
  readonly compared: number
  readonly waterCells: number
}

/**
 * 把"地图里的水面格"与"预览图上的蓝像素"按坐标对一遍；回归用例与三剧场代表图共用这一份比对。
 *
 * `offsetX/offsetY` 是预览图下标相对规则式的偏移（规则式本身是 `X − Y + 宽 − 1`、`(X + Y − 宽 − 1) / 2`）。
 * 一致率的**区分度很大而不是很细**：用对了坐标空间是 93%~98%（雪地的冰面、城市的水岸会跟
 * "段名含 water"这套粗糙分类打架），换错投影只剩 4%~14%。所以判据取 90% 下限，不看那 1% 的偏移平台。
 */
function waterAgreement(
  archives: Uint8Array,
  maps: Uint8Array,
  entryIndex: number,
  offsetX = 1,
  offsetY = 0,
): WaterAgreement {
  const mapIndex = readMixIndex(maps)
  const map = readMap(readMixEntry(maps, mapIndex, mapIndex.entries[entryIndex]!))
  const preview = map.preview
  assert.ok(preview, `第 ${entryIndex} 张应当自带预览图`)
  const theater = openTheater(archives, map.theater ?? 'temperate')
  assert.ok(theater, `第 ${entryIndex} 张的剧场 ${map.theater} 应当装得上`)

  const waterSets = new Set(theater.ini.sets.filter((set) => /water/i.test(set.name)).map((set) => set.index))
  const tileIsWater = new Uint8Array(theater.ini.tiles.length)
  let at = 0
  for (const set of theater.ini.sets) {
    for (let offset = 0; offset < set.tilesInSet; offset++) tileIsWater[at + offset] = waterSets.has(set.index) ? 1 : 0
    at += set.tilesInSet
  }
  const isPreviewWater = (x: number, y: number): boolean | undefined => {
    if (x < 0 || y < 0 || x >= preview.width || y >= preview.height) return undefined
    const from = (y * preview.width + x) * 3
    return preview.rgb[from + 2]! > preview.rgb[from]! + 16 && preview.rgb[from + 2]! >= preview.rgb[from + 1]! + 8
  }

  let agree = 0
  let compared = 0
  let waterCells = 0
  for (const cell of map.cells) {
    const previewX = cell.diamondX - cell.diamondY + map.width - 1 + offsetX
    const previewY = (cell.diamondX + cell.diamondY - map.width - 1) / 2 + offsetY
    if (!Number.isInteger(previewY)) continue
    const ours = tileIsWater[cell.tileIndex] === 1
    if (ours) waterCells += 1
    const theirs = isPreviewWater(previewX, previewY)
    if (theirs === undefined) continue
    compared += 1
    if (ours === theirs) agree += 1
  }
  return { theater: map.theater ?? '?', agree, compared, waterCells }
}

test('原版预览图按菱形坐标一像素一格：水面按坐标吻合', { skip }, () => {
  const archives = new Uint8Array(fs.readFileSync(mixPath!))
  const maps = new Uint8Array(fs.readFileSync(multiPath!))
  const result = waterAgreement(archives, maps, 5)
  assert.ok(result.waterCells > 200, `水面格太少：${result.waterCells}`)
  assert.ok(
    result.agree / result.compared > 0.95,
    `水面一致率只有 ${((result.agree / result.compared) * 100).toFixed(1)}%，说明预览的坐标口径变了`,
  )
})

test('三个剧场的代表图都按同一口径吻合（雪地 57 / 城市 9 / 温带 12）', { skip }, () => {
  const archives = new Uint8Array(fs.readFileSync(mixPath!))
  const maps = new Uint8Array(fs.readFileSync(multiPath!))
  const seen = new Set<string>()
  for (const entryIndex of [57, 9, 12]) {
    const result = waterAgreement(archives, maps, entryIndex)
    const rate = result.agree / result.compared
    seen.add(result.theater.toUpperCase())
    assert.ok(result.compared > 0, `第 ${entryIndex} 张没有可比对的格`)
    assert.ok(result.waterCells > 30, `第 ${entryIndex} 张（${result.theater}）水面格太少：${result.waterCells}`)
    assert.ok(
      rate > 0.9,
      `第 ${entryIndex} 张（${result.theater}）水面一致率只有 ${(rate * 100).toFixed(1)}%（下限 90%；投影猜错时只剩 4%~14%）`,
    )
  }
  assert.equal(seen.size, 3, `三个代表图应当覆盖三个不同剧场，实际只有 ${[...seen].join('、')}`)
})

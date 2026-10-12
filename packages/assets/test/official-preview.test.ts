import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { readMap, readMixEntry, readMixIndex } from '@ra2web/formats'
import { openTheater } from '../src/index.js'

/**
 * 官方预览图的投影：**方格俯视，一格一像素**（不是战场的等距斜视角）。
 *
 * 判据用"水面"这种大块特征：地图里按地块集判定的水面格，应当与预览图上同坐标的蓝像素吻合。
 * 实测（`MULTI.MIX` 第 5 张，84×92、11.2% 是水）偏移 (1,0) 时一致率 98.8%；
 * 换成等距/斜切等投影只有 4%~14% —— 这一条把"预览与战场形状不同"钉死成投影差异，而不是我们读错了地块。
 */
const mixPath = process.env.RA2_MIX
const multiPath = mixPath ? path.join(path.dirname(mixPath), 'MULTI.MIX') : undefined
const skip = !multiPath || !fs.existsSync(multiPath!) ? '同目录没有 MULTI.MIX' : false

test('原版预览图按菱形坐标一像素一格：水面按坐标吻合', { skip }, () => {
  const archives = new Uint8Array(fs.readFileSync(mixPath!))
  const maps = new Uint8Array(fs.readFileSync(multiPath!))
  const mapIndex = readMixIndex(maps)
  const map = readMap(readMixEntry(maps, mapIndex, mapIndex.entries[5]!))
  const preview = map.preview
  assert.ok(preview, '第 5 张应当自带预览图')
  assert.deepEqual([map.width, map.height], [84, 92])

  const theater = openTheater(archives, map.theater ?? 'temperate')
  assert.ok(theater)
  const waterSets = new Set(theater.ini.sets.filter((set) => /water/i.test(set.name)).map((set) => set.index))
  const tileIsWater = new Uint8Array(theater.ini.tiles.length)
  let at = 0
  for (const set of theater.ini.sets) {
    for (let offset = 0; offset < set.tilesInSet; offset++) tileIsWater[at + offset] = waterSets.has(set.index) ? 1 : 0
    at += set.tilesInSet
  }

  const isPreviewWater = (x: number, y: number): boolean | undefined => {
    if (x < 0 || y < 0 || x >= preview!.width || y >= preview!.height) return undefined
    const from = (y * preview!.width + x) * 3
    const red = preview!.rgb[from]!
    const green = preview!.rgb[from + 1]!
    const blue = preview!.rgb[from + 2]!
    return blue > red + 16 && blue >= green + 8
  }

  let agree = 0
  let compared = 0
  let waterCells = 0
  for (const cell of map.cells) {
    // 预览图按**菱形坐标**一像素一格：横 = X − Y + 宽 − 1（再 +1，实测偏移），纵 = (X + Y − 宽 − 1) / 2。
    // 注意这与地形记录自己的格坐标是两套空间：记录里的 (X, Y) 是引擎格坐标，预览图用的是菱形序号。
    const previewX = cell.diamondX - cell.diamondY + map.width
    const previewY = (cell.diamondX + cell.diamondY - map.width - 1) / 2
    if (!Number.isInteger(previewY)) continue
    if (tileIsWater[cell.tileIndex] === 1) waterCells += 1
    const theirs = isPreviewWater(previewX, previewY)
    if (theirs === undefined) continue
    compared += 1
    if ((tileIsWater[cell.tileIndex] === 1) === theirs) agree += 1
  }
  assert.ok(waterCells > 200, `水面格太少：${waterCells}`)
  assert.ok(
    agree / compared > 0.95,
    `偏移 (1,0) 下水面一致率只有 ${((agree / compared) * 100).toFixed(1)}%，说明预览不是方格视角或偏移变了`,
  )
})

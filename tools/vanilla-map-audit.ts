import fs from 'node:fs'
import { readMap, readMixEntry, readMixIndex, TILE_NONE } from '@ra2web/formats'
import { openTheater } from '@ra2web/assets'

/**
 * 地图语料体检：把"格空间 / 放置坐标 / 地块美术"这几条判据跑到档案里的**每一张地图**上。
 *
 * 用法：tsx tools/vanilla-map-audit.ts <RA2.MIX> <地图档案.mix> [更多 .mix …]
 *
 * 输出：总览一行 + 两类异常清单 ——
 *  - 建筑落点：民用/中立建筑必须站在**真有地块**的格上（原版对落在空格的对象就是忽略）。
 *    口径错了的话命中率会掉到 10~20%；实测 114 张图 88.8%，所以低命中率的地图值得单独看。
 *  - 缺美术：地块段在 INI 里有、图形文件不在我们搜的档案里的格子，按**地块段名**归类，
 *    直接指出去哪个档案找（例如 snow 的 `mslop`、urban 的 `warub`）。
 *
 * 不覆盖：只读档案、只报数字，不做阈值断言（它是诊断工具，不是门禁）。
 */
const [archivePath, ...mapPaths] = process.argv.slice(2)
if (!archivePath || mapPaths.length === 0) {
  console.error('usage: tsx tools/vanilla-map-audit.ts <RA2.MIX> <maps.mix> [more.mix …]')
  process.exit(1)
}

const archive = new Uint8Array(fs.readFileSync(archivePath))
const theaters = new Map<string, ReturnType<typeof openTheater>>()
const theaterOf = (name: string) => {
  if (!theaters.has(name)) theaters.set(name, openTheater(archive, name))
  return theaters.get(name)
}

let maps = 0
let records = 0
let noTile = 0
let missingArt = 0
let placed = 0
let placedOnTerrain = 0
const lowHit: string[] = []
const missingBySet = new Map<string, number>()

for (const mapPath of mapPaths) {
  const bytes = new Uint8Array(fs.readFileSync(mapPath))
  const index = readMixIndex(bytes)
  for (let entry = 0; entry < index.entries.length; entry++) {
    let map
    try {
      map = readMap(readMixEntry(bytes, index, index.entries[entry]!))
    } catch {
      continue // 档案里除了地图还有别的条目，解不开的跳过
    }
    maps++
    const theater = theaterOf(map.theater ?? 'temperate')
    const tileByCell = new Map<string, number>()
    for (const cell of map.cells) {
      records++
      tileByCell.set(`${cell.cellX},${cell.cellY}`, cell.tileIndex)
      if (cell.tileIndex === TILE_NONE) {
        noTile++
        continue
      }
      const tile = theater?.ini.tiles[cell.tileIndex]
      if (!theater || tile === undefined) {
        missingArt++
        const name = tile === undefined ? '地块号超出剧场地块表' : '未知'
        missingBySet.set(name, (missingBySet.get(name) ?? 0) + 1)
        continue
      }
      if (theater.loadTile(cell.tileIndex) === undefined) {
        missingArt++
        const setName = theater.ini.sets[tile.setIndex]?.name ?? `#${tile.setIndex}`
        missingBySet.set(setName, (missingBySet.get(setName) ?? 0) + 1)
      }
    }
    const structures = map.placements.filter((placement) => placement.kind === 'structure')
    let onTerrain = 0
    let onVoidCell = 0
    let offMap = 0
    for (const structure of structures) {
      const tile = tileByCell.get(`${structure.cellX},${structure.cellY}`)
      if (tile === undefined) offMap++
      else if (tile === TILE_NONE) onVoidCell++
      else onTerrain++
    }
    placed += structures.length
    placedOnTerrain += onTerrain
    const hit = structures.length === 0 ? 1 : onTerrain / structures.length
    if (structures.length > 0 && hit < 0.7) {
      lowHit.push(
        `${mapPath} 第 ${entry} 张 ${map.width}×${map.height} ${map.theater ?? '?'}：建筑 ${onTerrain} 有地块 / ` +
          `${onVoidCell} 未上色格 / ${offMap} 无记录（共 ${structures.length}）`,
      )
    }
  }
}

console.log(`地图 ${maps} 张；地形记录 ${records} 条（无地块 ${noTile}）；取不到美术的格 ${missingArt}`)
console.log(
  `建筑放置 ${placed} 个，落在真有地块上 ${placedOnTerrain}（${((placedOnTerrain / Math.max(1, placed)) * 100).toFixed(1)}%）`,
)
console.log(`\n命中率低于 70% 的地图 ${lowHit.length} 张：`)
for (const line of lowHit) console.log(`  ${line}`)
console.log(`\n缺美术的格按地块段归类（前 12）：`)
for (const [name, count] of [...missingBySet.entries()].sort((left, right) => right[1] - left[1]).slice(0, 12)) {
  console.log(`  ${name}：${count} 格`)
}

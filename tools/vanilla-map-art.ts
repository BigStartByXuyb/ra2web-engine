import fs from 'node:fs'
import { crc32, findMixEntry, readMap, readMixEntry, readMixIndex, readTheaterIni } from '@ra2web/formats'
import { buildPassability, openTheater } from '@ra2web/assets'

/**
 * 逐张地图报"地块美术齐不齐"。
 *
 * 用法规：`tsx tools/vanilla-map-art.ts [RA2.MIX 路径] [地图档案路径]`
 * 不传参数时读 `DEFAULT_PACK_DIR` 下的 `RA2.MIX` 与 `Maps01.mix`。
 *
 * 判定：地图每一格按 地块号 → 地块集 → `<FileName><两位序号><剧场后缀>` 找图形；
 * 找不到就记进"缺图"。缺图的地图在这份资产上开不了局 —— 原版客户端在同样的格上会抛
 * `TileNum not found` / `SubTile not found`。地块号超出剧场地块表的单独记一档。
 */
const packDir = process.env.RA2_PACK_DIR ?? 'D:/AI_GAME/work/assets/pack'
const archivePath = process.argv[2] ?? `${packDir}/RA2.MIX`
const mapArchivePath = process.argv[3] ?? `${packDir}/Maps01.mix`

const archive = new Uint8Array(fs.readFileSync(archivePath))
const mapsBytes = new Uint8Array(fs.readFileSync(mapArchivePath))
const mapsIndex = readMixIndex(mapsBytes)

/** 剧场 INI：用来把地块号翻成地块集名，直接读 `local.mix` 里的那一份。 */
function theaterIni(theaterName: string): ReturnType<typeof readTheaterIni> | undefined {
  const fileNames: Record<string, string> = { temperate: 'temperat.ini', snow: 'snow.ini', urban: 'urban.ini' }
  const fileName = fileNames[theaterName.toLowerCase()]
  if (!fileName) return undefined
  const root = readMixIndex(archive)
  const localEntry = findMixEntry(root, 'local.mix', crc32)
  if (!localEntry) return undefined
  const localBytes = readMixEntry(archive, root, localEntry)
  const local = readMixIndex(localBytes)
  const entry = findMixEntry(local, fileName, crc32)
  return entry ? readTheaterIni(readMixEntry(localBytes, local, entry)) : undefined
}

const cache = new Map<string, ReturnType<typeof theaterIni>>()
const inis = (theaterName: string) => {
  const key = theaterName.toLowerCase()
  if (!cache.has(key)) cache.set(key, theaterIni(theaterName))
  return cache.get(key)
}

process.stdout.write(`${mapArchivePath}：${mapsIndex.entries.length} 条\n`)
mapsIndex.entries.forEach((entry, position) => {
  let map
  try {
    map = readMap(readMixEntry(mapsBytes, mapsIndex, entry))
  } catch (error) {
    process.stdout.write(`#${position} 读取失败：${String(error)}\n`)
    return
  }
  const theaterName = map.theater ?? 'temperate'
  const theater = openTheater(archive, theaterName)
  const ini = inis(theaterName)
  if (!theater || !ini) {
    process.stdout.write(`#${position} ${map.width}x${map.height} ${theaterName}：装不上剧场\n`)
    return
  }
  // 系数恒为 1：只关心"有没有图形"，不关心通不通
  const passability = buildPassability(map, theater, { speedType: 'Track', speedFactor: () => 1 })
  const inRange = map.cells.filter(
    (cell) => cell.cellX >= 0 && cell.cellY >= 0 && cell.cellX < map.width && cell.cellY < map.height,
  ).length
  const tick = passability.missingArt.cells === 0 ? '齐' : '缺'
  const detail =
    passability.missingArt.cells === 0
      ? ''
      : `　缺 ${passability.missingArt.cells}/${inRange} 格，涉及：${[...passability.missingArt.bySet]
          .sort((left, right) => right[1] - left[1])
          .map(([name, count]) => `${name} ${count} 格`)
          .join('、')}`
  const landTypes = [...passability.landTypeCounts]
    .sort((left, right) => right[1] - left[1])
    .map(([name, count]) => `${name} ${count} 格`)
    .join('、')
  process.stdout.write(
    `#${position} ${map.width}x${map.height} ${theaterName} 地块表 ${ini.tiles.length} 块　[${tick}] ${landTypes || '无地形'}\n${detail}\n`,
  )
})

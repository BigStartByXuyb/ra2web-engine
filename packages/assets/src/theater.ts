import {
  crc32,
  findMixEntry,
  readMixEntry,
  readMixIndex,
  readTheaterIni,
  readTmp,
  tileFileName,
  type TmpFile,
  type TheaterIni,
} from '@ra2web/formats'

/**
 * 剧场（theater）资源：地块控制文件 + 地块图形档案 + 地形调色板。
 *
 * 剧场名到文件名的对应是原版的固定约定：控制文件 `{temperat,snow,urban}.ini`、
 * 地块档案 `iso{temp,snow,urb}.mix`、图形后缀 `.tem`/`.sno`/`.urb`。
 *
 * 地块图形名 = `<FileName><两位序号>[a..z]<后缀>`（同一地块的附加图像用字母结尾，
 * 按存在与否依次尝试）—— 与客户端实现一致。
 */

interface TheaterFiles {
  readonly ini: string
  readonly tiles: string
  readonly suffix: string
}

const THEATERS: Readonly<Record<string, TheaterFiles>> = {
  temperate: { ini: 'temperat.ini', tiles: 'isotemp.mix', suffix: '.tem' },
  snow: { ini: 'snow.ini', tiles: 'isosnow.mix', suffix: '.sno' },
  urban: { ini: 'urban.ini', tiles: 'isourb.mix', suffix: '.urb' },
}

export interface TheaterAssets {
  readonly name: string
  readonly ini: TheaterIni
  /** 全局地块编号 → 地块图形；找不到返回 undefined */
  loadTile(tileIndex: number): TmpFile | undefined
}

export function openTheater(archiveBytes: Uint8Array, theaterName: string): TheaterAssets | undefined {
  const files = THEATERS[theaterName.trim().toLowerCase()]
  if (!files) return undefined
  const root = readMixIndex(archiveBytes)

  const localEntry = findMixEntry(root, 'local.mix', crc32)
  if (!localEntry) return undefined
  const localBytes = readMixEntry(archiveBytes, root, localEntry)
  const local = readMixIndex(localBytes)
  const iniEntry = findMixEntry(local, files.ini, crc32)
  if (!iniEntry) return undefined
  const ini = readTheaterIni(readMixEntry(localBytes, local, iniEntry))
  if (ini.tiles.length === 0) return undefined

  const tilesEntry = findMixEntry(root, files.tiles, crc32)
  if (!tilesEntry) return undefined
  const tilesBytes = readMixEntry(archiveBytes, root, tilesEntry)
  const tiles = readMixIndex(tilesBytes)

  const cache = new Map<number, TmpFile | undefined>()
  return {
    name: theaterName,
    ini,
    loadTile(tileIndex) {
      const cached = cache.get(tileIndex)
      if (cached !== undefined || cache.has(tileIndex)) return cached
      const parsed = readTile(tileIndex)
      cache.set(tileIndex, parsed)
      return parsed
    },
  }

  function readTile(tileIndex: number): TmpFile | undefined {
    const tile = ini.tiles[tileIndex]
    if (!tile) return undefined
    const base = tileFileName(tile, files!.suffix)
    const candidates = [base]
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      candidates.push(`${base.slice(0, -files!.suffix.length)}${letter}${files!.suffix}`)
    }
    for (const candidate of candidates) {
      const entry = findMixEntry(tiles, candidate, crc32)
      if (!entry) continue
      try {
        return readTmp(readMixEntry(tilesBytes, tiles, entry))
      } catch {
        return undefined
      }
    }
    return undefined
  }
}

/**
 * 地形调色板：`local.mix` 里有 4 个 768 字节条目（6 位分量）。
 *
 * 待核对：原版按名字索引它们，但这 4 个条目的名字用 558 个候选名逐一试算 CRC 都没命中，
 * 因此这里按"渲染结果"挑：雪地地形应当是亮灰白，`hash=21437a9f` 是 4 份里最亮的一份。
 */
const TERRAIN_PALETTE_HASH: Readonly<Record<string, number>> = {
  snow: 0x21437a9f,
}

export function loadTerrainPalette(archiveBytes: Uint8Array, theaterName: string | undefined): Uint8Array | undefined {
  const root = readMixIndex(archiveBytes)
  const localEntry = findMixEntry(root, 'local.mix', crc32)
  if (!localEntry) return undefined
  const localBytes = readMixEntry(archiveBytes, root, localEntry)
  const local = readMixIndex(localBytes)
  const wanted = theaterName ? TERRAIN_PALETTE_HASH[theaterName.trim().toLowerCase()] : undefined
  const entry =
    (wanted !== undefined ? local.entries.find((candidate) => candidate.hash === wanted) : undefined) ??
    local.entries.find((candidate) => candidate.length === 768)
  return entry ? readMixEntry(localBytes, local, entry) : undefined
}

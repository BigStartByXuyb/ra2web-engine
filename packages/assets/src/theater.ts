import {
  crc32,
  findMixEntry,
  readPalette,
  readMixEntry,
  readMixIndex,
  readTheaterIni,
  readTmp,
  tileFileName,
  type Palette,
  type TmpFile,
  type TheaterIni,
} from '@ra2web/formats'

/**
 * 剧场（theater）资源：地块控制文件 + 地块图形档案 + 地形调色板。
 *
 * 剧场名到文件名的对应是原版的固定约定：控制文件 `{temperat,snow,urban}.ini`、
 * 地块档案 `iso{temp,snow,urb}.mix`、图形后缀 `.tem`/`.sno`/`.urb`、
 * 地形调色板 `iso{tem,sno,urb}.pal`（在 `RA2.MIX` 的 `cache.mix` 里）。
 *
 * 地块图形名 = `<FileName><两位序号>[a..z]<后缀>`（同一地块的附加图像用字母结尾，
 * 按存在与否依次尝试）—— 与客户端实现一致。
 */

interface TheaterFiles {
  readonly ini: string
  readonly tiles: string
  readonly suffix: string
  readonly palette: string
}

const THEATERS: Readonly<Record<string, TheaterFiles>> = {
  temperate: { ini: 'temperat.ini', tiles: 'isotemp.mix', suffix: '.tem', palette: 'isotem.pal' },
  snow: { ini: 'snow.ini', tiles: 'isosnow.mix', suffix: '.sno', palette: 'isosno.pal' },
  urban: { ini: 'urban.ini', tiles: 'isourb.mix', suffix: '.urb', palette: 'isourb.pal' },
}

/** 地形调色板所在的档案名：`RA2.MIX` 的内嵌档案。 */
const PALETTE_ARCHIVE = 'cache.mix'

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
 * 地形调色板：`RA2.MIX` 的 `cache.mix` 里按剧场名存放（`isotem.pal` / `isosno.pal` / `isourb.pal`）。
 *
 * 实测 `isotem.pal` 的 119 号色是 (140,144,84)、121 号是 (132,144,68)，正是温带草地；
 * `isosno.pal` 的 21..29 号是雪白。地块与调色板必须成对取用，用错会把绿地画成棕褐色。
 */
export function loadTerrainPalette(archiveBytes: Uint8Array, theaterName: string | undefined): Palette | undefined {
  const files = theaterName ? THEATERS[theaterName.trim().toLowerCase()] : undefined
  if (!files) return undefined
  const root = readMixIndex(archiveBytes)
  const archiveEntry = findMixEntry(root, PALETTE_ARCHIVE, crc32)
  if (!archiveEntry) return undefined
  const archive = readMixEntry(archiveBytes, root, archiveEntry)
  const index = readMixIndex(archive)
  const entry = findMixEntry(index, files.palette, crc32)
  return entry ? readPalette(readMixEntry(archive, index, entry)) : undefined
}

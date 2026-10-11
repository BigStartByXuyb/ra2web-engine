import {
  crc32,
  findMixEntry,
  readPalette,
  readMixEntry,
  readMixIndex,
  readShp,
  readTheaterIni,
  readTmp,
  tileFileName,
  type Palette,
  type ShpFile,
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
 *
 * 非地块图形（覆盖物、建筑）的名字规则与地块不同，见 `loadImage`。
 */

interface TheaterFiles {
  readonly ini: string
  readonly tiles: string
  readonly suffix: string
  readonly palette: string
  /** 单位/建筑用的色板（`unittem.pal` 一类） */
  readonly unitPalette: string
  /** 本剧场**优先**搜索的图形包；找不到时继续在 `SHARED_IMAGE_MIXES` 里找 */
  readonly mixes: readonly string[]
  /** 图形名第 2 个字符替换用的剧场字母 */
  readonly letter: string
}

const THEATERS: Readonly<Record<string, TheaterFiles>> = {
  temperate: {
    ini: 'temperat.ini',
    tiles: 'isotemp.mix',
    suffix: '.tem',
    palette: 'isotem.pal',
    unitPalette: 'unittem.pal',
    mixes: ['isotemp.mix', 'temperat.mix', 'tem.mix'],
    letter: 'T',
  },
  snow: {
    ini: 'snow.ini',
    tiles: 'isosnow.mix',
    suffix: '.sno',
    palette: 'isosno.pal',
    unitPalette: 'unitsno.pal',
    mixes: ['isosnow.mix', 'snow.mix', 'sno.mix'],
    letter: 'A',
  },
  urban: {
    ini: 'urban.ini',
    tiles: 'isourb.mix',
    suffix: '.urb',
    palette: 'isourb.pal',
    unitPalette: 'uniturb.pal',
    mixes: ['isourb.mix', 'urb.mix', 'urban.mix'],
    letter: 'U',
  },
}

/** 地形调色板所在的档案名：`RA2.MIX` 的内嵌档案。 */
const PALETTE_ARCHIVE = 'cache.mix'
/**
 * 其余剧场的图形包。原版把所有档案合成**一张全局图形表**，剧场只决定文件名后缀
 * （客户端 `ImageFinder` 在一个扁平的 `images` 表里按文件名查找，没有"按剧场分表"这回事）。
 *
 * 判定依据：`gapowr.shp`（发电厂）、`napowr.shp`、`natsla.shp`、`galite.shp` 等 8 个主战图形
 * 在本机档案里**只存在于 `snow.mix`**，而它们是温带/城市地图上的建筑 —— 只查本剧场的包会漏掉它们。
 */
const SHARED_IMAGE_MIXES = [
  'temperat.mix',
  'snow.mix',
  'urban.mix',
  'tem.mix',
  'sno.mix',
  'urb.mix',
  'isogen.mix',
  'conquer.mix',
  'generic.mix',
  'isotemp.mix',
  'isosnow.mix',
  'isourb.mix',
] as const
/** 图形名第 2 个字符替换只在这两段里做：首字母与次字母各须落在一组里（与客户端一致）。 */
const NEW_THEATER_FIRST = 'GNCY'
const NEW_THEATER_SECOND = 'ATUDLN'
/** 剧场字母找不到时的通用回退字母。 */
const GENERIC_LETTER = 'g'

export interface TheaterAssets {
  readonly name: string
  readonly ini: TheaterIni
  /** 全局地块编号 → 地块图形；找不到返回 undefined */
  loadTile(tileIndex: number): TmpFile | undefined
  /**
   * 按 art.ini 的图形名取 SHP。两种名字规则合起来决定文件名：
   *
   *  - `theaterExtension`（art.ini 的 `Theater=yes`）：用剧场后缀 `.tem` / `.sno` / `.urb`，否则用 `.shp`；
   *  - 名字首字母在 `GNCY` 里、次字母在 `ATUDLN` 里时，
   *    把**第 2 个字符**换成剧场字母（`NAWALL` → 温带 `NTWALL`），找不到再试通用字母 `g`，再退回原名。
   *
   * 判定依据（真实档案命中）：温带下 `NAWALL` 命中 `ntwall.shp`、`SROCK01` 命中 `srock01.tem`、
   * `LOBRDG26` 命中 `lobrdg26.tem`。
   */
  loadImage(imageName: string, options: ImageOptions): ShpFile | undefined
}

export interface ImageOptions {
  /** art.ini 的 `Theater=yes` */
  readonly theaterExtension: boolean
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

  const imageMixes = [...new Set([...files.mixes, ...SHARED_IMAGE_MIXES])].flatMap((name) => {
    const entry = findMixEntry(root, name, crc32)
    if (!entry) return []
    const bytes = readMixEntry(archiveBytes, root, entry)
    return [{ bytes, index: readMixIndex(bytes) }]
  })

  const cache = new Map<number, TmpFile | undefined>()
  const imageCache = new Map<string, ShpFile | undefined>()
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
    loadImage(imageName, options) {
      const key = `${imageName}\u0000${options.theaterExtension}`
      if (!imageCache.has(key)) imageCache.set(key, readImage(imageName, options))
      return imageCache.get(key)
    },
  }

  /** 候选文件名按优先级逐个试：剧场字母变体 → 通用字母变体 → 原名。 */
  function readImage(imageName: string, options: ImageOptions): ShpFile | undefined {
    for (const candidate of imageFileCandidates(imageName, options, files!.suffix, files!.letter)) {
      for (const mix of imageMixes) {
        const entry = findMixEntry(mix.index, candidate, crc32)
        if (!entry) continue
        try {
          return readShp(readMixEntry(mix.bytes, mix.index, entry))
        } catch {
          return undefined
        }
      }
    }
    return undefined
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
 * 给出候选文件名（已全部转小写），按尝试次序排列。
 *
 * 客户端 `ImageFinder.getFilename` / `applyNewTheaterIfNeeded` 只看**名字本身的形态**：
 * 首字母在 `GNCY`、次字母在 `ATUDLN` 时换成剧场字母，找不到用通用字母 `g`，再退回原名；
 * 没有任何 art.ini 开关参与判断。
 */
export function imageFileCandidates(
  imageName: string,
  options: ImageOptions,
  theaterSuffix: string,
  theaterLetter: string,
): readonly string[] {
  const base = imageName.toLowerCase() + (options.theaterExtension ? theaterSuffix : '.shp')
  const upper = imageName.toUpperCase()
  const isNewTheaterName = NEW_THEATER_FIRST.includes(upper[0] ?? '') && NEW_THEATER_SECOND.includes(upper[1] ?? '')
  if (!isNewTheaterName) return [base]
  const head = base[0] ?? ''
  const tail = base.slice(2)
  // 剧场字母与原名第 2 个字符相同等情况会重复，这里按出现次序去重
  return [...new Set([`${head}${theaterLetter.toLowerCase()}${tail}`, `${head}${GENERIC_LETTER}${tail}`, base])]
}

/**
 * 剧场调色板：`RA2.MIX` 的 `cache.mix` 里按剧场名存放。
 *
 * - `iso`：地块与覆盖物用（`isotem.pal` 一类）。实测 `isotem.pal` 的 119 号色是 (140,144,84)、
 *   121 号是 (132,144,68)，正是温带草地；`isosno.pal` 的 21..29 号是雪白。
 * - `unit`：单位与建筑用（`unittem.pal` 一类）。判定依据：客户端 `readPaletteAndLightingTypes`
 *   默认 `paletteType=Default`，只有 art.ini 标了 `TerrainPalette`/`ShouldUseCellDrawer` 才改用地形色板。
 *
 * 地块与调色板必须成对取用，用错会把绿地画成棕褐色。
 */
export function loadTheaterPalette(
  archiveBytes: Uint8Array,
  theaterName: string | undefined,
  which: 'iso' | 'unit',
): Palette | undefined {
  const files = theaterName ? THEATERS[theaterName.trim().toLowerCase()] : undefined
  if (!files) return undefined
  const root = readMixIndex(archiveBytes)
  const archiveEntry = findMixEntry(root, PALETTE_ARCHIVE, crc32)
  if (!archiveEntry) return undefined
  const archive = readMixEntry(archiveBytes, root, archiveEntry)
  const index = readMixIndex(archive)
  const entry = findMixEntry(index, which === 'iso' ? files.palette : files.unitPalette, crc32)
  return entry ? readPalette(readMixEntry(archive, index, entry)) : undefined
}

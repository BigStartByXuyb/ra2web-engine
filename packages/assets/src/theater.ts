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
  type TheaterTile,
  type TheaterTileSet,
} from '@ra2web/formats'
import { findOverride, type AssetOverride } from './overrides.js'

/**
 * 剧场（theater）资源：地块控制文件 + 地块图形档案 + 地形调色板。
 *
 * 剧场名到文件名的对应是原版的固定约定：控制文件 `{temperat,snow,urban}.ini`、
 * 地块档案 `iso{temp,snow,urb}.mix`、图形后缀 `.tem`/`.sno`/`.urb`、
 * 地形调色板 `iso{tem,sno,urb}.pal`（在 `RA2.MIX` 的 `cache.mix` 里）。
 *
 * 地块图形名 = `<FileName><两位序号>[a..z]<后缀>`（同一地块的附加图像用字母结尾，
 * 按存在与否依次尝试）—— 与客户端实现一致。
 * 图形落在**哪个包**不给定死：客户端建的是一张**全局图形表**，所有装载的档案都往里塞，
 * 取的时候只按文件名查。实测同一剧场的地块分散在两个包里 —— `isosnow.mix` 放 `Cliff01.sno`
 * 这类基础块，`snow.mix` 放 `warub13.sno`（RA2 Wash Rubble）、`Ovrpsb16.sno`（Wood Bridges）
 * 这类补充块；只搜 iso 包会丢掉它们。
 *
 * 非地块图形（覆盖物、建筑）的名字规则与地块不同，见 `loadImage`；两者查的是同一张表。
 */

interface TheaterFiles {
  readonly ini: string
  readonly suffix: string
  readonly palette: string
  /** 单位/建筑用的色板（`unittem.pal` 一类） */
  readonly unitPalette: string
  /**
   * 本剧场**优先**搜索的图形包（第一个是地块主包）；找不到时继续在 `SHARED_IMAGE_MIXES` 里找。
   * 地块图形与 SHP 图形共用这一张表。
   */
  readonly mixes: readonly string[]
  /** 图形名第 2 个字符替换用的剧场字母 */
  readonly letter: string
}

const THEATERS: Readonly<Record<string, TheaterFiles>> = {
  temperate: {
    ini: 'temperat.ini',
    suffix: '.tem',
    palette: 'isotem.pal',
    unitPalette: 'unittem.pal',
    mixes: ['isotemp.mix', 'temperat.mix', 'tem.mix'],
    letter: 'T',
  },
  snow: {
    ini: 'snow.ini',
    suffix: '.sno',
    palette: 'isosno.pal',
    unitPalette: 'unitsno.pal',
    mixes: ['isosnow.mix', 'snow.mix', 'sno.mix'],
    letter: 'A',
  },
  urban: {
    ini: 'urban.ini',
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
  /**
   * 地貌线任务 2：该地块号命中的崖集档位（`CliffSet`→'cliff'、`WaterCliffs`→'waterCliff'、
   * `DestroyableCliffs`→'destroyableCliff'），都不命中或越界为 undefined。
   *
   * 客户端 `isCliffTile = cliffSetNums.includes(getSetNum(tile))`（参考实现
   * `work/decompiled/ra2web-client/app.readable.js:6047`，集合键见 :5887）；崖块判定是"或"：
   * `terrainType=15` **或**集合归属都算崖（app.readable.js:20061）。三档分开返回供材质分档用。
   */
  readonly isCliffSetTile: (tileIndex: number) => CliffSetKind | undefined
  /**
   * 地面块：`Clear` 段的第一块。地块美术不满一块菱形时（坡道、坡角）垫在它下面 ——
   * 原版就是这么补的，判定见 `docs/ENGINE-MAP.md` 的"地块合成"。
   */
  readonly groundTileIndex: number | undefined
  /** 全局地块编号 → 地块图形；找不到返回 undefined */
  loadTile(tileIndex: number): TmpFile | undefined
  /**
   * 该地块在档案里命中的**文件名**（`clear01.sno` 一类）；越界或没有图形时 undefined。
   * 覆盖素材包按文件名定位文件，所以取高清地块图要用它。
   */
  tileFileName(tileIndex: number): string | undefined
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

/** 崖集档位：剧场 INI `[General]` 三键，见 `TheaterAssets.isCliffSetTile` 的注释。 */
export type CliffSetKind = 'cliff' | 'waterCliff' | 'destroyableCliff'

const CLIFF_SET_KEYS: ReadonlyArray<readonly [CliffSetKind, string]> = [
  ['cliff', 'cliffset'],
  ['waterCliff', 'watercliffs'],
  ['destroyableCliff', 'destroyablecliffs'],
]

/**
 * 剧场 INI → 崖集档位表。缺键或键值不是数字 → 该档缺席（MOD 剧场可能没有），不猜、不抛错。
 * 实测三剧场三键齐全：CliffSet=10 / WaterCliffs=15 / DestroyableCliffs=61|56（见 ENGINE-MAP「崖块集合与坡道语义」）。
 */
export function cliffSetIndexesOf(ini: TheaterIni): ReadonlyMap<CliffSetKind, number> {
  const sets = new Map<CliffSetKind, number>()
  for (const [kind, key] of CLIFF_SET_KEYS) {
    const value = ini.general.get(key)
    if (value === undefined) continue
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) sets.set(kind, parsed)
  }
  return sets
}

export function openTheater(
  archiveBytes: Uint8Array,
  theaterName: string,
  overrides?: readonly AssetOverride[],
): TheaterAssets | undefined {
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

  const imageMixes = [...new Set([...files.mixes, ...SHARED_IMAGE_MIXES])].flatMap((name) => {
    const entry = findMixEntry(root, name, crc32)
    if (!entry) return []
    const bytes = readMixEntry(archiveBytes, root, entry)
    return [{ bytes, index: readMixIndex(bytes) }]
  })

  const cache = new Map<number, TmpFile | undefined>()
  const nameCache = new Map<number, string | undefined>()
  const imageCache = new Map<string, ShpFile | undefined>()
  // 地面块：三个剧场都叫 `Clear`。缺美术时退回"没有地面块"，绘制方按原样只画地块
  const clearSet = ini.sets.find((set) => set.fileName.toLowerCase() === 'clear')
  const clearTile = clearSet === undefined ? -1 : ini.tiles.findIndex((tile) => tile.setIndex === clearSet.index)
  const groundTileIndex = clearTile >= 0 && readTile(clearTile) ? clearTile : undefined
  const cliffSetIndexes = cliffSetIndexesOf(ini)

  return {
    name: theaterName,
    ini,
    groundTileIndex,
    isCliffSetTile(tileIndex) {
      const tile = ini.tiles[tileIndex]
      if (!tile) return undefined
      for (const [kind, setIndex] of cliffSetIndexes) {
        if (setIndex === tile.setIndex) return kind
      }
      return undefined
    },
    loadTile(tileIndex) {
      const cached = cache.get(tileIndex)
      if (cached !== undefined || cache.has(tileIndex)) return cached
      const parsed = readTile(tileIndex)
      cache.set(tileIndex, parsed)
      return parsed
    },
    tileFileName(tileIndex) {
      if (!nameCache.has(tileIndex)) nameCache.set(tileIndex, resolveTileName(tileIndex))
      return nameCache.get(tileIndex)
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
      const overridden = findOverride(overrides, candidate)
      if (overridden) {
        try {
          return readShp(overridden)
        } catch {
          return undefined
        }
      }
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
    const bytes = resolveTileBytes(tileIndex)
    if (!bytes) return undefined
    try {
      return readTmp(bytes)
    } catch {
      return undefined
    }
  }

  /** 该地块命中的文件名；找不到图形时 undefined。 */
  function resolveTileName(tileIndex: number): string | undefined {
    const tile = ini.tiles[tileIndex]
    if (!tile) return undefined
    return findTileFile(tile)?.name
  }

  /** 该地块的字节；覆盖包优先。 */
  function resolveTileBytes(tileIndex: number): Uint8Array | undefined {
    const tile = ini.tiles[tileIndex]
    if (!tile) return undefined
    return findTileFile(tile)?.bytes
  }

  /** 候选名按次序试：覆盖包优先，其次各图形包；命中即返回名字与字节。 */
  function findTileFile(tile: TheaterTile): { name: string; bytes: Uint8Array } | undefined {
    for (const candidate of tileFileCandidates(tile, files!.suffix)) {
      const overridden = findOverride(overrides, candidate)
      if (overridden) return { name: candidate, bytes: overridden }
      for (const mix of imageMixes) {
        const entry = findMixEntry(mix.index, candidate, crc32)
        if (!entry) continue
        return { name: candidate, bytes: readMixEntry(mix.bytes, mix.index, entry) }
      }
    }
    return undefined
  }
}

/** 该地块的候选文件名：原名 + 逐字母变体（RA2 的 `w-a-`/`w-b-` 这类多块图形）。 */
export function tileFileCandidates(tile: TheaterTile, suffix: string): readonly string[] {
  const base = tileFileName(tile, suffix)
  const candidates = [base]
  for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
    candidates.push(`${base.slice(0, -suffix.length)}${letter}${suffix}`)
  }
  return candidates
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

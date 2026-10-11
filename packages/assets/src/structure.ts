import type { ShpFile } from '@ra2web/formats'
import { imageNameOf, readArtEntries, readRulesImageNames, type ArtEntry } from './art.js'
import type { AssetOverride } from './overrides.js'
import { openTheater, type TheaterAssets } from './theater.js'

/**
 * 建筑美术：地图里的类型名 → art.ini 的图形名与地基尺寸 → 按剧场规则取 SHP。
 *
 * 图形名按 art.ini `Image=` → rules.ini `Image=` → 类型名本身的优先级取（见 `art.ts`）；
 * 文件名规则与覆盖物共用（见 `TheaterAssets.loadImage`）：`Theater=yes` 用剧场后缀，
 * 名字形态是 `GNCY`+`ATUDLN` 时把第 2 个字符换成剧场字母。
 * `Foundation=3x3` 给地基格数（缺省 1x1），画的时候要按地基中心对齐。
 *
 * art.ini 里没有条目时仍会按 rules.ini 的 `Image=`、再按类型名找文件
 * （`[TESLA]` 就是这种：art.ini 无条目、rules.ini 写 `Image=NATSLA`）。
 * 取不到图形的建筑返回 undefined，由调用方跳过 —— 原版里也有纯逻辑建筑（如桥的标记）。
 */

export interface StructureArt {
  readonly name: string
  readonly foundationWidth: number
  readonly foundationHeight: number
  /** art.ini 标了 `TerrainPalette` / `ShouldUseCellDrawer`：用地形色板画，而不是单位色板 */
  readonly useTerrainPalette: boolean
  readonly shp: ShpFile
}

export interface StructureAssets {
  /** 类型名 → 建筑美术；没有对应图形时返回 undefined */
  loadStructure(typeName: string): StructureArt | undefined
}

export function openStructures(
  archiveBytes: Uint8Array,
  theaterName: string | undefined,
  overrides?: readonly AssetOverride[],
): StructureAssets | undefined {
  const theater = theaterName ? openTheater(archiveBytes, theaterName, overrides) : undefined
  if (!theater) return undefined

  const cache = new Map<string, StructureArt | undefined>()
  let art: ReadonlyMap<string, ArtEntry> | undefined
  let rulesImages: ReadonlyMap<string, string> | undefined

  return {
    loadStructure(typeName) {
      const key = typeName.toLowerCase()
      if (cache.has(key)) return cache.get(key)
      art ??= readArtEntries(archiveBytes, overrides)
      rulesImages ??= readRulesImageNames(archiveBytes, overrides)
      const entry = art.get(key)
      const shp = theater.loadImage(imageNameOf(typeName, art, rulesImages), {
        theaterExtension: entry?.theater ?? false,
      })
      const resolved = shp
        ? {
            name: typeName,
            foundationWidth: entry?.foundationWidth ?? 1,
            foundationHeight: entry?.foundationHeight ?? 1,
            useTerrainPalette: entry?.useTerrainPalette ?? false,
            shp,
          }
        : undefined
      cache.set(key, resolved)
      return resolved
    },
  }
}

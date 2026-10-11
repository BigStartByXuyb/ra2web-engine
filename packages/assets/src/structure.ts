import { parseIni, readMixFile, type ShpFile } from '@ra2web/formats'
import { openTheater, type TheaterAssets } from './theater.js'

/**
 * 建筑美术：地图里的类型名 → art.ini 的图形名与地基尺寸 → 按剧场规则取 SHP。
 *
 * art.ini 与覆盖物共用那两条命名规则（见 `TheaterAssets.loadImage`）：
 * `Theater=yes` 用剧场后缀、`NewTheater=yes` 把名字第 2 个字符换成剧场字母。
 * `Foundation=3x3` 给地基格数（缺省 1x1），画的时候要按地基中心对齐。
 *
 * 图形名缺省就是类型名本身，因此 art.ini 里没有条目时仍会按类型名找文件。
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

interface ArtEntry {
  readonly image: string | undefined
  readonly theater: boolean
  readonly newTheater: boolean
  readonly foundationWidth: number
  readonly foundationHeight: number
  readonly terrainPalette: boolean
}

export function openStructures(archiveBytes: Uint8Array, theaterName: string | undefined): StructureAssets | undefined {
  const theater = theaterName ? openTheater(archiveBytes, theaterName) : undefined
  if (!theater) return undefined

  const cache = new Map<string, StructureArt | undefined>()
  let art: ReadonlyMap<string, ArtEntry> | undefined

  return {
    loadStructure(typeName) {
      const key = typeName.toLowerCase()
      if (cache.has(key)) return cache.get(key)
      art ??= readArtEntries(archiveBytes)
      const entry = art.get(key)
      const shp = theater.loadImage(entry?.image ?? typeName, {
        theaterExtension: entry?.theater ?? false,
        newTheater: entry?.newTheater ?? false,
      })
      const resolved = shp
        ? {
            name: typeName,
            foundationWidth: entry?.foundationWidth ?? 1,
            foundationHeight: entry?.foundationHeight ?? 1,
            useTerrainPalette: entry?.terrainPalette ?? false,
            shp,
          }
        : undefined
      cache.set(key, resolved)
      return resolved
    },
  }
}

/** art.ini 的图形名 → 命名规则与地基尺寸。 */
function readArtEntries(archiveBytes: Uint8Array): ReadonlyMap<string, ArtEntry> {
  const entries = new Map<string, ArtEntry>()
  const bytes = readMixFile({ bytes: archiveBytes, fileName: 'art.ini', containerFileName: 'local.mix' })
  if (!bytes) return entries
  for (const [name, section] of parseIni(new TextDecoder('windows-1252').decode(bytes)).sections) {
    const foundation = section.values.get('foundation')
    const match = foundation ? /^(\d+)\s*x\s*(\d+)$/i.exec(foundation.trim()) : undefined
    entries.set(name, {
      image: section.values.get('image'),
      theater: section.values.get('theater')?.toLowerCase() === 'yes',
      newTheater: section.values.get('newtheater')?.toLowerCase() === 'yes',
      foundationWidth: match ? Number(match[1]) : 1,
      foundationHeight: match ? Number(match[2]) : 1,
      terrainPalette:
        section.values.get('terrainpalette')?.toLowerCase() === 'yes' ||
        section.values.get('shouldusecelldrawer')?.toLowerCase() === 'yes',
    })
  }
  return entries
}

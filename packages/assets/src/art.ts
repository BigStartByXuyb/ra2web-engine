import { parseIni } from '@ra2web/formats'
import { readLocalText } from './local-ini.js'

/**
 * art.ini 的图形条目：地图上的对象（建筑、覆盖物）靠它决定图形名、命名规则、地基尺寸与色板。
 *
 * 图形名的优先级是 art.ini `Image=` → rules.ini `Image=` → 类型名本身。
 * 判定依据（客户端 `ObjectArt`/`TechnoRules`）：`get imageName() { return (this.image || this.rules.imageName) }`，
 * 其中 `TechnoRules.imageName` 读 rules.ini 的 `Image=`，缺省回落到节名。
 * 真实档案里的两条命中：`[TESLA]` 在 rules.ini 里是 `Image=NATSLA`（art.ini 无条目），
 * `[ATESLA]` 是 `Image=GAPRIS`（art.ini 无条目），灯柱 `INYELWLAMP`/`INGALITE` 等都是 `Image=GALITE`。
 */

export interface ArtEntry {
  /** art.ini `Image=`；没有这一项时为 undefined，由调用方按优先级继续回落 */
  readonly image: string | undefined
  /** art.ini `Theater=yes`：文件名用剧场后缀（`.tem`/`.sno`/`.urb`）而不是 `.shp` */
  readonly theater: boolean
  /** art.ini `Foundation=WxH` 的地基格数，缺省 1×1 */
  readonly foundationWidth: number
  readonly foundationHeight: number
  /** art.ini 标了 `TerrainPalette` / `ShouldUseCellDrawer`：用地形色板画，而不是单位色板 */
  readonly useTerrainPalette: boolean
}

const DEFAULT_ENTRY: ArtEntry = {
  image: undefined,
  theater: false,
  foundationWidth: 1,
  foundationHeight: 1,
  useTerrainPalette: false,
}

const EMPTY_ENTRIES: ReadonlyMap<string, ArtEntry> = new Map()

/** art.ini 的图形名 → 条目；键已转小写。档案里没有 art.ini 时返回空表。 */
export function readArtEntries(archiveBytes: Uint8Array): ReadonlyMap<string, ArtEntry> {
  const text = readLocalText(archiveBytes, 'art.ini')
  if (!text) return EMPTY_ENTRIES
  const entries = new Map<string, ArtEntry>()
  for (const [name, section] of parseIni(text).sections) {
    const foundation = section.values.get('foundation')
    const match = foundation ? /^(\d+)\s*x\s*(\d+)$/i.exec(foundation.trim()) : undefined
    entries.set(name, {
      image: section.values.get('image'),
      theater: section.values.get('theater')?.toLowerCase() === 'yes',
      foundationWidth: match ? Number(match[1]) : DEFAULT_ENTRY.foundationWidth,
      foundationHeight: match ? Number(match[2]) : DEFAULT_ENTRY.foundationHeight,
      useTerrainPalette:
        section.values.get('terrainpalette')?.toLowerCase() === 'yes' ||
        section.values.get('shouldusecelldrawer')?.toLowerCase() === 'yes',
    })
  }
  return entries
}

/** rules.ini 的对象类型名 → `Image=`；键已转小写。只收写了 `Image=` 的节。 */
export function readRulesImageNames(archiveBytes: Uint8Array): ReadonlyMap<string, string> {
  const text = readLocalText(archiveBytes, 'rules.ini')
  if (!text) return EMPTY_RULES_IMAGES
  const images = new Map<string, string>()
  for (const [name, section] of parseIni(text).sections) {
    const image = section.values.get('image')
    if (image) images.set(name.toLowerCase(), image)
  }
  return images
}

/** 按 art.ini → rules.ini → 类型名 的优先级给出图形名。 */
export function imageNameOf(
  typeName: string,
  art: ReadonlyMap<string, ArtEntry>,
  rulesImages: ReadonlyMap<string, string>,
): string {
  const key = typeName.toLowerCase()
  return art.get(key)?.image ?? rulesImages.get(key) ?? typeName
}

const EMPTY_RULES_IMAGES: ReadonlyMap<string, string> = new Map()

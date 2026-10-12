import { parseIni } from '@ra2web/formats'
import { readLocalText } from './local-ini.js'
import type { AssetOverride } from './overrides.js'

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
  /** art.ini `Height=`：原版用于遮挡与排序的高度级数，缺省 0 */
  readonly height: number
  /** art.ini `OccupyHeight=`：占位高度级数，缺省 0 */
  readonly occupyHeight: number
  /** art.ini `YSortAdjust=`：建筑自身的等距排序修正，缺省 0 */
  readonly ySortAdjust: number
  /** art.ini `Buildup=`：建造动画的图形名（从地里升起那一段） */
  readonly buildup: string | undefined
  /** art.ini `ActiveAnim=` / `ActiveAnimDamaged=`：常驻循环动画的图形名 */
  readonly activeAnim: string | undefined
  readonly activeAnimDamaged: string | undefined
  /** art.ini `ActiveAnimYSort=` / `ActiveAnimZAdjust=`：循环动画的排序与抬升修正，缺省 0 */
  readonly activeAnimYSort: number
  readonly activeAnimZAdjust: number
}

const DEFAULT_ENTRY: ArtEntry = {
  image: undefined,
  theater: false,
  foundationWidth: 1,
  foundationHeight: 1,
  useTerrainPalette: false,
  height: 0,
  occupyHeight: 0,
  ySortAdjust: 0,
  buildup: undefined,
  activeAnim: undefined,
  activeAnimDamaged: undefined,
  activeAnimYSort: 0,
  activeAnimZAdjust: 0,
}

const EMPTY_ENTRIES: ReadonlyMap<string, ArtEntry> = new Map()

/** art.ini 的图形名 → 条目；键已转小写。档案里没有 art.ini 时返回空表。 */
export function readArtEntries(
  archiveBytes: Uint8Array,
  overrides?: readonly AssetOverride[],
): ReadonlyMap<string, ArtEntry> {
  const text = readLocalText(archiveBytes, 'art.ini', overrides)
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
      height: integerValue(section.values, 'height'),
      occupyHeight: integerValue(section.values, 'occupyheight'),
      ySortAdjust: integerValue(section.values, 'ysortadjust'),
      buildup: section.values.get('buildup'),
      activeAnim: section.values.get('activeanim'),
      activeAnimDamaged: section.values.get('activeanimdamaged'),
      activeAnimYSort: integerValue(section.values, 'activeanimysort'),
      activeAnimZAdjust: integerValue(section.values, 'activeanimzadjust'),
    })
  }
  return entries
}

/** INI 里的整数字段：缺键或不是整数都按 0 —— 原版这些键缺省就是 0。 */
function integerValue(values: ReadonlyMap<string, string>, key: string): number {
  const raw = values.get(key)
  if (raw === undefined) return 0
  const parsed = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/** rules.ini 的对象类型名 → `Image=`；键已转小写。只收写了 `Image=` 的节。 */
export function readRulesImageNames(
  archiveBytes: Uint8Array,
  overrides?: readonly AssetOverride[],
): ReadonlyMap<string, string> {
  const text = readLocalText(archiveBytes, 'rules.ini', overrides)
  if (!text) return EMPTY_RULES_IMAGES
  const images = new Map<string, string>()
  for (const [name, section] of parseIni(text).sections) {
    const image = section.values.get('image')
    if (image) images.set(name.toLowerCase(), image)
  }
  return images
}

/**
 * 类型名 → 图形名与它的 art.ini 条目。
 *
 * 两件事分开取，不能混：
 *
 * - **图形名**按 art.ini `Image=` → rules.ini `Image=` → 类型名本身的优先级（客户端 `get imageName()`）；
 * - **美术属性**要按**图形名**去 art.ini 找节 —— 客户端就是用图形名查 art 表的。
 *   `[TESLA]` 是这条的实证：它在 art.ini 里没有自己的节，属性全在 `[NATSLA]`
 *   （rules.ini 写 `Image=NATSLA`）；只按类型名查会拿到一堆缺省 0。
 */
export function artEntryOf(
  typeName: string,
  art: ReadonlyMap<string, ArtEntry>,
  rulesImages: ReadonlyMap<string, string>,
): { readonly image: string; readonly entry: ArtEntry | undefined } {
  const key = typeName.toLowerCase()
  const image = art.get(key)?.image ?? rulesImages.get(key) ?? typeName
  return { image, entry: art.get(image.toLowerCase()) ?? art.get(key) }
}

/** 按 art.ini → rules.ini → 类型名 的优先级给出图形名。 */
export function imageNameOf(
  typeName: string,
  art: ReadonlyMap<string, ArtEntry>,
  rulesImages: ReadonlyMap<string, string>,
): string {
  return artEntryOf(typeName, art, rulesImages).image
}

const EMPTY_RULES_IMAGES: ReadonlyMap<string, string> = new Map()

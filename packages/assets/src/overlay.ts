import { parseIni, type MapOverlay, type ShpFile, type ShpFrame } from '@ra2web/formats'
import { readArtEntries, type ArtEntry } from './art.js'
import { readLocalText } from './local-ini.js'
import type { AssetOverride } from './overrides.js'
import { openTheater, type TheaterAssets } from './theater.js'

/**
 * 覆盖物（石头、枯树、栏杆、桥板、矿…）的美术取用。
 *
 * 画哪个图形由三样东西合起来决定：
 *
 *  - 地图给**编号**与一个**附加字节**：编号是 rules.ini `[OverlayTypes]` 里的次序；
 *  - art.ini 给**图形名**与命名规则（`Theater=yes` 用剧场后缀、名字形态是 `GNCY`+`ATUDLN`
 *    时换第 2 个字符，规则本身在 `TheaterAssets.loadImage` 里）；
 *  - 帧号取附加字节，越界或该帧为空时退回**第一个非空帧**
 *    （实测 `LOBRDG26` 6 帧里只有第 1 帧有图形，而地图给的附加字节是 0/4..10）。
 *
 * 覆盖物与地块共用剧场调色板。判定依据：`SROCK01` / `TROCK02` / `LOBRDG26` 用 `isotem.pal`
 * 分别画出石头、枯树、木桥，换成 `temperat.pal` 则是杂色（对照图见 `docs/ENGINE-MAP.md`）。
 */

export interface OverlayArt {
  /** rules.ini 里的图形名（用于诊断） */
  readonly name: string
  readonly shp: ShpFile
  readonly frame: ShpFrame
}

export interface OverlayAssets {
  /** 覆盖物 → 图形与帧；编号未定义或取不到美术时返回 undefined */
  loadOverlay(overlay: MapOverlay): OverlayArt | undefined
}

export function openOverlays(
  archiveBytes: Uint8Array,
  theaterName: string | undefined,
  overrides?: readonly AssetOverride[],
): OverlayAssets | undefined {
  const theater = theaterName ? openTheater(archiveBytes, theaterName, overrides) : undefined
  if (!theater) return undefined

  const cache = new Map<string, OverlayArt | undefined>()
  let names: ReadonlyMap<number, string> | undefined
  let art: ReadonlyMap<string, ArtEntry> | undefined

  return {
    loadOverlay(overlay) {
      const key = `${overlay.id}:${overlay.data}`
      if (cache.has(key)) return cache.get(key)
      names ??= readOverlayNames(archiveBytes, overrides)
      art ??= readArtEntries(archiveBytes, overrides)
      const name = names.get(overlay.id)
      const resolved = resolve(name, name ? art.get(name.toLowerCase()) : undefined, overlay, theater)
      cache.set(key, resolved)
      return resolved
    },
  }
}

function resolve(
  name: string | undefined,
  entry: ArtEntry | undefined,
  overlay: MapOverlay,
  theater: TheaterAssets,
): OverlayArt | undefined {
  if (!name) return undefined
  const shp = theater.loadImage(entry?.image ?? name, {
    theaterExtension: entry?.theater ?? false,
  })
  if (!shp) return undefined
  const frame = pickFrame(shp, overlay.data)
  return frame ? { name, shp, frame } : undefined
}

/** 帧号取附加字节；该帧不存在或为空时退回第一个非空帧。 */
function pickFrame(shp: ShpFile, data: number): ShpFrame | undefined {
  const wanted = shp.frames[data]
  if (wanted && !wanted.isEmpty) return wanted
  return shp.frames.find((frame) => !frame.isEmpty)
}

/** `[OverlayTypes]` 的编号 → 图形名。 */
function readOverlayNames(archiveBytes: Uint8Array, overrides?: readonly AssetOverride[]): ReadonlyMap<number, string> {
  const names = new Map<number, string>()
  const text = readLocalText(archiveBytes, 'rules.ini', overrides)
  const section = text ? parseIni(text).sections.get('overlaytypes') : undefined
  if (!section) return names
  for (const [key, value] of section.values) {
    const id = Number(key)
    if (Number.isInteger(id) && value !== '') names.set(id, value)
  }
  return names
}

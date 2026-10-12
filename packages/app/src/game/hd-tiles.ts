import { findOverride, type AssetOverride, type TheaterAssets } from '@ra2web/assets'
import { decodePng } from './png-image.js'

/**
 * 高清地块素材包：把原版地块的**像素**换成真彩位图，摆位与地形数据仍由原版 TMP 决定。
 *
 * 包里的约定（`tools/build-hd-tiles.ts` 按这个写）：

 * - `hd-tiles.txt`：清单，每行一个原版地块文件名（如 `clear01.sno`），说明包里有哪些高清地块；
 * - `<原名去后缀>.png`：该地块的高清贴图。位图是 `cellsX × cellsY` 的网格，
 *   第 `i` 个子块在第 `i % cellsX` 列、第 `⌊i / cellsX⌋` 行；每格的世界尺寸仍是一格（60×30）。
 *
 * 清单存在的意义：MIX 索引里只有哈希、没有文件名，没法枚举包内容；
 * 有清单就能只解码包里真正有的那几张，其余地块照旧走原版像素。
 */

/** 清单在覆盖包里的固定文件名。 */
export const HD_TILE_MANIFEST = 'hd-tiles.txt'

export interface HdTiles {
  /** 该地块的高清子块；没有就返回 undefined，调用方回落到原版像素 */
  subTile(tileIndex: number, subTile: number): HTMLCanvasElement | undefined
}

/** 原版地块名 → 包里的高清图名：换扩展名，与建筑/单位的 `<图形名>.png` 同一口径。 */
function pngNameOf(tileFileName: string): string {
  const dot = tileFileName.lastIndexOf('.')
  return `${dot > 0 ? tileFileName.slice(0, dot) : tileFileName}.png`
}

export async function loadHdTiles(
  theater: TheaterAssets | undefined,
  overrides: readonly AssetOverride[] | undefined,
): Promise<HdTiles | undefined> {
  if (!theater || !overrides || overrides.length === 0) {
    console.info(`[高清地块] 跳过：剧场 ${theater ? theater.name : '未装'}，覆盖包 ${overrides?.length ?? 0} 个`)
    return undefined
  }
  const manifest = findOverride(overrides, HD_TILE_MANIFEST)
  if (!manifest) {
    console.info(`[高清地块] 覆盖包里没有 ${HD_TILE_MANIFEST}`)
    return undefined
  }

  const names = new TextDecoder()
    .decode(manifest)
    .split(/\r?\n/u)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== '')
  const sheets = new Map<string, HTMLCanvasElement>()
  for (const name of names) {
    const bytes = findOverride(overrides, pngNameOf(name))
    if (!bytes) continue
    try {
      sheets.set(name, await decodePng(bytes))
    } catch (error) {
      console.warn(`[高清地块] ${name} 解不开：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (sheets.size === 0) return undefined
  console.info(`[高清地块] 清单 ${names.length} 条，解码成功 ${sheets.size} 张`)

  /** 每个地块的网格参数取自它自己的 TMP（cellsX/cellsY），所以要按地块号查一次。 */
  const grid = new Map<number, { name: string; columns: number; rows: number; cellWidth: number; cellHeight: number }>()
  const sliceCache = new Map<string, HTMLCanvasElement | undefined>()

  return {
    subTile(tileIndex, subTile) {
      let entry = grid.get(tileIndex)
      if (!entry) {
        const fileName = theater.tileFileName(tileIndex)
        const name = (fileName ?? '').toLowerCase()
        const tile = fileName ? theater.loadTile(tileIndex) : undefined
        if (!name || !tile || !sheets.has(name)) {
          grid.set(tileIndex, { name: '', columns: 0, rows: 0, cellWidth: 0, cellHeight: 0 })
          return undefined
        }
        entry = {
          name,
          columns: tile.cellsX,
          rows: tile.cellsY,
          cellWidth: tile.cellWidth,
          cellHeight: tile.cellHeight,
        }
        grid.set(tileIndex, entry)
      }
      if (entry.name === '' || entry.columns === 0) return undefined

      const key = `${entry.name}:${subTile}`
      if (sliceCache.has(key)) return sliceCache.get(key)
      const sheet = sheets.get(entry.name)!
      if (subTile >= entry.columns * entry.rows) {
        sliceCache.set(key, undefined)
        return undefined
      }
      const cellWidth = Math.floor(sheet.width / entry.columns)
      const cellHeight = Math.floor(sheet.height / entry.rows)
      const column = subTile % entry.columns
      const row = Math.floor(subTile / entry.columns)
      const canvas = document.createElement('canvas')
      canvas.width = cellWidth
      canvas.height = cellHeight
      canvas
        .getContext('2d')
        ?.drawImage(sheet, column * cellWidth, row * cellHeight, cellWidth, cellHeight, 0, 0, cellWidth, cellHeight)
      sliceCache.set(key, canvas)
      return canvas
    },
  }
}

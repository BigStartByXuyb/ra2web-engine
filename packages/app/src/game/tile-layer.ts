import { loadTheaterPalette, openTheater, type AssetOverride, type TheaterAssets } from '@ra2web/assets'
import type { Palette } from '@ra2web/formats'
import { paintTmpSubTile } from '@ra2web/render'
import { toCanvas } from './canvas-image.js'

/**
 * 地块层：把"地块编号 + 子块序号"上色成画布并缓存，绘制时只做 drawImage。
 *
 * 像素排布与透明索引都在 `paintTmpSubTile` 里，这里只负责转成画布。
 */

export interface TileLayer {
  canvasAt(tileIndex: number, subTile: number): HTMLCanvasElement | undefined
}

export function openTileLayer(
  archiveBytes: Uint8Array,
  theaterName: string | undefined,
  overrides?: readonly AssetOverride[],
): TileLayer | undefined {
  if (!theaterName) return undefined
  const theater = openTheater(archiveBytes, theaterName, overrides)
  const palette = loadTheaterPalette(archiveBytes, theaterName, 'iso')
  if (!theater || !palette) return undefined
  return createTileLayer(theater, palette)
}

export function createTileLayer(theater: TheaterAssets, palette: Palette): TileLayer {
  const cache = new Map<string, HTMLCanvasElement | undefined>()
  return {
    canvasAt(tileIndex, subTile) {
      const key = `${tileIndex}:${subTile}`
      if (cache.has(key)) return cache.get(key)
      const canvas = paint(tileIndex, subTile)
      cache.set(key, canvas)
      return canvas
    },
  }

  function paint(tileIndex: number, subTileIndex: number): HTMLCanvasElement | undefined {
    const tile = theater.loadTile(tileIndex)
    const sub = tile?.subTiles[subTileIndex]
    if (!tile || !sub || sub.isEmpty) return undefined

    const image = paintTmpSubTile(tile, sub, palette)
    return toCanvas(image)
  }
}

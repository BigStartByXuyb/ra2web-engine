import { loadTerrainPalette, openTheater, type TheaterAssets } from '@ra2web/assets'

/**
 * 地块层：把"地块编号 + 子块序号"上色成画布并缓存，绘制时只做 drawImage。
 *
 * 调色板索引 0 视为透明（原版地块用它表示空像素）。
 */

export interface TileLayer {
  canvasAt(tileIndex: number, subTile: number): HTMLCanvasElement | undefined
}

export function openTileLayer(archiveBytes: Uint8Array, theaterName: string | undefined): TileLayer | undefined {
  if (!theaterName) return undefined
  const theater = openTheater(archiveBytes, theaterName)
  const palette = loadTerrainPalette(archiveBytes, theaterName)
  if (!theater || !palette) return undefined
  return createTileLayer(theater, palette)
}

export function createTileLayer(theater: TheaterAssets, palette: Uint8Array): TileLayer {
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
    if (!tile || !sub) return undefined

    const canvas = document.createElement('canvas')
    canvas.width = tile.cellWidth
    canvas.height = tile.cellHeight
    const context = canvas.getContext('2d')
    if (!context) return undefined
    const image = context.createImageData(tile.cellWidth, tile.cellHeight)
    for (let pixel = 0; pixel < tile.cellWidth * tile.cellHeight; pixel++) {
      const index = sub.pixels[pixel] ?? 0
      if (index === 0) continue
      image.data[pixel * 4] = Math.min(255, (palette[index * 3] ?? 0) * 4)
      image.data[pixel * 4 + 1] = Math.min(255, (palette[index * 3 + 1] ?? 0) * 4)
      image.data[pixel * 4 + 2] = Math.min(255, (palette[index * 3 + 2] ?? 0) * 4)
      image.data[pixel * 4 + 3] = 255
    }
    context.putImageData(image, 0, 0)
    return canvas
  }
}

import { loadTheaterPalette, openOverlays, type OverlayAssets } from '@ra2web/assets'
import type { MapOverlay, Palette } from '@ra2web/formats'
import { paintShpFrame } from '@ra2web/render'
import { toCanvas } from './canvas-image.js'

/**
 * 覆盖物层：把一格的覆盖物画成画布，绘制时贴在该格的地块之上。
 *
 * 画布尺寸是图形的**整幅画布**（例如 `SROCK01` 是 120×120，石头本体只占中间 28×27），
 * 因此调用方按画布中心对齐格子中心 —— 与原版一致。
 */

export interface OverlayLayer {
  /** 该格的覆盖物画布；没有覆盖物或取不到美术时返回 undefined */
  canvasAt(overlay: MapOverlay | undefined): HTMLCanvasElement | undefined
}

export function openOverlayLayer(archiveBytes: Uint8Array, theaterName: string | undefined): OverlayLayer | undefined {
  if (!theaterName) return undefined
  const overlays = openOverlays(archiveBytes, theaterName)
  const palette = loadTheaterPalette(archiveBytes, theaterName, 'iso')
  if (!overlays || !palette) return undefined
  return createOverlayLayer(overlays, palette)
}

export function createOverlayLayer(overlays: OverlayAssets, palette: Palette): OverlayLayer {
  const cache = new Map<string, HTMLCanvasElement | undefined>()
  return {
    canvasAt(overlay) {
      if (!overlay) return undefined
      const key = `${overlay.id}:${overlay.data}`
      if (cache.has(key)) return cache.get(key)
      const art = overlays.loadOverlay(overlay)
      const canvas = art ? toCanvas(paintShpFrame(art.shp, art.frame, palette)) : undefined
      cache.set(key, canvas)
      return canvas
    },
  }
}

import type { RgbaImage } from '@ra2web/render'

/** RGBA 像素缓冲 → 画布。地块层与覆盖物层共用这一份转换。 */
export function toCanvas(image: RgbaImage): HTMLCanvasElement | undefined {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) return undefined
  const imageData = context.createImageData(image.width, image.height)
  imageData.data.set(image.rgba)
  context.putImageData(imageData, 0, 0)
  return canvas
}

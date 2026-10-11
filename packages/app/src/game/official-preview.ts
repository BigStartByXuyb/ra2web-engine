import type { MapFile } from '@ra2web/formats'

/**
 * 官方预览图：把地图档案自带的那张缩略图（24 位 RGB）画进面板里的画布。
 *
 * 它由原版自己渲染、存在地图档案里，因此可以直接当"官方原图"和我们画的地形对照。
 * 没有这张图时把整块藏起来，不留空框。
 */

export function drawOfficialPreview(box: HTMLElement, canvas: HTMLCanvasElement, map: MapFile): void {
  const preview = map.preview
  if (!preview) {
    box.hidden = true
    return
  }
  canvas.width = preview.width
  canvas.height = preview.height
  const context = canvas.getContext('2d')
  if (!context) {
    box.hidden = true
    return
  }
  const image = context.createImageData(preview.width, preview.height)
  for (let pixel = 0; pixel < preview.width * preview.height; pixel++) {
    image.data[pixel * 4] = preview.rgb[pixel * 3]!
    image.data[pixel * 4 + 1] = preview.rgb[pixel * 3 + 1]!
    image.data[pixel * 4 + 2] = preview.rgb[pixel * 3 + 2]!
    image.data[pixel * 4 + 3] = 255
  }
  context.putImageData(image, 0, 0)
  box.hidden = false
}

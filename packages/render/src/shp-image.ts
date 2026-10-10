import { paletteColor, type Palette, type ShpFile, type ShpFrame } from '@ra2web/formats'
import type { RgbaImage } from './image.js'

/**
 * SHP 帧上色：把某一帧贴进它所属图形的整幅画布（`width × height`），再交给调用方定位。
 *
 * 帧自带的 `x` / `y` 就是它在画布里的位置（例如 `SROCK01` 是 120×120 的画布，
 * 岩石本体只有 28×27，落在 (48,41)）。索引 `0` 是透明，画布其余部分保持 alpha = 0。
 */
export function paintShpFrame(shp: ShpFile, frame: ShpFrame, palette: Palette): RgbaImage {
  const rgba = new Uint8Array(shp.width * shp.height * 4)
  if (frame.isEmpty) return { width: shp.width, height: shp.height, rgba }

  for (let y = 0; y < frame.height; y++) {
    const targetY = frame.y + y
    if (targetY < 0 || targetY >= shp.height) continue
    for (let x = 0; x < frame.width; x++) {
      const targetX = frame.x + x
      if (targetX < 0 || targetX >= shp.width) continue
      const index = frame.pixels[y * frame.width + x] ?? 0
      if (index === 0) continue
      const color = paletteColor(palette, index)
      const at = (targetY * shp.width + targetX) * 4
      rgba[at] = color.r
      rgba[at + 1] = color.g
      rgba[at + 2] = color.b
      rgba[at + 3] = 255
    }
  }
  return { width: shp.width, height: shp.height, rgba }
}

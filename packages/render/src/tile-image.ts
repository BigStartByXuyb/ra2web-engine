import { paletteColor, tmpTileRows, type Palette, type TmpFile, type TmpSubTile } from '@ra2web/formats'
import type { RgbaImage } from './image.js'

/**
 * 地块子块上色：TMP 的菱形像素 + theater 调色板 → RGBA 图。
 *
 * 透明索引是 `0`（原版客户端只在索引非 0 时写入），菱形之外的位置保持 alpha = 0。
 * 像素在子块里的排布由 `tmpTileRows` 给出，这里只负责取色与落像素。
 */

export const TILE_TRANSPARENT_INDEX = 0

export function paintTmpSubTile(tile: TmpFile, sub: TmpSubTile, palette: Palette): RgbaImage {
  const { cellWidth, cellHeight } = tile
  const rgba = new Uint8Array(cellWidth * cellHeight * 4)
  let source = 0
  for (const row of tmpTileRows(cellWidth, cellHeight)) {
    for (let offset = 0; offset < row.width; offset++) {
      const index = sub.pixels[source++] ?? TILE_TRANSPARENT_INDEX
      if (index === TILE_TRANSPARENT_INDEX) continue
      const color = paletteColor(palette, index)
      const at = (row.y * cellWidth + row.x + offset) * 4
      rgba[at] = color.r
      rgba[at + 1] = color.g
      rgba[at + 2] = color.b
      rgba[at + 3] = 255
    }
  }
  return { width: cellWidth, height: cellHeight, rgba }
}

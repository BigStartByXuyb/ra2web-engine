import { blitImage, fillImage, type Rgba, type RgbaImage } from './image.js'
import type { VoxelSprite } from './voxel-sprite.js'

/** 横向拼图：把多档朝向按贴地锚点对齐拼成一条，便于逐档比对与页面展示。 */
export function composeSpriteStrip(sprites: readonly VoxelSprite[], background: Rgba): RgbaImage {
  if (sprites.length === 0) return { width: 0, height: 0, rgba: new Uint8Array(0) }

  const width = sprites.reduce((total, sprite) => total + sprite.width, 0)
  const groundY = Math.max(...sprites.map((sprite) => sprite.anchorY))
  const height = groundY + Math.max(...sprites.map((sprite) => sprite.height - sprite.anchorY))
  const strip: RgbaImage = { width, height, rgba: new Uint8Array(width * height * 4) }
  fillImage(strip.rgba, background)

  let atX = 0
  for (const sprite of sprites) {
    blitImage(strip, sprite, atX, groundY - sprite.anchorY)
    atX += sprite.width
  }
  return strip
}

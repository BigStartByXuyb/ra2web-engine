import { loadTheaterPalette, openStructures, type StructureAssets } from '@ra2web/assets'
import type { MapPlacement, Palette } from '@ra2web/formats'
import { paintShpFrame } from '@ra2web/render'
import { toCanvas } from './canvas-image.js'

/**
 * 建筑层：地图预置的建筑 → 画布。
 *
 * 画布尺寸是图形的整幅画布（例如民房是 72×48），摆放时按**地基中心**对齐格子中心：
 * 地基 3×3 的房子以它覆盖的 9 格中心为锚点 —— 与原版一致。
 *
 * 色板按 art.ini 的标记选：默认用**单位色板**（`unitsno.pal` 一类），只有标了
 * `TerrainPalette` / `ShouldUseCellDrawer` 才改用地形色板 —— 与客户端一致。
 */

export interface StructureSprite {
  readonly placement: MapPlacement
  readonly canvas: HTMLCanvasElement
  readonly foundationWidth: number
  readonly foundationHeight: number
}

export interface StructureLayer {
  /** 该建筑在本格上的贴图；取不到美术时返回 undefined */
  spriteAt(placement: MapPlacement): StructureSprite | undefined
}

export function openStructureLayer(
  archiveBytes: Uint8Array,
  theaterName: string | undefined,
): StructureLayer | undefined {
  if (!theaterName) return undefined
  const structures = openStructures(archiveBytes, theaterName)
  const unitPalette = loadTheaterPalette(archiveBytes, theaterName, 'unit')
  const terrainPalette = loadTheaterPalette(archiveBytes, theaterName, 'iso')
  if (!structures || !unitPalette || !terrainPalette) return undefined
  return createStructureLayer(structures, { unit: unitPalette, terrain: terrainPalette })
}

export interface StructurePalettes {
  readonly unit: Palette
  readonly terrain: Palette
}

export function createStructureLayer(structures: StructureAssets, palettes: StructurePalettes): StructureLayer {
  // 按类型缓存画布与地基（同一类型只画一次图），摆放信息每次按当前格子组装
  const cache = new Map<
    string,
    { canvas: HTMLCanvasElement; foundationWidth: number; foundationHeight: number } | undefined
  >()
  return {
    spriteAt(placement) {
      const key = placement.type.toLowerCase()
      if (!cache.has(key)) {
        const art = structures.loadStructure(placement.type)
        const frame = art?.shp.frames.find((candidate) => !candidate.isEmpty)
        const palette = art?.useTerrainPalette ? palettes.terrain : palettes.unit
        const canvas = art && frame ? toCanvas(paintShpFrame(art.shp, frame, palette)) : undefined
        cache.set(
          key,
          canvas && art
            ? { canvas, foundationWidth: art.foundationWidth, foundationHeight: art.foundationHeight }
            : undefined,
        )
      }
      const painted = cache.get(key)
      return painted ? { placement, ...painted } : undefined
    },
  }
}

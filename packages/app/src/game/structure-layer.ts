import { loadTheaterPalette, openStructures, type AssetOverride, type StructureAssets } from '@ra2web/assets'
import type { MapPlacement, Palette } from '@ra2web/formats'
import { paintShpFrame } from '@ra2web/render'
import { toCanvas } from './canvas-image.js'
import { decodePng } from './png-image.js'

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
  /** art.ini `YSortAdjust=`：参与统一等距深度键，缺省 0 */
  readonly ySortAdjust: number
}

export interface StructureLayer {
  /** 该建筑在本格上的贴图；取不到美术时返回 undefined */
  spriteAt(placement: MapPlacement): StructureSprite | undefined
}

export async function openStructureLayer(
  archiveBytes: Uint8Array,
  theaterName: string | undefined,
  overrides?: readonly AssetOverride[],
  structureTypes: readonly string[] = [],
): Promise<StructureLayer | undefined> {
  if (!theaterName) return undefined
  const structures = openStructures(archiveBytes, theaterName, overrides)
  const unitPalette = loadTheaterPalette(archiveBytes, theaterName, 'unit')
  const terrainPalette = loadTheaterPalette(archiveBytes, theaterName, 'iso')
  if (!structures || !unitPalette || !terrainPalette) return undefined
  // 素材包里的真彩贴图要先解码（异步），所以这里按地图上出现的类型逐个备好
  const pngCanvases = new Map<string, HTMLCanvasElement>()
  for (const type of new Set(structureTypes.map((name) => name.toLowerCase()))) {
    const art = structures.loadStructure(type)
    const pngBytes = art?.pngBytes
    if (pngBytes) pngCanvases.set(type, await decodePng(pngBytes))
  }
  return createStructureLayer(structures, { unit: unitPalette, terrain: terrainPalette }, pngCanvases)
}

export interface StructurePalettes {
  readonly unit: Palette
  readonly terrain: Palette
}

export function createStructureLayer(
  structures: StructureAssets,
  palettes: StructurePalettes,
  pngCanvases: ReadonlyMap<string, HTMLCanvasElement> = new Map(),
): StructureLayer {
  // 按类型缓存画布与地基（同一类型只画一次图），摆放信息每次按当前格子组装
  interface Painted {
    readonly canvas: HTMLCanvasElement
    readonly foundationWidth: number
    readonly foundationHeight: number
    readonly ySortAdjust: number
  }
  const cache = new Map<string, Painted | undefined>()

  /** 取美术：素材包给了真彩 PNG 就用它，否则用原版 SHP 按色板上色。 */
  function paint(key: string, typeName: string): Painted | undefined {
    const art = structures.loadStructure(typeName)
    if (!art) return undefined
    const png = pngCanvases.get(key)
    if (png) {
      return {
        canvas: png,
        foundationWidth: art.foundationWidth,
        foundationHeight: art.foundationHeight,
        ySortAdjust: art.ySortAdjust,
      }
    }
    const frame = art.shp?.frames.find((candidate) => !candidate.isEmpty)
    if (!art.shp || !frame) return undefined
    const palette = art.useTerrainPalette ? palettes.terrain : palettes.unit
    const canvas = toCanvas(paintShpFrame(art.shp, frame, palette))
    if (!canvas) return undefined
    return {
      canvas,
      foundationWidth: art.foundationWidth,
      foundationHeight: art.foundationHeight,
      ySortAdjust: art.ySortAdjust,
    }
  }

  return {
    spriteAt(placement) {
      const key = placement.type.toLowerCase()
      if (!cache.has(key)) cache.set(key, paint(key, placement.type))
      const painted = cache.get(key)
      return painted ? { placement, ...painted } : undefined
    },
  }
}

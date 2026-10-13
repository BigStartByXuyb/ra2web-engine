import { paletteColor, type Palette } from '@ra2web/formats'
import { landTypeOfTerrainType, type LandTypeName } from '@ra2web/assets'

/**
 * 地貌线任务 1：地块类型 → 程序化 PBR 材质的**颜色证据**。
 *
 * albedo/方差从剧场调色板 + TMP 子块像素**采样**（原版档案真实数据，`readPalette` 口径，
 * 见 `docs/ENGINE-MAP.md`「TMP 地块与 theater 资源」）；roughness/metallic/噪声尺度没有
 * 原版证据可取（原版是索引色贴图，无材质概念），是**本项目自定**的观感调校，集中在
 * `TERRAIN_PBR_STYLE` 一张表里，注明自定，不许写"原版如此"。
 */

export interface MaterialSampleInput {
  /** TMP 子块的 terrainType 字节（`packages/formats/src/tmp.ts` 头 41 偏移） */
  readonly terrainType: number
  /** 该子块菱形像素的调色板索引；0 = 透明（原版约定），不计入统计 */
  readonly pixelIndices: Uint8Array
}

/** 一种地块类型的采样结果：albedo 均值与每通道标准差（0..1 线性）。 */
export interface TerrainMaterial {
  readonly albedo: readonly [number, number, number]
  readonly variance: readonly [number, number, number]
}

/** 采样器入口：调用方把剧场全部子块喂进来（场景工厂负责按剧场名缓存）。 */
export function sampleTerrainMaterials(
  inputs: Iterable<MaterialSampleInput>,
  palette: Palette,
): ReadonlyMap<LandTypeName, TerrainMaterial> {
  const sums = new Map<
    LandTypeName,
    { count: number; r: number; g: number; b: number; rr: number; gg: number; bb: number }
  >()
  for (const input of inputs) {
    const landType = landTypeOfTerrainType(input.terrainType)
    if (!landType) continue
    let bucket = sums.get(landType)
    if (!bucket) sums.set(landType, (bucket = { count: 0, r: 0, g: 0, b: 0, rr: 0, gg: 0, bb: 0 }))
    for (const index of input.pixelIndices) {
      if (index === 0) continue
      const color = paletteColor(palette, index)
      const r = color.r / 255
      const g = color.g / 255
      const b = color.b / 255
      bucket.count++
      bucket.r += r
      bucket.g += g
      bucket.b += b
      bucket.rr += r * r
      bucket.gg += g * g
      bucket.bb += b * b
    }
  }
  const materials = new Map<LandTypeName, TerrainMaterial>()
  for (const [landType, bucket] of sums) {
    if (bucket.count === 0) continue
    const mean = [bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count]
    const square = [bucket.rr / bucket.count, bucket.gg / bucket.count, bucket.bb / bucket.count]
    materials.set(landType, {
      albedo: [mean[0]!, mean[1]!, mean[2]!],
      // E[x2] − E[x]2 的算术下界在浮点里可能是负零/极小负数，夹到 0
      variance: [0, 1, 2].map((channel) => Math.sqrt(Math.max(0, square[channel]! - mean[channel]! ** 2))) as [
        number,
        number,
        number,
      ],
    })
  }
  return materials
}

/**
 * 本项目自定：地块类型 → PBR 观感参数（无原版证据；原版无材质概念）。
 * 调校目标：对照 docs/ART-ROADMAP.md 风格基准图的泥泞/雪层/湿地质感 —— 水面最亮泽，
 * 冰雪次之，土路/岩壁哑光。改观感只动这张表。
 */
export const TERRAIN_PBR_STYLE: Readonly<
  Record<LandTypeName, { roughness: number; metallic: number; noiseScale: number }>
> = {
  Clear: { roughness: 0.92, metallic: 0.0, noiseScale: 0.08 },
  Road: { roughness: 0.78, metallic: 0.0, noiseScale: 0.05 },
  Rock: { roughness: 0.88, metallic: 0.0, noiseScale: 0.11 },
  Beach: { roughness: 0.85, metallic: 0.0, noiseScale: 0.06 },
  Rough: { roughness: 0.95, metallic: 0.0, noiseScale: 0.12 },
  Railroad: { roughness: 0.7, metallic: 0.1, noiseScale: 0.04 },
  Weeds: { roughness: 0.9, metallic: 0.0, noiseScale: 0.1 },
  Water: { roughness: 0.12, metallic: 0.0, noiseScale: 0.03 },
  Wall: { roughness: 0.8, metallic: 0.05, noiseScale: 0.07 },
  Tiberium: { roughness: 0.35, metallic: 0.2, noiseScale: 0.09 },
  Cliff: { roughness: 0.9, metallic: 0.0, noiseScale: 0.14 },
}

/** 未认识 terrainType / 采样为空时的回退档：中性土绿，别让画面出现 NaN 黑。本项目自定。 */
export function fallbackMaterial(): TerrainMaterial {
  return { albedo: [0.42, 0.46, 0.35], variance: [0.02, 0.02, 0.02] }
}

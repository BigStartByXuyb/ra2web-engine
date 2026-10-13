import { buildTerrainMesh, RA2_ISO_VIEW, type TerrainFace } from '@ra2web/render'
import type { MapCell } from '@ra2web/formats'
import type { CliffSetKind, LandTypeName } from '@ra2web/assets'
import type { MapPreview } from './map-preview.js'
import { fallbackMaterial, TERRAIN_PBR_STYLE, type TerrainMaterial, type TerrainMaterialKey } from './terrain3d-materials.js'

/**
 * 地貌线任务 1：把 `buildTerrainMesh` 的面片转成带 z/法线/材质的 3D 顶点。
 *
 * 几何权威只有一处（`packages/render/src/terrain-mesh.ts`，网格与"不留缝"判据都在那）；
 * 这里只做换算。face corner 是"世界 y 已减 z"的屏幕坐标，反推 `worldY = corner.y + z_corner`；
 * 由此崖壁上下角 worldY 自动相等（竖直面）—— 单测钉的就是这条。
 *
 * 顶点交错 13 float：pos(3) + normal(3) + albedo(3) + roughness(1) + variance(1) + topZ(1) + waterFlag(1)。
 * topZ = 该面顶部的 z（墙面用来做「距崖顶」的接触带压暗；顶面同 z，无影响）。
 * waterFlag = 水格顶面 1（任务 3：着色器走水面分支）；崖壁与陆地恒 0。
 */

export const STRIDE = 13

export interface Terrain3dVertexData {
  readonly vertices: Float32Array
  readonly vertexCount: number
}

export function buildTerrain3dGeometry(
  preview: MapPreview,
  zStep: number,
  landTypeAt: (cellX: number, cellY: number) => LandTypeName | 'Unknown',
  materials: ReadonlyMap<TerrainMaterialKey, TerrainMaterial> | undefined,
  cliffKindAt?: (cellX: number, cellY: number) => CliffSetKind | undefined,
  rampTypeAt?: (cellX: number, cellY: number) => number,
): Terrain3dVertexData {
  const cells = [...preview.cellByIndex.values()] as readonly MapCell[]
  const levelByIndex = new Map<number, number>()
  for (const cell of cells) levelByIndex.set(cell.cellY * preview.width + cell.cellX, cell.z)
  const faces = buildTerrainMesh({
    view: RA2_ISO_VIEW,
    zStep,
    cells,
    levelAt: (cellX, cellY) => levelByIndex.get(cellY * preview.width + cellX),
    rampTypeAt,
  })
  const chunks: number[][] = []
  let total = 0
  // 边界混合（本项目自定）：共享角把相邻格 albedo 均值，地块边界不再是硬色块；岸线湿边在角级做
  const blends = buildCornerBlends(preview, landTypeAt, materials)
  for (const face of faces) {
    const zs = face.zs
    const material = materialFor(face, landTypeAt, materials, cliffKindAt)
    const faceCorners =
      face.kind === 'top' ? cornerKeys(face.cellX, face.cellY) : undefined
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const corner = face.corners[index]!
      const z = zs[index]!
      const normal = faceNormal(face)
      let albedo = material.albedo
      if (faceCorners) {
        const blend = blends.get(`${faceCorners[index]![0]},${faceCorners[index]![1]}`)
        if (blend) {
          // 岸线湿边：Beach 格的角若共享了 Water 格 → 先混合再整体压暗 ×0.85（本项目自定）
          const wet = blend.hasWater && landTypeAt(face.cellX, face.cellY) === 'Beach' ? 0.85 : 1
          albedo = [blend.albedo[0] * wet, blend.albedo[1] * wet, blend.albedo[2] * wet]
        }
      }
      chunks.push([
        corner.x,
        corner.y + z,
        z,
        normal[0],
        normal[1],
        normal[2],
        albedo[0],
        albedo[1],
        albedo[2],
        material.roughness,
        material.variance[0],
        faceTopZ(face, zs),
        face.kind === 'top' && landTypeAt(face.cellX, face.cellY) === 'Water' ? 1 : 0,
      ])
      total++
    }
  }
  const vertices = new Float32Array(total * STRIDE)
  let cursor = 0
  for (const chunk of chunks) {
    vertices.set(chunk, cursor)
    cursor += STRIDE
  }
  return { vertices, vertexCount: total }
}

function materialFor(
  face: TerrainFace,
  landTypeAt: (cellX: number, cellY: number) => LandTypeName | 'Unknown',
  materials: ReadonlyMap<TerrainMaterialKey, TerrainMaterial> | undefined,
  cliffKindAt?: (cellX: number, cellY: number) => CliffSetKind | undefined,
): { albedo: readonly [number, number, number]; roughness: number; variance: readonly [number, number, number] } {
  const landType = landTypeAt(face.cellX, face.cellY)
  // 墙面优先崖集档（CliffSet/WaterCliffs/DestroyableCliffs 各自采样，任务 2），未命中回落本格类型
  const cliffKind = face.kind === 'wall' ? cliffKindAt?.(face.cellX, face.cellY) : undefined
  const sampled =
    (cliffKind !== undefined ? materials?.get(cliffKind) : undefined) ??
    (landType !== 'Unknown' ? materials?.get(landType) : undefined) ??
    fallbackMaterial()
  // 崖壁一律 Cliff 档 roughness（任务 2「崖壁与过渡」再细化）；顶面按格类型，未认识编号回 Clear
  const style =
    (face.kind === 'wall' ? TERRAIN_PBR_STYLE.Cliff : landType !== 'Unknown' ? TERRAIN_PBR_STYLE[landType] : undefined) ??
    TERRAIN_PBR_STYLE.Clear
  return { albedo: sampled.albedo, roughness: style.roughness, variance: sampled.variance }
}

/** 面法线：顶面朝上；崖壁取上棱（corners[0]→corners[1]）的水平外法线（符号朝"远离格中心"一侧）。 */
function faceNormal(face: TerrainFace): [number, number, number] {
  if (face.kind === 'top') return [0, 0, 1]
  const from = face.corners[0]!
  const to = face.corners[1]!
  const edge = { x: to.x - from.x, y: to.y - from.y }
  let nx = -edge.y
  let ny = edge.x
  const length = Math.hypot(nx, ny) || 1
  nx /= length
  ny /= length
  // 面中心 = 对角线（上左→下右）中点；上棱中点在菱形边界上，"边界 − 中心"即朝外方向
  const centerX = (face.corners[0]!.x + face.corners[2]!.x) / 2
  const centerY = (face.corners[0]!.y + face.corners[2]!.y) / 2
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  if (nx * (midX - centerX) + ny * (midY - centerY) < 0) {
    nx = -nx
    ny = -ny
  }
  return [nx, ny, 0]
}

/** 一格四角的共享角键（奇数格坐标系的点）：NW/NE/SE/SW，与 terrain-mesh 的角序一致。 */
function cornerKeys(cellX: number, cellY: number): [number, number][] {
  return [
    [cellX * 2 - 1, cellY * 2 - 1],
    [cellX * 2 + 1, cellY * 2 - 1],
    [cellX * 2 + 1, cellY * 2 + 1],
    [cellX * 2 - 1, cellY * 2 + 1],
  ]
}

/**
 * 共享角材质混合表（本项目自定）：每个**菱形角点**把共享它的全部在图格的顶面 albedo 均值；
 * Beach 角若共享了 Water 格 → 整角乘 0.85（湿边压暗，岸线过渡）。只混 albedo，
 * roughness/variance 仍按本格，避免边界处材质行为漂移。
 */
function buildCornerBlends(
  preview: MapPreview,
  landTypeAt: (cellX: number, cellY: number) => LandTypeName | 'Unknown',
  materials: ReadonlyMap<TerrainMaterialKey, TerrainMaterial> | undefined,
): Map<string, { albedo: [number, number, number]; hasWater: boolean }> {
  const sums = new Map<string, { r: number; g: number; b: number; n: number; water: number }>()
  for (const cell of preview.cellByIndex.values()) {
    const landType = landTypeAt(cell.cellX, cell.cellY)
    const material = (landType !== 'Unknown' ? materials?.get(landType) : undefined) ?? fallbackMaterial()
    const isWater = landType === 'Water'
    for (const [kx, ky] of cornerKeys(cell.cellX, cell.cellY)) {
      let bucket = sums.get(`${kx},${ky}`)
      if (!bucket) sums.set(`${kx},${ky}`, (bucket = { r: 0, g: 0, b: 0, n: 0, water: 0 }))
      bucket.r += material.albedo[0]
      bucket.g += material.albedo[1]
      bucket.b += material.albedo[2]
      bucket.n++
      if (isWater) bucket.water++
    }
  }
  const blends = new Map<string, { albedo: [number, number, number]; hasWater: boolean }>()
  for (const [key, bucket] of sums) {
    const [r, g, b] = [bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n]
    // 湿边判定按"本角被哪个格用"——blend 表只存 hasWater，压暗在取用时只对 Beach 格生效
    blends.set(key, { albedo: [r, g, b], hasWater: bucket.water > 0 })
  }
  return blends
}

/** 该面顶部的 z：墙面取上两角（顺序 上左/上右/下右/下左），顶面四角同高取 zs[0]。 */
function faceTopZ(face: TerrainFace, zs: readonly number[]): number {
  return face.kind === 'wall' ? Math.max(zs[0]!, zs[1]!) : zs[0]!
}

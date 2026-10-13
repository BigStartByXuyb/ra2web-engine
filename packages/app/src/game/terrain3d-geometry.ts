import { buildTerrainMesh, RA2_ISO_VIEW, type TerrainFace } from '@ra2web/render'
import type { MapCell } from '@ra2web/formats'
import type { LandTypeName } from '@ra2web/assets'
import type { MapPreview } from './map-preview.js'
import { fallbackMaterial, TERRAIN_PBR_STYLE, type TerrainMaterial } from './terrain3d-materials.js'

/**
 * 地貌线任务 1：把 `buildTerrainMesh` 的面片转成带 z/法线/材质的 3D 顶点。
 *
 * 几何权威只有一处（`packages/render/src/terrain-mesh.ts`，网格与"不留缝"判据都在那）；
 * 这里只做换算。face corner 是"世界 y 已减 z"的屏幕坐标，反推 `worldY = corner.y + z_corner`；
 * 由此崖壁上下角 worldY 自动相等（竖直面）—— 单测钉的就是这条。
 *
 * 顶点交错 11 float：pos(3) + normal(3) + albedo(3) + roughness(1) + variance(1)。
 */

export const STRIDE = 11

export interface Terrain3dVertexData {
  readonly vertices: Float32Array
  readonly vertexCount: number
}

export function buildTerrain3dGeometry(
  preview: MapPreview,
  zStep: number,
  landTypeAt: (cellX: number, cellY: number) => LandTypeName | 'Unknown',
  materials: ReadonlyMap<LandTypeName, TerrainMaterial> | undefined,
): Terrain3dVertexData {
  const cells = [...preview.cellByIndex.values()] as readonly MapCell[]
  const levelByIndex = new Map<number, number>()
  for (const cell of cells) levelByIndex.set(cell.cellY * preview.width + cell.cellX, cell.z)
  const faces = buildTerrainMesh({
    view: RA2_ISO_VIEW,
    zStep,
    cells,
    levelAt: (cellX, cellY) => levelByIndex.get(cellY * preview.width + cellX),
  })
  const chunks: number[][] = []
  let total = 0
  for (const face of faces) {
    const zs = faceZs(face, levelByIndex, preview, zStep)
    const material = materialFor(face, landTypeAt, materials)
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const corner = face.corners[index]!
      const z = zs[index]!
      const normal = faceNormal(face)
      chunks.push([
        corner.x,
        corner.y + z,
        z,
        normal[0],
        normal[1],
        normal[2],
        material.albedo[0],
        material.albedo[1],
        material.albedo[2],
        material.roughness,
        material.variance[0],
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

/** 每角 z：顶面四角同高；崖壁下两角 = 上两角 z − drop（drop 由 y 差恢复，见模块注释）。 */
function faceZs(
  face: TerrainFace,
  levelByIndex: Map<number, number>,
  preview: MapPreview,
  zStep: number,
): [number, number, number, number] {
  const zTop = (levelByIndex.get(face.cellY * preview.width + face.cellX) ?? 0) * zStep
  if (face.kind === 'top') return [zTop, zTop, zTop, zTop]
  const drop = face.corners[2]!.y - face.corners[1]!.y
  return [zTop, zTop, zTop - drop, zTop - drop]
}

function materialFor(
  face: TerrainFace,
  landTypeAt: (cellX: number, cellY: number) => LandTypeName | 'Unknown',
  materials: ReadonlyMap<LandTypeName, TerrainMaterial> | undefined,
): { albedo: readonly [number, number, number]; roughness: number; variance: readonly [number, number, number] } {
  const landType = landTypeAt(face.cellX, face.cellY)
  const sampled = (landType !== 'Unknown' ? materials?.get(landType) : undefined) ?? fallbackMaterial()
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

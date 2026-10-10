import { readPalette, type Palette, type VxlModel } from '@ra2web/formats'

/**
 * 体素定位：把 VXL 各节的局部体素按节的包围盒平移拼成整机坐标，再归一化到原点。
 *
 * 节的 bounds 已经给出该节在整机空间中的位置（例如炮塔 min.z 正好接在机体 max.z 之上），
 * 因此只按 bounds.min 平移即可，不需要任何手工偏移表。
 */

export interface PositionedVoxel {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly colorIndex: number
  readonly normalIndex: number
}

export interface PositionedModel {
  readonly voxels: readonly PositionedVoxel[]
  /** 归一化后的尺寸，单位是体素 */
  readonly spanX: number
  readonly spanY: number
  readonly spanZ: number
  readonly palette: Palette | undefined
}

export interface VoxelBounds {
  readonly minX: number
  readonly minY: number
  readonly minZ: number
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
}

export interface VoxelPoint {
  readonly x: number
  readonly y: number
  readonly z: number
}

export function positionVoxelModel(models: readonly VxlModel[]): PositionedModel {
  const placed: PositionedVoxel[] = []
  for (const model of models) placed.push(...placeSections(model))
  const palette = readEmbeddedPalette(models)
  if (placed.length === 0) return { voxels: [], spanX: 0, spanY: 0, spanZ: 0, palette }

  const bounds = modelBounds(placed)
  const voxels = placed.map((voxel) => ({
    ...voxel,
    x: voxel.x - bounds.minX,
    y: voxel.y - bounds.minY,
    z: voxel.z - bounds.minZ,
  }))
  return {
    voxels,
    spanX: bounds.maxX - bounds.minX + 1,
    spanY: bounds.maxY - bounds.minY + 1,
    spanZ: bounds.maxZ - bounds.minZ + 1,
    palette,
  }
}

export function modelBounds(voxels: readonly PositionedVoxel[]): VoxelBounds {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const voxel of voxels) {
    if (voxel.x < minX) minX = voxel.x
    if (voxel.y < minY) minY = voxel.y
    if (voxel.z < minZ) minZ = voxel.z
    if (voxel.x > maxX) maxX = voxel.x
    if (voxel.y > maxY) maxY = voxel.y
    if (voxel.z > maxZ) maxZ = voxel.z
  }
  return { minX, minY, minZ, maxX, maxY, maxZ }
}

/**
 * 模型枢轴：水平取包围盒中心、竖直取底面（贴地点）。
 *
 * 旋转与贴图对齐都必须用它：包围盒中心在 45° 档会随形状变化，只有这个点在所有朝向下不动。
 */
export function groundPivot(bounds: VoxelBounds): VoxelPoint {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, z: bounds.minZ }
}

function placeSections(model: VxlModel): readonly PositionedVoxel[] {
  const placed: PositionedVoxel[] = []
  for (const section of model.sections) {
    const offsetX = Math.round(section.bounds.min[0])
    const offsetY = Math.round(section.bounds.min[1])
    const offsetZ = Math.round(section.bounds.min[2])
    for (const voxel of section.voxels) {
      placed.push({
        x: voxel.x + offsetX,
        y: voxel.y + offsetY,
        z: voxel.z + offsetZ,
        colorIndex: voxel.colorIndex,
        normalIndex: voxel.normalIndex,
      })
    }
  }
  return placed
}

/** 多个模型（机体 + 炮塔）取第一份内嵌调色板：同一辆车的各节共用同一套颜色。 */
function readEmbeddedPalette(models: readonly VxlModel[]): Palette | undefined {
  for (const model of models) {
    if (model.embeddedPalette) return readPalette(model.embeddedPalette)
  }
  return undefined
}

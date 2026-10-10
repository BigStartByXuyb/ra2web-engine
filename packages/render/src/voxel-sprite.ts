import { paletteColor, type Palette, type Rgb } from '@ra2web/formats'
import { fillImage, type Rgba } from './image.js'
import { DEFAULT_LIGHT, shadeColor, type Vec3 } from './shading.js'
import { groundPivot, modelBounds, type PositionedModel, type PositionedVoxel, type VoxelPoint } from './voxel-model.js'

/**
 * 体素光栅化：把整机坐标的体素投影成一张等距精灵（RGBA），供地图层直接贴图。
 *
 * 未核对：朝向编号与原版精灵朝向的对应关系（哪一档是正北）、法线表、着色系数。
 * 投影本身是固定 2:1 等距，与 `iso.ts` 的地块投影同一比例。
 *
 * 贴图定位：精灵按内容裁剪，各档的 anchor 自然不同；
 * `originX + anchorX`（Y 同理）是不随朝向变化的枢轴投影位置，对齐时用它校验。
 */

/** 原版单位精灵是 8 个朝向，每档 45°。 */
export const FACING_COUNT = 8

export interface VoxelSpriteOptions {
  readonly facing: number
  readonly pixelsPerVoxel: number
  readonly light?: Vec3
  readonly background?: Rgba
  readonly paddingInVoxels?: number
}

export interface VoxelSprite {
  readonly facing: number
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
  /** 精灵左上角在投影坐标里的位置 */
  readonly originX: number
  readonly originY: number
  /** 贴地枢轴在精灵内的像素坐标：贴到格中心时用格中心减去它 */
  readonly anchorX: number
  readonly anchorY: number
}

interface ProjectedVoxel {
  readonly voxel: PositionedVoxel
  readonly screenX: number
  readonly screenY: number
}

interface ScreenPoint {
  readonly screenX: number
  readonly screenY: number
}

interface SpriteLayout {
  readonly width: number
  readonly height: number
  readonly originX: number
  readonly originY: number
  readonly anchorX: number
  readonly anchorY: number
  readonly pixelsPerVoxel: number
  readonly paddingPixels: number
}

const EMPTY_SPRITE = { width: 0, height: 0, originX: 0, originY: 0, anchorX: 0, anchorY: 0 }
const FALLBACK_COLOR: Rgb = { r: 200, g: 200, b: 200 }

export function renderVoxelSprite(model: PositionedModel, options: VoxelSpriteOptions): VoxelSprite {
  const pixelsPerVoxel = Math.max(1, Math.round(options.pixelsPerVoxel))
  const paddingPixels = Math.max(0, Math.round(options.paddingInVoxels ?? 1)) * pixelsPerVoxel
  const facing = normalizeFacing(options.facing)
  if (model.voxels.length === 0) return { facing, rgba: new Uint8Array(0), ...EMPTY_SPRITE }

  const pivot = groundPivot(modelBounds(model.voxels))
  const rotated = rotateVoxels(model.voxels, facing, pivot)
  const projected = rotated.map((voxel) => ({ voxel, ...project(voxel.x, voxel.y, voxel.z, pixelsPerVoxel) }))
  const pivotScreen = project(pivot.x, pivot.y, pivot.z, pixelsPerVoxel)
  const layout = layoutSprite(projected, pivotScreen, pixelsPerVoxel, paddingPixels)

  const rgba = new Uint8Array(layout.width * layout.height * 4)
  if (options.background) fillImage(rgba, options.background)
  drawProjected(rgba, layout, projected, model.palette, options.light ?? DEFAULT_LIGHT)
  return {
    facing,
    width: layout.width,
    height: layout.height,
    rgba,
    originX: layout.originX,
    originY: layout.originY,
    anchorX: layout.anchorX,
    anchorY: layout.anchorY,
  }
}

export function normalizeFacing(facing: number): number {
  const rounded = Math.round(facing)
  return ((rounded % FACING_COUNT) + FACING_COUNT) % FACING_COUNT
}

/** 2:1 等距投影：与 `iso.ts` 的地块比例一致，只是尺度换成体素。 */
function project(x: number, y: number, z: number, pixelsPerVoxel: number): ScreenPoint {
  return {
    screenX: Math.round((x - y) * pixelsPerVoxel),
    screenY: Math.round(((x + y) / 2 - z) * pixelsPerVoxel),
  }
}

/** 绕枢轴旋转：枢轴是模型自身的点，各朝向都以它为中心，位置不会漂移。 */
function rotateVoxels(
  voxels: readonly PositionedVoxel[],
  facing: number,
  pivot: VoxelPoint,
): readonly PositionedVoxel[] {
  if (facing === 0) return voxels
  const angle = (facing * Math.PI * 2) / FACING_COUNT
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return voxels.map((voxel) => ({
    x: Math.round(pivot.x + (voxel.x - pivot.x) * cos - (voxel.y - pivot.y) * sin),
    y: Math.round(pivot.y + (voxel.x - pivot.x) * sin + (voxel.y - pivot.y) * cos),
    z: voxel.z,
    colorIndex: voxel.colorIndex,
    normalIndex: voxel.normalIndex,
  }))
}

function layoutSprite(
  projected: readonly ProjectedVoxel[],
  pivotScreen: ScreenPoint,
  pixelsPerVoxel: number,
  paddingPixels: number,
): SpriteLayout {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const item of projected) {
    if (item.screenX < minX) minX = item.screenX
    if (item.screenX > maxX) maxX = item.screenX
    if (item.screenY < minY) minY = item.screenY
    if (item.screenY > maxY) maxY = item.screenY
  }
  return {
    width: maxX - minX + pixelsPerVoxel + paddingPixels * 2,
    height: maxY - minY + pixelsPerVoxel + paddingPixels * 2,
    originX: minX,
    originY: minY,
    anchorX: pivotScreen.screenX - minX + paddingPixels,
    anchorY: pivotScreen.screenY - minY + paddingPixels,
    pixelsPerVoxel,
    paddingPixels,
  }
}

/** 画家算法：先画远后画近。(x+y) 越大越靠近观察者，同一柱内 z 越大越靠前。 */
function sortFarToNear(projected: readonly ProjectedVoxel[]): readonly ProjectedVoxel[] {
  return [...projected].sort(
    (left, right) => left.voxel.x + left.voxel.y - (right.voxel.x + right.voxel.y) || left.voxel.z - right.voxel.z,
  )
}

function drawProjected(
  rgba: Uint8Array,
  layout: SpriteLayout,
  projected: readonly ProjectedVoxel[],
  palette: Palette | undefined,
  light: Vec3,
): void {
  for (const item of sortFarToNear(projected)) {
    const base = palette ? paletteColor(palette, item.voxel.colorIndex) : FALLBACK_COLOR
    fillSquare(
      rgba,
      layout,
      item.screenX - layout.originX + layout.paddingPixels,
      item.screenY - layout.originY + layout.paddingPixels,
      shadeColor(base, item.voxel.normalIndex, light),
    )
  }
}

function fillSquare(rgba: Uint8Array, layout: SpriteLayout, x: number, y: number, color: Rgb): void {
  for (let offsetY = 0; offsetY < layout.pixelsPerVoxel; offsetY++) {
    const pixelY = y + offsetY
    if (pixelY < 0 || pixelY >= layout.height) continue
    for (let offsetX = 0; offsetX < layout.pixelsPerVoxel; offsetX++) {
      const pixelX = x + offsetX
      if (pixelX < 0 || pixelX >= layout.width) continue
      const at = (pixelY * layout.width + pixelX) * 4
      rgba[at] = color.r
      rgba[at + 1] = color.g
      rgba[at + 2] = color.b
      rgba[at + 3] = 255
    }
  }
}

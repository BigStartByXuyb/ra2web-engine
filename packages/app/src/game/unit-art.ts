import { loadVoxelUnit, voxelUnitModels } from '@ra2web/assets'
import {
  FACING_COUNT,
  buildDemoVoxelModels,
  positionVoxelModel,
  renderVoxelSprite,
  type PositionedModel,
  type VoxelSprite,
} from '@ra2web/render'

/**
 * 单位美术：把 VXL 按 8 个朝向预渲染成画布，战场直接 drawImage。
 *
 * 1 体素 = 1 像素，与 `RA2_ISO_VIEW` 的 60×30 格一起决定单位在屏幕上的大小。
 * 未核对：原版的体素→屏幕比例、朝向编号对应关系、玩家色重映射（见 render 包 README）。
 */

export interface SpriteFrame {
  readonly canvas: HTMLCanvasElement
  /** 贴地中心在精灵内的位置 */
  readonly anchorX: number
  readonly anchorY: number
}

export interface UnitArt {
  readonly typeId: string
  readonly frames: readonly SpriteFrame[]
}

/** 从原版档案取 `<单位>.vxl` + `<单位>tur.vxl` 并预渲染 8 朝向。 */
export function loadUnitArt(archiveBytes: Uint8Array, typeId: string): UnitArt | undefined {
  const unit = loadVoxelUnit({ bytes: archiveBytes, containerFileName: 'local.mix' }, typeId.toLowerCase())
  if (!unit) return undefined
  return renderFrames(typeId, positionVoxelModel(voxelUnitModels(unit)), undefined)
}

/** 内置示例美术：合成模型 + 阵营着色，用于没有原版素材时验证渲染与操作。 */
export function buildDemoUnitArt(typeId: string, tint: string | undefined): UnitArt {
  // 示例模型只有 4×3 体素，放大 3 倍才看得清；原版单位按 1 体素 = 1 像素。
  return renderFrames(typeId, positionVoxelModel(buildDemoVoxelModels()), tint, 3)
}

/** 用两帧之间的位移决定朝向：模型的前方是 +x，因此旋转角就是位移方向。 */
export function facingFromDelta(deltaX: number, deltaY: number): number {
  if (deltaX === 0 && deltaY === 0) return 0
  const step = (Math.PI * 2) / FACING_COUNT
  const facing = Math.round(Math.atan2(deltaY, deltaX) / step)
  return ((facing % FACING_COUNT) + FACING_COUNT) % FACING_COUNT
}

function renderFrames(typeId: string, model: PositionedModel, tint: string | undefined, pixelsPerVoxel = 1): UnitArt {
  const frames = Array.from({ length: FACING_COUNT }, (_unused, facing) =>
    toFrame(renderVoxelSprite(model, { facing, pixelsPerVoxel, paddingInVoxels: 0 }), tint),
  )
  return { typeId, frames }
}

function toFrame(sprite: VoxelSprite, tint: string | undefined): SpriteFrame {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, sprite.width)
  canvas.height = Math.max(1, sprite.height)
  const context = canvas.getContext('2d')
  if (context && sprite.width > 0 && sprite.height > 0) {
    context.putImageData(new ImageData(new Uint8ClampedArray(sprite.rgba), sprite.width, sprite.height), 0, 0)
    if (tint) {
      // 只给已经画上颜色的像素着色，透明区域保持透明
      context.globalCompositeOperation = 'source-atop'
      context.fillStyle = tint
      context.fillRect(0, 0, sprite.width, sprite.height)
    }
  }
  return { canvas, anchorX: sprite.anchorX, anchorY: sprite.anchorY }
}

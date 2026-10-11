import { loadVoxelUnit, voxelUnitModels, type AssetOverride } from '@ra2web/assets'
import {
  FACING_COUNT,
  METALLIC_STYLE,
  PIXEL_STYLE,
  buildDemoVoxelModels,
  positionVoxelModel,
  renderVoxelSprite,
  type PositionedModel,
  type ShadingStyle,
  type VoxelSprite,
} from '@ra2web/render'

/**
 * 单位美术：把 VXL 按 8 个朝向预渲染成画布，战场直接 drawImage。
 *
 * 1 体素 = 1 像素，与 `RA2_ISO_VIEW` 的 60×30 格一起决定单位在屏幕上的大小。
 *
 * 画质预设（**引擎侧的渲染选项，与素材无关**）：
 *
 * - `pixel`：原版像素风 —— 纯漫反射、最近邻、硬像素边；
 * - `hd`：写实预设（测试用）—— 体素按 2× 超采样渲染再降采样（消除硬像素边），
 *   着色换成带高光的金属模型。**素材仍是原版 VXL**，这里验证的是引擎的着色与放大管线；
 *   以后换成高清/写实素材时，同一套预设参数直接作用在新素材上。
 *
 * 未核对：原版的体素→屏幕比例、朝向编号对应关系、玩家色重映射（见 render 包 README）。
 */

export type QualityPreset = 'pixel' | 'hd' | 'wetNight'

interface QualitySettings {
  readonly shading: ShadingStyle
  /** 超采样倍数：> 1 时按该倍数渲染再降采样 */
  readonly supersample: number
}

export const QUALITY_PRESETS: Readonly<Record<QualityPreset, QualitySettings>> = {
  pixel: { shading: PIXEL_STYLE, supersample: 1 },
  hd: { shading: METALLIC_STYLE, supersample: 2 },
  // 雨夜写实：着色同金属档，后处理那一层在 draw.ts 里叠
  wetNight: { shading: METALLIC_STYLE, supersample: 2 },
}

/** 该预设要不要叠"雨夜"后处理。 */
export function isWetNight(quality: QualityPreset): boolean {
  return quality === 'wetNight'
}

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
export function loadUnitArt(
  archiveBytes: Uint8Array,
  typeId: string,
  quality: QualityPreset = 'pixel',
  overrides?: readonly AssetOverride[],
): UnitArt | undefined {
  const unit = loadVoxelUnit(
    { bytes: archiveBytes, containerFileName: 'local.mix', ...(overrides ? { overrides } : {}) },
    typeId.toLowerCase(),
  )
  if (!unit) return undefined
  return renderFrames(typeId, positionVoxelModel(voxelUnitModels(unit)), undefined, quality)
}

/** 内置示例美术：合成模型 + 阵营着色，用于没有原版素材时验证渲染与操作。 */
export function buildDemoUnitArt(typeId: string, tint: string | undefined, quality: QualityPreset = 'pixel'): UnitArt {
  // 示例模型只有 4×3 体素，放大 3 倍才看得清；原版单位按 1 体素 = 1 像素。
  return renderFrames(typeId, positionVoxelModel(buildDemoVoxelModels()), tint, quality, 3)
}

/** 用两帧之间的位移决定朝向：模型的前方是 +x，因此旋转角就是位移方向。 */
export function facingFromDelta(deltaX: number, deltaY: number): number {
  if (deltaX === 0 && deltaY === 0) return 0
  const step = (Math.PI * 2) / FACING_COUNT
  const facing = Math.round(Math.atan2(deltaY, deltaX) / step)
  return ((facing % FACING_COUNT) + FACING_COUNT) % FACING_COUNT
}

function renderFrames(
  typeId: string,
  model: PositionedModel,
  tint: string | undefined,
  quality: QualityPreset,
  pixelsPerVoxel = 1,
): UnitArt {
  const settings = QUALITY_PRESETS[quality]
  const frames = Array.from({ length: FACING_COUNT }, (_unused, facing) =>
    toFrame(
      renderVoxelSprite(model, {
        facing,
        pixelsPerVoxel: pixelsPerVoxel * settings.supersample,
        shading: settings.shading,
        paddingInVoxels: 0,
      }),
      tint,
      settings.supersample,
    ),
  )
  return { typeId, frames }
}

/** 超采样倍数 > 1 时把大图按比例缩回原尺寸（浏览器做盒式滤波，边缘因此平滑）。 */
function toFrame(sprite: VoxelSprite, tint: string | undefined, supersample: number): SpriteFrame {
  const scale = Math.max(1, Math.round(supersample))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sprite.width / scale))
  canvas.height = Math.max(1, Math.round(sprite.height / scale))
  const context = canvas.getContext('2d')
  if (context && sprite.width > 0 && sprite.height > 0) {
    const large = document.createElement('canvas')
    large.width = sprite.width
    large.height = sprite.height
    const largeContext = large.getContext('2d')
    if (largeContext) {
      largeContext.putImageData(new ImageData(new Uint8ClampedArray(sprite.rgba), sprite.width, sprite.height), 0, 0)
      if (tint) {
        // 只给已经画上颜色的像素着色，透明区域保持透明
        largeContext.globalCompositeOperation = 'source-atop'
        largeContext.fillStyle = tint
        largeContext.fillRect(0, 0, sprite.width, sprite.height)
      }
      context.imageSmoothingEnabled = true
      context.drawImage(large, 0, 0, canvas.width, canvas.height)
    }
  }
  return { canvas, anchorX: sprite.anchorX / scale, anchorY: sprite.anchorY / scale }
}

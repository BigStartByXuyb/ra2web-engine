import { loadVoxelUnit, voxelUnitModels } from '@ra2web/assets'
import { readVxl, type VxlModel } from '@ra2web/formats'
import {
  FACING_COUNT,
  buildDemoVoxelModels,
  composeSpriteStrip,
  positionVoxelModel,
  renderVoxelSprite,
  type PositionedModel,
  type RgbaImage,
} from '@ra2web/render'

/**
 * 体素模型预览：用玩家自备的原版档案渲染载具的 8 个朝向。
 *
 * 渲染与投影来自 `@ra2web/render`，与命令行 `npm run vanilla:model` 共用同一份代码；
 * 本模块只管读文件、贴到画布、报状态。
 */

const PREVIEW_BACKGROUND = { r: 11, g: 15, b: 19, a: 255 }

interface PreviewElements {
  readonly file: HTMLInputElement
  readonly demo: HTMLButtonElement
  readonly unit: HTMLInputElement
  readonly facing: HTMLInputElement
  readonly scale: HTMLInputElement
  readonly status: HTMLElement
  readonly view: HTMLCanvasElement
  readonly strip: HTMLCanvasElement
}

interface PreviewSource {
  readonly fileName: string
  readonly bytes: Uint8Array
}

interface PreviewState {
  source: PreviewSource | undefined
  model: PositionedModel | undefined
}

export function mountModelPreview(): void {
  const elements = queryPreviewElements()
  if (!elements) return
  const state: PreviewState = { source: undefined, model: undefined }

  elements.file.addEventListener('change', () => {
    const file = elements.file.files?.[0]
    if (!file) return
    elements.status.textContent = `读取 ${file.name}…`
    void file.arrayBuffer().then(
      (buffer) => {
        state.source = { fileName: file.name, bytes: new Uint8Array(buffer) }
        rebuildModel(elements, state)
      },
      (error: unknown) => {
        elements.status.textContent = `读取失败：${String(error)}`
      },
    )
  })
  elements.unit.addEventListener('change', () => rebuildModel(elements, state))
  elements.demo.addEventListener('click', () => {
    state.source = undefined
    state.model = positionVoxelModel(buildDemoVoxelModels())
    const { spanX, spanY, spanZ, voxels } = state.model
    elements.status.textContent = `内置示例模型：${voxels.length} 体素，包围盒 ${spanX}x${spanY}x${spanZ}`
    redrawPreview(elements, state.model)
  })
  elements.facing.addEventListener('input', () => redrawPreview(elements, state.model))
  elements.scale.addEventListener('input', () => redrawPreview(elements, state.model))
}

function queryPreviewElements(): PreviewElements | undefined {
  const file = document.getElementById('model-file')
  const demo = document.getElementById('model-demo')
  const unit = document.getElementById('model-unit')
  const facing = document.getElementById('model-facing')
  const scale = document.getElementById('model-scale')
  const status = document.getElementById('model-status')
  const view = document.getElementById('model-view')
  const strip = document.getElementById('model-strip')
  const allFound =
    file instanceof HTMLInputElement &&
    demo instanceof HTMLButtonElement &&
    unit instanceof HTMLInputElement &&
    facing instanceof HTMLInputElement &&
    scale instanceof HTMLInputElement &&
    status instanceof HTMLElement &&
    view instanceof HTMLCanvasElement &&
    strip instanceof HTMLCanvasElement
  if (!allFound) return undefined
  return { file, demo, unit, facing, scale, status, view, strip }
}

function rebuildModel(elements: PreviewElements, state: PreviewState): void {
  if (!state.source) return
  const unitId = elements.unit.value.trim().toLowerCase()
  if (unitId.length === 0) return
  try {
    const models = readModels(state.source, unitId)
    if (!models) {
      state.model = undefined
      elements.status.textContent = `档案里没有 ${unitId}.vxl`
    } else {
      state.model = positionVoxelModel(models)
      const { spanX, spanY, spanZ, voxels } = state.model
      elements.status.textContent = `${unitId}：${voxels.length} 体素，包围盒 ${spanX}x${spanY}x${spanZ}`
    }
  } catch (error) {
    state.model = undefined
    elements.status.textContent = error instanceof Error ? `读取失败：${error.message}` : '读取失败'
  }
  redrawPreview(elements, state.model)
}

/** 单个 `.vxl` 直接解析；档案则按单位 ID 取机体 + 炮塔。 */
function readModels(source: PreviewSource, unitId: string): readonly VxlModel[] | undefined {
  if (/\.vxl$/i.test(source.fileName)) return [readVxl(source.bytes)]
  const unit = loadVoxelUnit({ bytes: source.bytes, containerFileName: 'local.mix' }, unitId)
  return unit ? voxelUnitModels(unit) : undefined
}

function redrawPreview(elements: PreviewElements, model: PositionedModel | undefined): void {
  if (!model) {
    paintImage(elements.view, { width: 0, height: 0, rgba: new Uint8Array(0) })
    paintImage(elements.strip, { width: 0, height: 0, rgba: new Uint8Array(0) })
    return
  }
  const pixelsPerVoxel = Number(elements.scale.value)
  const options = { pixelsPerVoxel, background: PREVIEW_BACKGROUND }
  paintImage(elements.view, renderVoxelSprite(model, { ...options, facing: Number(elements.facing.value) }))
  const facings = Array.from({ length: FACING_COUNT }, (_unused, facing) =>
    renderVoxelSprite(model, { ...options, facing }),
  )
  paintImage(elements.strip, composeSpriteStrip(facings, PREVIEW_BACKGROUND))
}

/** 整数倍最近邻放大后居中贴到画布：放大整数倍才不会把体素糊掉。 */
function paintImage(canvas: HTMLCanvasElement, image: RgbaImage): void {
  const context = canvas.getContext('2d')
  if (!context) return
  context.imageSmoothingEnabled = false
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (image.width === 0 || image.height === 0) return

  const source = document.createElement('canvas')
  source.width = image.width
  source.height = image.height
  const sourceContext = source.getContext('2d')
  if (!sourceContext) return
  sourceContext.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0)

  const scale = Math.max(1, Math.floor(Math.min(canvas.width / image.width, canvas.height / image.height)))
  const width = image.width * scale
  const height = image.height * scale
  context.drawImage(
    source,
    Math.round((canvas.width - width) / 2),
    Math.round((canvas.height - height) / 2),
    width,
    height,
  )
}

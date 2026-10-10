import fs from 'node:fs'
import { loadVoxelUnit, voxelUnitModels } from '@ra2web/assets'
import { type VxlModel } from '@ra2web/formats'
import { FACING_COUNT, composeSpriteStrip, positionVoxelModel, renderVoxelSprite } from '@ra2web/render'
import { writePng } from './png-write.js'

/**
 * 用**玩家自备的原版档案**渲染一个体素单位：RA2.MIX → local.mix → <单位>.vxl → 精灵 → PNG。
 *
 * 渲染走 `@ra2web/render`，与浏览器页面同一份代码；本工具只负责读文件、拼图、写 PNG。
 *
 * 用法：tsx tools/vanilla-model.ts <RA2.MIX> [单位ID=htnk] [out.png=model.png] [每体素像素=3] [朝向=0|all]
 */

const BACKGROUND = { r: 20, g: 24, b: 28, a: 255 }

const [mixPath, unitId = 'htnk', outPath = 'model.png', pixelsArg = '3', facingArg = '0'] = process.argv.slice(2)
if (!mixPath) {
  console.error('usage: vanilla-model.ts <RA2.MIX> [unitId=htnk] [out.png=model.png] [pixelsPerVoxel=3] [facing=0|all]')
  process.exit(1)
}

const archive = new Uint8Array(fs.readFileSync(mixPath))
const unit = loadVoxelUnit({ bytes: archive, containerFileName: 'local.mix' }, unitId)
if (!unit) {
  console.error(`档案里找不到 ${unitId}.vxl`)
  process.exit(1)
}
const models = voxelUnitModels(unit)
const model = positionVoxelModel(models)
const pixelsPerVoxel = Math.max(1, Math.round(Number(pixelsArg)))

for (const entry of models) reportModel(entry)
console.log(
  `合计体素 ${model.voxels.length}，包围盒 ${model.spanX}x${model.spanY}x${model.spanZ}，` +
    `内嵌调色板 ${model.palette ? `${model.palette.colors.length} 色` : '无'}`,
)

if (facingArg === 'all') {
  const sprites = Array.from({ length: FACING_COUNT }, (_unused, facing) =>
    renderVoxelSprite(model, { facing, pixelsPerVoxel, background: BACKGROUND }),
  )
  const strip = composeSpriteStrip(sprites, BACKGROUND)
  fs.writeFileSync(outPath, writePng(strip.width, strip.height, strip.rgba))
  console.log(`8 朝向 → ${outPath}（${strip.width}x${strip.height}）`)
} else {
  const sprite = renderVoxelSprite(model, { facing: Number(facingArg), pixelsPerVoxel, background: BACKGROUND })
  fs.writeFileSync(outPath, writePng(sprite.width, sprite.height, sprite.rgba))
  console.log(
    `朝向 ${sprite.facing} → ${outPath}（${sprite.width}x${sprite.height}，锚点 ${sprite.anchorX}/${sprite.anchorY}）`,
  )
}

function reportModel(model: VxlModel): void {
  console.log(`模型 ${model.fileName}：节数 ${model.sections.length}，体素 ${model.voxelCount}`)
  for (const section of model.sections) {
    console.log(
      `  [${section.name}] ${section.sizeX}x${section.sizeY}x${section.sizeZ} ` +
        `体素 ${section.voxels.length} hvaMultiplier=${section.hvaMultiplier.toFixed(4)}`,
    )
  }
}

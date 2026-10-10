import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { readMixFile, readVxl } from '@ra2web/formats'
import { FACING_COUNT, positionVoxelModel, renderVoxelSprite } from '../src/index.js'
import { hashBytes } from './fixture.js'

/**
 * 原版素材的端到端核对：只有本机提供原版档案时才运行。
 * 设定 `RA2_MIX=<RA2.MIX 路径>` 启用；仓库不存放受版权保护的原始档案。
 */
const mixPath = process.env.RA2_MIX

test('原版犀牛能渲染出 8 个互不相同的朝向', { skip: !mixPath ? '未设置 RA2_MIX' : false }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const bodyBytes = readMixFile({ bytes: archive, fileName: 'htnk.vxl', containerFileName: 'local.mix' })
  const turretBytes = readMixFile({ bytes: archive, fileName: 'htnktur.vxl', containerFileName: 'local.mix' })
  assert.ok(bodyBytes, 'local.mix 里应当有 htnk.vxl')
  assert.ok(turretBytes, 'local.mix 里应当有 htnktur.vxl')

  const model = positionVoxelModel([readVxl(bodyBytes!), readVxl(turretBytes!)])
  assert.ok(model.voxels.length > 4000, `体素数异常：${model.voxels.length}`)
  assert.ok(model.spanZ > 8, `高度异常：${model.spanZ}`)
  assert.ok(model.palette, '机体应当带内嵌调色板')

  const sprites = Array.from({ length: FACING_COUNT }, (_unused, facing) =>
    renderVoxelSprite(model, { facing, pixelsPerVoxel: 1 }),
  )
  const hashes = sprites.map((sprite) => hashBytes(sprite.rgba))
  assert.equal(new Set(hashes).size, FACING_COUNT, `朝向精灵有重复：${hashes.join(',')}`)

  const painted = sprites[0]!.rgba.filter((_value, index) => index % 4 === 3 && sprites[0]!.rgba[index] !== 0).length
  assert.ok(painted > 1000, `绘制的像素太少：${painted}`)
})

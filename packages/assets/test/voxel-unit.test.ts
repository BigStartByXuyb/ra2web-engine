import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { loadVoxelUnit, voxelUnitModels } from '../src/voxel-unit.js'

/**
 * 原版素材的端到端核对：只有本机提供原版档案时才运行。
 * 设定 `RA2_MIX=<RA2.MIX 路径>` 启用；仓库不存放受版权保护的原始档案。
 */
const mixPath = process.env.RA2_MIX
const skip = !mixPath ? '未设置 RA2_MIX' : false

function readArchive(): Uint8Array {
  return new Uint8Array(fs.readFileSync(mixPath!))
}

test('原版犀牛的单位美术 = 机体 + 炮塔', { skip }, () => {
  const unit = loadVoxelUnit({ bytes: readArchive(), containerFileName: 'local.mix' }, 'htnk')
  assert.ok(unit, '应当取到 htnk')
  assert.ok(unit!.body.voxelCount > 4000, `机体体素数异常：${unit!.body.voxelCount}`)
  assert.ok(unit!.turret, '犀牛应当有炮塔')
  assert.ok(unit!.turret!.voxelCount > 1000, `炮塔体素数异常：${unit!.turret!.voxelCount}`)
  assert.equal(voxelUnitModels(unit!).length, 2)
})

test('不存在的单位返回 undefined，不抛异常', { skip }, () => {
  assert.equal(loadVoxelUnit({ bytes: readArchive(), containerFileName: 'local.mix' }, 'nosuchunit'), undefined)
})

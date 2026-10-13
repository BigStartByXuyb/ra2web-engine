import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TERRAIN_Z_STEP_PX } from '../src/game/terrain3d-zstep.js'

test('zStep 是正的有限数值（试算值或取证值都满足）', () => {
  assert.ok(Number.isFinite(TERRAIN_Z_STEP_PX) && TERRAIN_Z_STEP_PX > 0)
})

test('zStep 等于试算口径 90 lepton × 30/256 ≈ 10.547（待取证闭合前钉住口径）', () => {
  // 一级 = 90 lepton（0x8529d0，已核）；90 × 30/256 = 10.546875。
  // 取证闭合后这里随证据值更新（见 docs/ENGINE-MAP.md「地貌线：一级高度折像素」）。
  assert.ok(Math.abs(TERRAIN_Z_STEP_PX - 10.546875) < 1e-6)
})

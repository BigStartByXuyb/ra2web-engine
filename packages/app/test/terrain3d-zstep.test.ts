import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TERRAIN_Z_STEP_PX } from '../src/game/terrain3d-zstep.js'

test('zStep 是正的有限数值（试算值或取证值都满足）', () => {
  assert.ok(Number.isFinite(TERRAIN_Z_STEP_PX) && TERRAIN_Z_STEP_PX > 0)
})

test('zStep = 90 lepton × 30/256 = 10.546875（已判定：显示管线量子 90，104.5 口径排除）', () => {
  // 一级 = 90 lepton（显示管线 FUN_00472540 级×0x850c40 实锤）；90 × 30/256 = 10.546875。
  // 证据：work/decompiled/ra2-engine/zstep-lepton-to-pixel.md、ENGINE-MAP「已判定」小节。
  assert.ok(Math.abs(TERRAIN_Z_STEP_PX - 10.546875) < 1e-6)
})

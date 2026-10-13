import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SLOPE_CELL_VOXELS, slopeTiltOf } from '../src/game/slope.js'

/**
 * 坡度俯仰（本项目自定增强）：单位 3D 模型在坡面上倾斜，贴合地形。
 *
 * 几何口径：等距投影里 1 格 = 60px 宽 = **30 体素-x**（屏幕 (+1, +0.5) 每体素）；
 * 1 级高度 = `TERRAIN_Z_STEP_PX`（10.546875，体素 z 直接减在屏幕 y 上）。
 * 因此沿格 x 每级坡的倾角 = atan(10.546875 / 30) ≈ 19.38°。
 */

const LEVEL = 10.546875
const RAMP = Math.atan(LEVEL / SLOPE_CELL_VOXELS)
/** 3×3 平地 */
const FLAT = Int8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0])

function grid(levels: readonly number[]): Int8Array {
  return Int8Array.from(levels)
}

test('平地：pitch/roll 都是 0', () => {
  const tilt = slopeTiltOf(FLAT, 3, 3, 1, 1)
  assert.equal(tilt.pitch, 0)
  assert.equal(tilt.roll, 0)
})

test('沿 x 的斜坡：pitch = atan(每格级差 × 10.546875 / 30)，roll = 0', () => {
  // x 方向每格 +1 级
  const heights = grid([0, 1, 2, 0, 1, 2, 0, 1, 2])
  const tilt = slopeTiltOf(heights, 3, 3, 1, 1)
  assert.ok(Math.abs(tilt.pitch - RAMP) < 1e-9, `pitch=${tilt.pitch} 应≈${RAMP}`)
  assert.equal(tilt.roll, 0)
})

test('沿 y 的斜坡：roll = atan(每格级差 × 10.546875 / 30)，pitch = 0', () => {
  const heights = grid([0, 0, 0, 1, 1, 1, 2, 2, 2])
  const tilt = slopeTiltOf(heights, 3, 3, 1, 1)
  assert.equal(tilt.pitch, 0)
  assert.ok(Math.abs(tilt.roll - RAMP) < 1e-9, `roll=${tilt.roll} 应≈${RAMP}`)
})

test('下坡与上坡符号相反', () => {
  const up = slopeTiltOf(grid([0, 1, 2, 0, 1, 2, 0, 1, 2]), 3, 3, 1, 1)
  const down = slopeTiltOf(grid([2, 1, 0, 2, 1, 0, 2, 1, 0]), 3, 3, 1, 1)
  assert.ok(up.pitch > 0 && down.pitch < 0)
  assert.ok(Math.abs(up.pitch + down.pitch) < 1e-9)
})

test('边界用单侧差分（不越界读）', () => {
  const heights = grid([0, 1, 2, 0, 1, 2, 0, 1, 2])
  const left = slopeTiltOf(heights, 3, 3, 0, 1)
  // 左侧单侧差分 = h[x+1] − h[x] = 1 → 同一坡度
  assert.ok(Math.abs(left.pitch - RAMP) < 1e-9)
  // 右边界：h[x] − h[x−1] = 1 → 同坡
  const right = slopeTiltOf(heights, 3, 3, 2, 1)
  assert.ok(Math.abs(right.pitch - RAMP) < 1e-9)
})

test('越界格子返回零倾角（不抛错）', () => {
  const tilt = slopeTiltOf(FLAT, 3, 3, 5, 5)
  assert.deepEqual(tilt, { pitch: 0, roll: 0 })
})

test('高度缺失（undefined）由调用方处理；函数只吃 Int8Array', () => {
  // 类型层面已经限定 Int8Array，这里只验证 1×1 退化网格不崩且为 0
  const tilt = slopeTiltOf(grid([3]), 1, 1, 0, 0)
  assert.deepEqual(tilt, { pitch: 0, roll: 0 })
})

test('极端级差被夹在 ±45°（防御性上限）', () => {
  // (0,2) 的 y 单侧差分 = 120 级 → atan(120×10.547/30) ≈ 88.6°，必须夹到 45°
  const heights = grid([0, 0, 0, 0, 0, 0, 120, 0, 0])
  const tilt = slopeTiltOf(heights, 3, 3, 0, 2)
  assert.ok(tilt.roll <= Math.PI / 4 + 1e-9 && tilt.roll >= -Math.PI / 4 - 1e-9)
  assert.ok(tilt.roll > 0.5, `应接近上限而不是 0（实际 ${tilt.roll}）`)
})

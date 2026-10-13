import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ARC_FIXED_ANGLE,
  solveArcAngle,
  solveArcAngleRomTranscription,
} from '../src/bullet.js'

/**
 * 抛射角（docs/ENGINE-MAP.md「visible shell」节，fn-47f9b0/fn-47f8b0）：
 * - 45° 常量 = 原版 double 字节级确证值（44.9991°）；
 * - solveArcAngle = **本项目自定标准式建模**（原版精确参数化 record_unknown）；
 * - ROM 转写 = 1:1 字节转写，未验证（只测形态：无解/负解→null、g>0→固定角）。
 */

test('45° 固定角常量 = 原版字节值（44.9991°，非精确 π/4）', () => {
  assert.equal(ARC_FIXED_ANGLE, 0.78538225)
  assert.notEqual(ARC_FIXED_ANGLE, Math.PI / 4)
})

test('标准式：平地对标靶的双解物理性质（低抛 < 高抛；角度合理）', () => {
  const low = solveArcAngle(100, 0, 10, 60, false)
  const high = solveArcAngle(100, 0, 10, 60, true)
  assert.ok(low !== null && high !== null)
  assert.ok(low! < high!)
  assert.ok(low! > 0 && high! < Math.PI / 2)
  // 平地对标（dz=0）双解互为共轭：tanθ_low · tanθ_high = 1（v²/v²）
  assert.ok(Math.abs(Math.tan(low!) * Math.tan(high!) - 1) < 1e-12)
})

test('标准式：高差对解的影响（真实关系：目标更高 → 低抛角大增、高抛角微降）', () => {
  const lowFlat = solveArcAngle(100, 0, 10, 60, false)!
  const highFlat = solveArcAngle(100, 0, 10, 60, true)!
  const lowUp = solveArcAngle(100, 30, 10, 60, false)!
  const highUp = solveArcAngle(100, 30, 10, 60, true)!
  assert.ok(lowUp > lowFlat, `低抛角应增大：${lowUp} vs ${lowFlat}`)
  assert.ok(highUp < highFlat, `高抛角应微降：${highUp} vs ${highFlat}`)
})

test('标准式：无解（射程不够）返回 null', () => {
  // d=1000, g=10, v=50：v⁴ = 6.25e6 < g²d² = 1e8
  assert.equal(solveArcAngle(1000, 0, 10, 50, true), null)
})

test('标准式：零重力/零距离防御返回 null（本项目自定）', () => {
  assert.equal(solveArcAngle(100, 0, 0, 50, true), null)
  assert.equal(solveArcAngle(0, 0, 10, 50, true), null)
})

test('ROM 转写形态（未验证，只测已确证行为）：g>0 → 固定角', () => {
  assert.equal(solveArcAngleRomTranscription(100, 0, 5, 50, true), ARC_FIXED_ANGLE)
  assert.equal(solveArcAngleRomTranscription(1, 1, 0.1, 1, false), ARC_FIXED_ANGLE)
})

test('ROM 转写形态：零距离/退化返回 null，不抛异常（防御为本项目自定）', () => {
  assert.equal(solveArcAngleRomTranscription(0, 0, -10, 50, true), null)
  assert.equal(solveArcAngleRomTranscription(1000, 0, -10, 50, true), null) // h=0 → denom 防御
  assert.equal(solveArcAngleRomTranscription(1, 1, 0.1, 1, false), ARC_FIXED_ANGLE)
})

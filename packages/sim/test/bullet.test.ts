import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ANGLE16_TO_RADIANS,
  ARC_FIXED_ANGLE,
  scatterShot,
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

// ---- 散布（fn-6ca890 分支 B 口径）----

function seqRng(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]!
}

test('散布：scatter=0 或 range=0 不偏移（防御，本项目自定）', () => {
  assert.deepEqual(scatterShot(1000, 2000, 500, 800, 0, seqRng([0.5, 0.5])), { x: 1000, y: 2000 })
  assert.deepEqual(scatterShot(1000, 2000, 500, 0, 50, seqRng([0.5, 0.5])), { x: 1000, y: 2000 })
})

test('散布半径随距离线性（r = RNG(0,scatter)×dist/range）', () => {
  // rand 序列 [半径比 1.0, 角度中心 0.5 → θ=0] → 偏移 = (scatter×dist/range, 0)
  const near = scatterShot(0, 0, 100, 400, 400, seqRng([1.0, 0.5]))
  const far = scatterShot(0, 0, 400, 400, 400, seqRng([1.0, 0.5]))
  assert.deepEqual(near, { x: 100, y: 0 })
  assert.deepEqual(far, { x: 400, y: 0 })
})

test('散布角：θ=−π 与 θ=+π 落点重合于 −x 方向（中心化范围）', () => {
  const negPi = scatterShot(0, 0, 100, 100, 100, seqRng([1.0, 0.0]))
  const posPi = scatterShot(0, 0, 100, 100, 100, seqRng([1.0, 1.0]))
  assert.equal(negPi.x, posPi.x)
  assert.equal(negPi.y, posPi.y)
})

test('16 位角换算常量 = 原版字节值（负号=顺时针约定）', () => {
  assert.equal(ANGLE16_TO_RADIANS, -9.587672516830327e-05)
})

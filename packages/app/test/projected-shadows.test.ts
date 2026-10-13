import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PROJECTED_SHADOW_DEFAULT, projectedShadowVertex } from '../src/game/projected-shadows.js'

const SLIDE = PROJECTED_SHADOW_DEFAULT

test('零高度顶点：影子落点 = 平移到地面的足迹（与主投影一致的 xy）', () => {
  // 无旋转 facing=0、锚点 (100, 50)：顶点 (10, 0, 0) → 足迹 x=100+10-0=110, y=50+5=55
  const [x, y] = projectedShadowVertex([10, 0, 0], 0, 100, 50, SLIDE)
  assert.equal(x, 110)
  assert.equal(y, 55)
})

test('高度贡献：每体素高度按光斜率偏移（右下），且随高度线性', () => {
  const ground = projectedShadowVertex([0, 0, 0], 0, 0, 0, SLIDE)
  const raised = projectedShadowVertex([0, 0, 10], 0, 0, 0, SLIDE)
  assert.equal(raised[0] - ground[0], 10 * SLIDE.slideX)
  assert.equal(raised[1] - ground[1], 10 * SLIDE.slideY)
})

test('朝向与模型旋转一致（π/2 把 +x 转到 +y，与 unit3d 同约定）', () => {
  const [x, y] = projectedShadowVertex([10, 0, 0], Math.PI / 2, 0, 0, SLIDE)
  // rot=(0,10) → flat x=-10, y=5
  assert.ok(Math.abs(x - -10) < 1e-9)
  assert.ok(Math.abs(y - 5) < 1e-9)
})

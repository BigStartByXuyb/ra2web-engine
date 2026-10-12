import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CELL_STEPS,
  DIRECTIONS,
  FACING_PER_STEP,
  FACING_STEPS,
  LEPTON_STEPS,
  dirFromFacing,
  facingFromDir,
} from '../src/direction.js'

/**
 * 八方向口径全部来自 GAME.EXE 证据（docs/ENGINE-MAP.md「单位移动核心」）：
 *
 * - 格步进表 0x851a70 / lepton 步进表 0x851ac0：顺时针从北起，
 *   初始化器 0x491620（short）与 0x4916d0（int）手工反汇编读出。
 * - 朝向 16 位角顺时针 0=北，每 45° = 8192（推进核心里 `方向 << 13`）。
 * - dir = ((facing >> 12) + 1) >> 1 & 7（推进核心 0x4b8be0 调用处）。
 */

test('格步进表与原版 0x851a70 一致：顺时针从北起', () => {
  assert.deepEqual(CELL_STEPS, [
    { x: 0, y: -1 }, // 0 北
    { x: 1, y: -1 }, // 1 东北
    { x: 1, y: 0 }, // 2 东
    { x: 1, y: 1 }, // 3 东南
    { x: 0, y: 1 }, // 4 南
    { x: -1, y: 1 }, // 5 西南
    { x: -1, y: 0 }, // 6 西
    { x: -1, y: -1 }, // 7 西北
  ])
})

test('lepton 步进表与原版 0x851ac0 一致：斜向 (±256,±256)，斜走一格欧氏 256√2', () => {
  assert.deepEqual(LEPTON_STEPS, [
    { x: 0, y: -256 },
    { x: 256, y: -256 },
    { x: 256, y: 0 },
    { x: 256, y: 256 },
    { x: 0, y: 256 },
    { x: -256, y: 256 },
    { x: -256, y: 0 },
    { x: -256, y: -256 },
  ])
  // 斜向步的欧氏长度按平欧氏距离计（约为 cardinal 的 √2 倍）
  const diag = Math.hypot(256, 256)
  assert.ok(diag > 360 && diag < 363, `斜向一步 ≈ ${diag} lepton`)
})

test('每 45° 对应 8192 个朝向单位，全圆 65536', () => {
  assert.equal(FACING_PER_STEP, 8192)
  assert.equal(FACING_STEPS, 8)
  assert.equal(FACING_PER_STEP * FACING_STEPS, 65536)
})

test('dirFromFacing 按原版式 ((facing>>12)+1)>>1 & 7 分段', () => {
  assert.equal(dirFromFacing(0x0000), 0, '0 = 北')
  assert.equal(dirFromFacing(0x0fff), 0, '北边界内（±22.5°）')
  assert.equal(dirFromFacing(0xf800), 0, '0xFFFF 侧回卷到北')
  assert.equal(dirFromFacing(0x1000), 1, '22.5° 起算东北')
  assert.equal(dirFromFacing(0x2000), 1, '45° = 东北中心')
  assert.equal(dirFromFacing(0x3000), 2, '67.5° 起算东')
  assert.equal(dirFromFacing(0x4000), 2, '90° = 东')
  assert.equal(dirFromFacing(0x8000), 4, '180° = 南')
  assert.equal(dirFromFacing(0xc000), 6, '270° = 西')
})

test('facingFromDir 取方向中心角，与 dirFromFacing 互逆', () => {
  for (let dir = 0; dir < 8; dir++) {
    const facing = facingFromDir(dir)
    assert.equal(dirFromFacing(facing), dir, `dir ${dir} 的中心角回读`)
  }
  assert.equal(facingFromDir(0), 0, '北 = 0')
  assert.equal(facingFromDir(2), 0x4000, '东 = 90°')
})

test('DIRECTIONS 是格步进表的别名（寻路邻居用）', () => {
  assert.equal(DIRECTIONS.length, 8)
  assert.deepEqual(DIRECTIONS, CELL_STEPS)
})

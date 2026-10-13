import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDecalBuffer } from '../src/game/terrain3d-decals.js'

interface StampCall {
  readonly px: number
  readonly py: number
  readonly radius: number
  readonly strength: number
}

function makeBuffer() {
  const calls: StampCall[] = []
  // 世界范围 600×300（=10×5 格 @60px），每格 4px → 缓冲 40×20
  const buffer = createDecalBuffer(
    { minX: 0, minY: 0, width: 600, height: 300, pixelsPerCell: 4 },
    (px, py, radius, strength) => calls.push({ px, py, radius, strength }),
  )
  return { buffer, calls }
}

test('坐标换算：世界中心 → 缓冲中心，半径=1.6 格×每格像素', () => {
  const { buffer, calls } = makeBuffer()
  assert.equal(buffer.stampWorld(300, 150), true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.px, 20)
  assert.equal(calls[0]!.py, 10)
  assert.ok(Math.abs(calls[0]!.radius - 6.4) < 1e-9, `半径应为 1.6×4=${6.4}，实际 ${calls[0]!.radius}`)
  assert.equal(calls[0]!.strength, 0.35)
})

test('四角坐标映射正确', () => {
  const { buffer, calls } = makeBuffer()
  buffer.stampWorld(0, 0)
  buffer.stampWorld(600, 300)
  assert.equal(calls[0]!.px, 0)
  assert.equal(calls[0]!.py, 0)
  assert.equal(calls[1]!.px, 40)
  assert.equal(calls[1]!.py, 20)
})

test('越界坐标不盖章、不回调、dirty 不变', () => {
  const { buffer, calls } = makeBuffer()
  assert.equal(buffer.stampWorld(-1, 150), false)
  assert.equal(buffer.stampWorld(300, 301), false)
  assert.equal(buffer.stampWorld(601, 150), false)
  assert.equal(calls.length, 0)
  assert.equal(buffer.dirty, false)
})

test('dirty 生命周期：盖章置位，takeDirty 读取并清位', () => {
  const { buffer } = makeBuffer()
  assert.equal(buffer.dirty, false)
  buffer.stampWorld(100, 100)
  assert.equal(buffer.dirty, true)
  assert.equal(buffer.takeDirty(), true)
  assert.equal(buffer.dirty, false)
  assert.equal(buffer.takeDirty(), false)
  buffer.stampWorld(200, 200)
  assert.equal(buffer.takeDirty(), true)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGrid, type Cell } from '../src/grid.js'
import { findPath } from '../src/path.js'

const WALL: readonly Cell[] = [
  { x: 3, y: 0 },
  { x: 3, y: 1 },
  { x: 3, y: 2 },
  { x: 3, y: 3 },
  { x: 3, y: 4 },
]
const GRID = createGrid(10, 10, WALL)

test('绕墙找到路径，且不穿过障碍', () => {
  const path = findPath(GRID, { x: 0, y: 2 }, { x: 6, y: 2 })
  assert.ok(path)
  assert.deepEqual(path[path.length - 1], { x: 6, y: 2 })
  assert.ok(path.every((cell) => !WALL.some((wall) => wall.x === cell.x && wall.y === cell.y)))
  // 必须绕行：最短曼哈顿距离是 6，绕墙至少多 4 步
  assert.ok(path.length >= 10)
})

test('目标不可达时返回 undefined', () => {
  const closed = createGrid(
    5,
    5,
    Array.from({ length: 5 }, (_, y) => ({ x: 2, y })),
  )
  assert.equal(findPath(closed, { x: 0, y: 2 }, { x: 4, y: 2 }), undefined)
})

test('目标落在障碍上返回 undefined', () => {
  assert.equal(findPath(GRID, { x: 0, y: 0 }, { x: 3, y: 3 }), undefined)
})

test('同输入两次寻路结果完全一致', () => {
  const first = findPath(GRID, { x: 1, y: 8 }, { x: 8, y: 1 })
  const second = findPath(GRID, { x: 1, y: 8 }, { x: 8, y: 1 })
  assert.deepEqual(first, second)
})

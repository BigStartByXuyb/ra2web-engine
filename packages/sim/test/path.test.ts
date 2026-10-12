import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STEP_DIRECTION_COUNT, createGrid, type Cell } from '../src/grid.js'
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
  // 绕行必须发生（直穿距离 6 步），但软惩罚时代步数不再是稳定判据（切角罚价
  // 会让最优解变长），只钉"绕行存在"与"不穿墙"两条。
  assert.ok(path.length >= 6, `绕墙至少 6 步（实际 ${path.length}）`)
})

test('开阔地斜走：对角目标两步直达', () => {
  const path = findPath(createGrid(5, 5, []), { x: 0, y: 0 }, { x: 2, y: 2 })
  assert.deepEqual(path, [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ])
})

test('斜缝切角：软惩罚 ×10，双堵时唯一路可硬穿（总工裁定=原版口径）', () => {
  // 依据：原版 fn-427110 对切角斜步乘 10（0x79c4c8），是代价不是禁止。
  // 单格墙 (1,0)：斜穿 (1,1) 罚 3620，绕行 (0,1)→(1,1) 更便宜 → 选绕行
  const oneWall = createGrid(5, 5, [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
  ])
  const path = findPath(oneWall, { x: 0, y: 0 }, { x: 2, y: 2 })
  assert.ok(path)
  assert.deepEqual(path[0], { x: 0, y: 1 }, '绕行更便宜时第一步向下')
  // 两正交邻格全堵：斜穿是唯一路 → 罚价 3620 × 2 也要硬穿（可达性合同）
  const corner = createGrid(5, 5, [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ])
  const squeezed = findPath(corner, { x: 0, y: 0 }, { x: 2, y: 2 })
  assert.ok(squeezed, '斜缝仍可达')
  assert.deepEqual(squeezed, [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ])
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

/** 给每个格子一个高度 z，按"高度差 ≥ 2 不能迈"生成边阻挡。 */
function stepsFromHeights(width: number, height: number, z: (x: number, y: number) => number): Uint8Array {
  const directions = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]
  const blocked = new Uint8Array(width * height * STEP_DIRECTION_COUNT)
  directions.forEach(([dx, dy], index) => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = x + dx!
        const ny = y + dy!
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        if (Math.abs(z(x, y) - z(nx, ny)) >= 2) blocked[(y * width + x) * STEP_DIRECTION_COUNT + index] = 1
      }
    }
  })
  return blocked
}

test('高度差挡住这一步：悬崖上不去，坡度 1 级可以上下', () => {
  // 中间一列是台地（z=4），左右两侧草地 z=0 —— 从草地正面爬上不去
  const plateau = createGrid(
    7,
    3,
    [],
    stepsFromHeights(7, 3, (x) => (x === 3 ? 4 : 0)),
  )
  assert.equal(findPath(plateau, { x: 0, y: 1 }, { x: 3, y: 1 }), undefined, '高度差 4 上不去')
  // 台地换成每步升一级的斜坡：z = 0,1,2,3,4
  const slope = createGrid(
    7,
    3,
    [],
    stepsFromHeights(7, 3, (x) => Math.min(x, 4)),
  )
  const path = findPath(slope, { x: 0, y: 1 }, { x: 4, y: 1 })
  assert.deepEqual(path, [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
  ])
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compareDepthOrder, footprintDepth } from '../src/iso.js'

/**
 * 建筑与单位的等距绘制顺序：站在楼后面的单位必须先画（被楼挡住），站在楼前面的后画（盖住楼）。
 *
 * 这是"单位永远盖在建筑上"那处穿帮的回归 —— 顺序一旦退回"建筑一批、单位一批"，这几条就红。
 */
describe('等距绘制顺序', () => {
  it('地基的最前行才是物体的深度，不是起始角', () => {
    // 4×4 的地基摆在 (10, 10)：最前行是 (13, 13)
    assert.equal(footprintDepth(10, 10, 4, 4), 26)
    assert.equal(footprintDepth(13, 13), 26)
    // 按起始角算只有 20，会把整栋楼排到站在它前面的单位之前
    assert.notEqual(footprintDepth(10, 10, 4, 4), footprintDepth(10, 10))
  })

  it('YSortAdjust 直接加在深度上', () => {
    assert.equal(footprintDepth(10, 10, 1, 1, 5), 25)
  })

  it('站在楼后面的单位比楼浅：先画，于是被楼挡住', () => {
    const building = { depth: footprintDepth(10, 10, 4, 4), isUnit: false }
    const behind = { depth: footprintDepth(9, 9), isUnit: true }
    assert.ok(compareDepthOrder(behind, building) < 0)
    assert.deepEqual([building, behind].sort(compareDepthOrder), [behind, building])
  })

  it('站在楼前面的单位比楼深：后画，于是盖住楼', () => {
    const building = { depth: footprintDepth(10, 10, 4, 4), isUnit: false }
    const front = { depth: footprintDepth(14, 14), isUnit: true }
    assert.ok(compareDepthOrder(front, building) > 0)
    assert.deepEqual([front, building].sort(compareDepthOrder), [building, front])
  })

  it('深度相同时单位在后：站在楼正面那一行上要盖住楼的裙边', () => {
    const depth = footprintDepth(10, 10, 4, 4)
    const building = { depth, isUnit: false }
    const unit = { depth, isUnit: true }
    assert.deepEqual([unit, building].sort(compareDepthOrder), [building, unit])
  })
})

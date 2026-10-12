import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RA2_ISO_VIEW, cellToScreen, snapSpriteOrigin } from '../src/iso.js'

test('精灵落位永远落在整数像素上', () => {
  // 覆盖物、建筑、单位三种精灵的落位都从这里出：中心是整数格心的投影（30 的倍数），
  // 尺寸奇偶不定（实测覆盖物有 29×10、27×15 这类奇数宽高），所以要按半个像素差也取整。
  for (const center of [0, 30, 915.5, -0.5, 2167.5, 1014]) {
    for (const size of [1, 12, 17, 29, 60, 61]) {
      const origin = snapSpriteOrigin(center - size / 2, center - size / 2)
      assert.ok(
        Number.isInteger(origin.x) && Number.isInteger(origin.y),
        `中心 ${center}、尺寸 ${size} 落到了 ${origin.x},${origin.y}`,
      )
    }
  }
})

test('相邻格里同宽的两张精灵整体平移整数格距，桥面接缝不裂', () => {
  // 覆盖物按格摆：相邻两格的格心相差 30 像素（半个菱形高）。同宽的两张精灵必须差同样的整数，
  // 否则每节桥面各自错开半像素，接缝上就会看到一条缝。
  const step = RA2_ISO_VIEW.cellHeight
  for (const size of [17, 29, 60, 61]) {
    const first = snapSpriteOrigin(0 - size / 2, 0 - size / 2)
    const second = snapSpriteOrigin(step - size / 2, step - size / 2)
    assert.equal(second.x - first.x, step, `尺寸 ${size} 的横向位移不是 ${step}`)
    assert.equal(second.y - first.y, step, `尺寸 ${size} 的纵向位移不是 ${step}`)
  }
})

test('格心投影落在整数像素上：地块四边形不需要另做取整', () => {
  // 地块与覆盖物共用投影，地块的倍率只由宽度定、尺寸可能是非整数，所以地块的**落位**必须
  // 按整数格心算出来；只要这一条成立，地块与覆盖物就不会一个取整一个不取整。
  for (const x of [0, 1, 7, 199]) {
    for (const y of [0, 3, 101, 199]) {
      const center = cellToScreen(RA2_ISO_VIEW, { x: x + 0.5, y: y + 0.5 })
      assert.ok(
        Number.isInteger(center.x) && Number.isInteger(center.y),
        `格 ${x},${y} 的格心落到了 ${center.x},${center.y}`,
      )
    }
  }
})

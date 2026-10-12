import assert from 'node:assert/strict'
import test from 'node:test'
import { BLOOM, bloomSize } from '../src/game/post-process.js'

/**
 * 泛光参数与缩小尺寸。
 * UI 用例判"开泛光后画面必须变亮"，这里盯住容易被改坏的两件事：
 * 缩小尺寸不能是 0（小窗口/缩放倍率下会除出 0 像素画布），以及泛光必须是加色提亮。
 */
test('缩小尺寸在任何画布尺寸下都至少 1 像素', () => {
  for (const size of [
    [1600, 900],
    [8, 8],
    [1, 1],
    [3, 2560],
  ] as const) {
    const scaled = bloomSize(size[0], size[1], BLOOM.scale)
    assert.ok(scaled.width >= 1 && scaled.height >= 1, `${size.join('x')} → ${scaled.width}x${scaled.height}`)
    assert.ok(scaled.width <= size[0] && scaled.height <= size[1])
  }
})

test('缩小尺寸按 scale 缩小，边界取整不越界', () => {
  assert.deepEqual(bloomSize(1600, 900, 4), { width: 400, height: 225 })
  assert.deepEqual(bloomSize(1601, 903, 4), { width: 400, height: 225 })
})

test('泛光是加色叠加（提亮），不是压暗', () => {
  assert.ok(BLOOM.wetNightAlpha > 0 && BLOOM.standaloneAlpha > 0, '强度必须为正，否则等于没开')
  assert.ok(BLOOM.standaloneAlpha < BLOOM.wetNightAlpha, '白天单独开泛光必须比雨夜档轻：雨夜档先压暗过整幅画面')
  assert.ok(BLOOM.brightness > 1, '亮部必须被抬过，否则叠回去只是"更亮一点的原图"')
  assert.ok(BLOOM.highlightContrast > 1, '没有对比度门槛，泛光就成了给整幅画面加亮')
  assert.ok(BLOOM.scale >= 2, '不缩小就等于全分辨率模糊，代价与收益不成比例')
})

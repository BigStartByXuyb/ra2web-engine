import assert from 'node:assert/strict'
import test from 'node:test'
import { FOG_FALLOFF_CELLS, exploredDistance, fogFadeFor } from '../src/game/fog-layer.js'

/**
 * 迷雾边界的浓度与距离。逐格硬边会让人一眼看出"格子量化"的锯齿，
 * 所以这里盯住两件事：浓度必须随距离单调变浓、且摊开的宽度不小于设定值。
 */
test('浓度随距离单调变浓，falloff 格外满浓度', () => {
  let previous = -1
  for (let distance = 0; distance <= 6; distance++) {
    const fade = fogFadeFor(distance)
    assert.ok(fade >= previous, `距离 ${distance} 的浓度比前一档还淡`)
    previous = fade
  }
  assert.equal(fogFadeFor(0), 0, '紧贴已探索格的格子必须全透明')
  assert.equal(fogFadeFor(FOG_FALLOFF_CELLS), 1)
  assert.equal(fogFadeFor(FOG_FALLOFF_CELLS + 3), 1, '更远就封顶在满浓度')
})

test('边界至少摊开两格：一格就退化成硬边（"锯齿"）', () => {
  assert.ok(FOG_FALLOFF_CELLS >= 2, '摊开的宽度不够，边界又会是一格宽的台阶')
  assert.ok(fogFadeFor(1) < 0.6, '紧邻已探索的那一格必须明显淡，否则看不出渐变')
})

test('到最近已探索格的距离按切比雪夫算，扫描半径内取最小值', () => {
  const explored = new Set(['10,10'])
  const isExplored = (x: number, y: number): boolean => explored.has(`${x},${y}`)
  // 只对未探索格调用（画迷雾时就是这个前提）：相邻格 1、斜对角 2、再远按切比雪夫往外推
  assert.equal(exploredDistance({ x: 11, y: 10 }, isExplored), 1)
  assert.equal(exploredDistance({ x: 11, y: 11 }, isExplored), 1)
  assert.equal(exploredDistance({ x: 12, y: 12 }, isExplored), 2)
  assert.equal(exploredDistance({ x: 13, y: 10 }, isExplored), 3)
  assert.equal(exploredDistance({ x: 30, y: 30 }, isExplored, 4), 5, '扫描半径外返回半径 + 1')
})

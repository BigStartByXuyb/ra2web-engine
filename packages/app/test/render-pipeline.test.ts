import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  computeRenderTargetSize,
  createBufferChain,
  resolvePrecision,
  resolveUniformValue,
} from '../src/game/render-pipeline.js'

test('RT 尺寸：按 pixelRatio 放大 + 下限 1 + 上限截断到 maxTextureSize', () => {
  assert.deepEqual(computeRenderTargetSize({ width: 1600, height: 900 }, 1, 8192), { width: 1600, height: 900 })
  assert.deepEqual(computeRenderTargetSize({ width: 800, height: 600 }, 2, 8192), { width: 1600, height: 1200 })
  assert.deepEqual(computeRenderTargetSize({ width: 0, height: -5 }, 1, 8192), { width: 1, height: 1 })
  assert.deepEqual(computeRenderTargetSize({ width: 9000, height: 9000 }, 1, 8192), { width: 8192, height: 8192 })
})

test('双缓冲链：swap 交替 current/next，链长与索引', () => {
  const chain = createBufferChain(2)
  assert.equal(chain.length, 2)
  assert.equal(chain.current, 0)
  chain.swap()
  assert.equal(chain.current, 1)
  chain.swap()
  assert.equal(chain.current, 0)
  chain.swap(3) // 任意步数取模
  assert.equal(chain.current, 1)
})

test('精度决策表：WebGL2+half-float 可渲染 → half；任一缺失 → byte', () => {
  assert.equal(resolvePrecision({ isWebGL2: true, halfFloatRenderable: true }), 'half')
  assert.equal(resolvePrecision({ isWebGL2: true, halfFloatRenderable: false }), 'byte')
  assert.equal(resolvePrecision({ isWebGL2: false, halfFloatRenderable: true }), 'byte')
  assert.equal(resolvePrecision({ isWebGL2: false, halfFloatRenderable: false }), 'byte')
})

test('uniform 惰性求值：数值/数组原样，函数在施加时调用（texelSize 随 resize 自适应用）', () => {
  assert.deepEqual(resolveUniformValue(1.5), [1.5])
  assert.deepEqual(resolveUniformValue([0.1, 0.2]), [0.1, 0.2])
  let calls = 0
  const lazy = () => {
    calls++
    return [1 / 1600, 1 / 900] as const
  }
  assert.deepEqual(resolveUniformValue(lazy), [1 / 1600, 1 / 900])
  assert.equal(calls, 1, '函数值应在求值时调用一次')
})

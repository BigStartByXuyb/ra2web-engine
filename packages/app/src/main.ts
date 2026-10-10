import {
  GOLDEN_FINAL_HASH,
  SCENARIO_TICKS,
  buildScenarioWorld,
  applyScenarioScript,
  runScenario,
} from '@ra2web/scenarios'
import { hashWorld, step } from '@ra2web/sim'
import { drawWorld } from './render.js'

/**
 * 浏览器端入口。
 *
 * 1) 先跑完整场景，拿到全部逐 tick 哈希（同步、无渲染）；
 * 2) 再用同一场景重跑一遍做逐帧播放，画布上看到的就是被哈希的那份状态。
 */

const canvas = document.getElementById('view') as HTMLCanvasElement
const tickLabel = document.getElementById('tick')!
const hashLabel = document.getElementById('hash')!
const finalLabel = document.getElementById('final')!
const goldenLabel = document.getElementById('golden')!
const verdictLabel = document.getElementById('verdict')!
const elapsedLabel = document.getElementById('elapsed')!
const countLabel = document.getElementById('count')!
const trace = document.getElementById('trace')!

const startedAt = performance.now()
const run = runScenario(SCENARIO_TICKS)
const elapsed = performance.now() - startedAt

finalLabel.textContent = run.finalHash
goldenLabel.textContent = GOLDEN_FINAL_HASH
countLabel.textContent = String(run.hashes.length)
elapsedLabel.textContent = `${elapsed.toFixed(1)} ms`

const matches = run.finalHash === GOLDEN_FINAL_HASH
verdictLabel.textContent = matches ? '一致 ✓' : '不一致 ✗'
verdictLabel.className = matches ? 'ok' : 'bad'

for (let tick = 20; tick <= SCENARIO_TICKS; tick += 20) {
  const item = document.createElement('li')
  item.textContent = `tick ${String(tick).padStart(4)}  ${run.hashes[tick - 1] ?? '-'}`
  trace.append(item)
}

// 逐帧播放：同一场景重跑，保证画面上看到的状态与哈希序列一一对应
const visual = buildScenarioWorld()
applyScenarioScript(visual)
let cursor = 0

function frame(): void {
  if (cursor < SCENARIO_TICKS) {
    step(visual)
    cursor++
  }
  drawWorld(canvas, visual)
  tickLabel.textContent = `${visual.tick} / ${SCENARIO_TICKS}`
  hashLabel.textContent = run.hashes[visual.tick - 1] ?? hashWorld(visual)
  if (cursor < SCENARIO_TICKS) requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

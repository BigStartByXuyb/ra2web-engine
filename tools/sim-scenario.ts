import { GOLDEN_FINAL_HASH, SCENARIO_TICKS, runScenario, worldAtTick } from '@ra2web/scenarios'
import { hashWorld } from '@ra2web/sim'

/**
 * 跑确定性基准场景，打印逐 tick 与末态哈希。
 * 用途：① 生成回归快照；② 与浏览器端对照。
 *
 * 场景本身定义在 `@ra2web/scenarios`，这里不重复一份 —— Node 与浏览器必须跑同一段代码。
 *
 * 用法：tsx tools/sim-scenario.ts [ticks=200] [--quiet]
 */
const args = process.argv.slice(2)
const ticks = Number(args.find((arg) => !arg.startsWith('--')) ?? SCENARIO_TICKS)
const quiet = args.includes('--quiet')

const run1 = runScenario(ticks)
if (!quiet) {
  for (let tick = 20; tick <= ticks; tick += 20) {
    console.log(`tick ${String(tick).padStart(4)}  ${run1.hashes[tick - 1] ?? '-'}`)
  }
}
console.log(`末态哈希 ${run1.finalHash}（tick ${ticks}）`)

if (!quiet) {
  const second = worldAtTick(ticks)
  const secondHash = hashWorld(second)
  console.log(`二次运行 ${secondHash} → ${secondHash === run1.finalHash ? '一致' : '不一致（有不确定性！）'}`)
  console.log(
    `Node 端快照常量 GOLDEN_FINAL_HASH = ${GOLDEN_FINAL_HASH} → ${GOLDEN_FINAL_HASH === run1.finalHash ? '相符' : '需要更新'}`,
  )
}

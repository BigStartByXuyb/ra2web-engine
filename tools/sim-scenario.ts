import { ONE } from '../packages/sim/src/fixed.js'
import { hashWorld } from '../packages/sim/src/hash.js'
import { createWorld, enqueueCommand, run, step, type World } from '../packages/sim/src/world.js'

/**
 * 跑一段固定脚本，打印逐 tick 与末态哈希。
 * 用途：① 生成回归快照；② 人工核对确定性。
 *
 * 用法：tsx tools/sim-scenario.ts [ticks=200] [--quiet]
 */
const args = process.argv.slice(2)
const ticks = Number(args.find((arg) => !arg.startsWith('--')) ?? 200)
const quiet = args.includes('--quiet')

function build(): World {
  return createWorld({
    width: 20,
    height: 20,
    blocked: [
      { x: 6, y: 4 },
      { x: 6, y: 5 },
      { x: 6, y: 6 },
      { x: 6, y: 7 },
      { x: 10, y: 12 },
      { x: 11, y: 12 },
      { x: 12, y: 12 },
    ],
    units: [
      { owner: 0, cell: { x: 1, y: 1 }, speed: ONE / 3, health: 300 },
      { owner: 0, cell: { x: 2, y: 2 }, speed: ONE / 4, health: 200 },
      { owner: 1, cell: { x: 18, y: 18 }, speed: ONE / 5, health: 400 },
    ],
    seed: 20261010,
  })
}

function script(world: World): void {
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 15, y: 3 } })
  enqueueCommand(world, 3, { kind: 'move', unitId: 2, target: { x: 12, y: 9 } })
  enqueueCommand(world, 7, { kind: 'move', unitId: 3, target: { x: 4, y: 17 } })
  enqueueCommand(world, 40, { kind: 'stop', unitId: 2 })
  enqueueCommand(world, 41, { kind: 'move', unitId: 2, target: { x: 3, y: 16 } })
  enqueueCommand(world, 90, { kind: 'move', unitId: 1, target: { x: 1, y: 1 } })
}

const world = build()
script(world)
for (let tick = 0; tick < ticks; tick++) {
  step(world)
  if (!quiet && (world.tick % 20 === 0 || world.tick === ticks)) {
    console.log(`tick ${String(world.tick).padStart(4)}  ${hashWorld(world)}`)
  }
}
const finalHash = hashWorld(world)
console.log(`末态哈希 ${finalHash}（tick ${world.tick}）`)

if (!quiet) {
  const other = build()
  script(other)
  run(other, ticks)
  console.log(`二次运行 ${hashWorld(other)} → ${hashWorld(other) === finalHash ? '一致' : '不一致（有不确定性！）'}`)
}

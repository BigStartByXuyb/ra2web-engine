import { ONE, createWorld, enqueueCommand, step } from '../packages/sim/src/index.js'

// 斜向移动演示：从 (4,4) 直线走到 (10,10)，打印逐 tick 定点坐标（1 格 = 256）。
// 预期：每个 tick x 与 y 同步前进（直线），而不是先横完再竖走。

const world = createWorld({
  width: 32,
  height: 32,
  units: [{ owner: 0, cell: { x: 4, y: 4 }, speed: 96, health: 100 }],
  seed: 1,
})
enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 10, y: 10 } })

const rows: string[] = []
for (let i = 0; i < 90; i++) {
  step(world)
  const u = world.units[0]!
  const gx = (u.x / ONE).toFixed(2)
  const gy = (u.y / ONE).toFixed(2)
  rows.push(`tick ${String(i + 1).padStart(2)}: x=${gx} y=${gy} facing=${u.facing}`)
  if (u.path.length === 0 && i > 5) break
}
console.log(rows.join('\n'))

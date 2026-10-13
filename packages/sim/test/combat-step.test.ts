import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SHELL_FLIGHT_TICKS, TURRET_AIM_RATE } from '../src/combat-step.js'
import { ONE } from '../src/fixed.js'
import { createWorld, enqueueCommand, step, type WorldOptions } from '../src/world.js'
import { hashWorld } from '../src/hash.js'
import type { UnitWeapon } from '../src/combat.js'

/**
 * 战斗集成（docs/COMBAT-STAGE3-CLOSURE.md）：目标检查 → 炮塔瞄准（FacingClass 第二份）
 * → 对齐判定 → 开火（ROF 冷却）→ 弹体（发射时定终点，散布）→ 定时插值 →
 * 到点 AoE → Verses 修正扣血。
 *
 * 自定项（原版未核，见 combat-step.ts 头注释）：TURRET_AIM_RATE=4096（4 tick 转 90°）、
 * SHELL_FLIGHT_TICKS=6、伤害 Math.round、射程外不瞄不开火。
 */

const WEAPON: UnitWeapon = {
  range: 10,
  minRange: 0,
  rof: 20,
  damage: 100,
  verses: Array.from({ length: 11 }, () => 1),
  cellSpread: 1,
}

function duelWorld(overrides: Partial<WorldOptions> = {}) {
  // A 在 (1,4) 面北（facing 0）；B 在 (5,4) 正东 → 目标角 0x4000（4×4096/step 的转向对齐）
  const world = createWorld({
    width: 10,
    height: 10,
    units: [
      { owner: 0, cell: { x: 1, y: 4 }, speed: ONE, health: 300, weapon: WEAPON, armorIndex: 0 },
      { owner: 1, cell: { x: 5, y: 4 }, speed: ONE, health: 500, armorIndex: 0 },
    ],
    seed: 7,
    ...overrides,
  })
  return world
}

test('完整链：炮塔转向对齐（4 tick）→ 开火 → 弹体 6 tick → 爆炸扣血', () => {
  const world = duelWorld()
  enqueueCommand(world, 0, { kind: 'attack', unitId: 1, targetUnitId: 2 })
  const a = world.units[0]!
  const b = world.units[1]!

  // tick1：发现目标、开始转动（北 0 → 东 0x4000），未对齐不开火
  step(world)
  assert.equal(a.turret.target, 0x4000)
  assert.ok(a.turret.current > 0 && a.turret.current < 0x4000, `转动中 ${a.turret.current}`)
  assert.equal(world.shells.length, 0)

  step(world)
  step(world)
  assert.equal(world.shells.length, 0, 'tick3 仍未对齐（差 4096）')

  // tick4：advanceFacing 到点收敛 → 同 tick 开火
  step(world)
  assert.equal(a.turret.current, 0x4000, 'tick4 应恰好对齐')
  assert.equal(world.shells.length, 1, 'tick4 对齐后开火')
  assert.equal(a.cooldown, WEAPON.rof, '开火后进入 ROF 冷却')

  // 弹体飞行：起点=A 位置、终点=目标位置（无散布时）；6 tick 后引爆
  const shell = world.shells[0]!
  assert.equal(shell.x0, a.x)
  assert.equal(shell.y0, a.y)
  assert.equal(shell.x1, b.x)
  assert.equal(shell.y1, b.y)
  assert.equal(shell.startTick, 4)
  assert.equal(shell.duration, SHELL_FLIGHT_TICKS)

  for (let i = 0; i < SHELL_FLIGHT_TICKS - 1; i++) step(world)
  assert.equal(world.shells.length, 1, '到期前一 tick 弹体仍在飞')
  assert.equal(b.health, 500, '未引爆不掉血')

  step(world)
  assert.equal(world.shells.length, 0, '到期 tick 引爆')
  assert.equal(b.health, 500 - 100, 'AoE 内 Verses=1 → 全额 100')
})

test('冷却期间不连发（ROF）：对齐稳定后 20 tick 内只发 1 弹', () => {
  const world = duelWorld()
  enqueueCommand(world, 0, { kind: 'attack', unitId: 1, targetUnitId: 2 })
  let fired = 0
  for (let i = 0; i < 20; i++) {
    const before = world.shells.length
    step(world)
    if (world.shells.length > before) fired++
  }
  assert.equal(fired, 1, '20 tick 内（ROF=20）只应开火 1 次')
})

test('射程外不瞄不开火（本项目自定：走位搜索未集成）', () => {
  const world = duelWorld({
    units: [
      { owner: 0, cell: { x: 0, y: 0 }, speed: ONE, health: 300, weapon: WEAPON, armorIndex: 0 },
      { owner: 1, cell: { x: 9, y: 9 }, speed: ONE, health: 500, armorIndex: 0 }, // 距离 ≈ 12.7 格 > 10
    ],
  })
  enqueueCommand(world, 0, { kind: 'attack', unitId: 1, targetUnitId: 2 })
  for (let i = 0; i < 30; i++) step(world)
  assert.equal(world.shells.length, 0, '射程外 30 tick 不发弹')
  assert.equal(world.units[1]!.health, 500)
})

test('目标死亡后停火（combatAim/combatFire 的存活检查）', () => {
  const world = duelWorld()
  enqueueCommand(world, 0, { kind: 'attack', unitId: 1, targetUnitId: 2 })
  world.units[1]!.health = 0 // 直接击杀
  for (let i = 0; i < 10; i++) step(world)
  assert.equal(world.shells.length, 0, '目标已死不开火')
})

test('散布：scatter=0 落点=目标；scatter>0 时同种子两世界逐 tick 哈希一致（确定性）', () => {
  const mk = (seed: number) => {
    const world = duelWorld({ ballisticScatter: 40, seed })
    enqueueCommand(world, 0, { kind: 'attack', unitId: 1, targetUnitId: 2 })
    return world
  }
  const w1 = mk(7)
  const w2 = mk(7)
  const w3 = mk(8)
  for (let i = 0; i < 30; i++) {
    step(w1)
    step(w2)
    step(w3)
    assert.equal(hashWorld(w1), hashWorld(w2), `同种子 tick${i + 1} 哈希分叉`)
  }
  // 同种子逐字段一致（含散布落点）
  assert.deepEqual(
    w1.shells.map((s) => [s.x1, s.y1]),
    w2.shells.map((s) => [s.x1, s.y1]),
  )
})

test('攻击命令不打乱移动：先 move 再 attack，路径保留', () => {
  const world = duelWorld()
  enqueueCommand(world, 0, { kind: 'move', unitId: 1, target: { x: 3, y: 4 } })
  enqueueCommand(world, 1, { kind: 'attack', unitId: 1, targetUnitId: 2 })
  step(world)
  assert.ok(world.units[0]!.path.length > 0, '移动路径仍在')
  assert.equal(world.units[0]!.attackTargetId, 2, '攻击目标已设')
})

test('TURRET_AIM_RATE 常量自定值（4096/tick，90° 需 4 tick）', () => {
  // 推导锚：0x4000/4096 = 4
  assert.equal(0x4000 / TURRET_AIM_RATE, 4)
})

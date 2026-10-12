import { ONE, createWorld, enqueueCommand, hashWorld, step, type World } from '@ra2web/sim'

/**
 * 确定性基准场景：20×20 地图 + 一道墙 + 三个单位 + 六条带 tick 的指令。
 * Node 与浏览器共用这份输入，两端的逐 tick 哈希必须完全一致。
 */

export const SCENARIO_TICKS = 200

/** Node 端确认过的末态哈希；浏览器端跑出别的值就说明存在平台相关的不确定性。
 * 2026-10-12 有意更新（fc71c296 → 277e4fb6）：移动层改为八方向直线推进 + 朝向
 * （docs/ENGINE-MAP.md「单位移动核心」），机制变更必然改哈希；这条钉的是"跨端一致"。 */
export const GOLDEN_FINAL_HASH = '277e4fb6'

export function buildScenarioWorld(): World {
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

export function applyScenarioScript(world: World): void {
  enqueueCommand(world, 1, { kind: 'move', unitId: 1, target: { x: 15, y: 3 } })
  enqueueCommand(world, 3, { kind: 'move', unitId: 2, target: { x: 12, y: 9 } })
  enqueueCommand(world, 7, { kind: 'move', unitId: 3, target: { x: 4, y: 17 } })
  enqueueCommand(world, 40, { kind: 'stop', unitId: 2 })
  enqueueCommand(world, 41, { kind: 'move', unitId: 2, target: { x: 3, y: 16 } })
  enqueueCommand(world, 90, { kind: 'move', unitId: 1, target: { x: 1, y: 1 } })
}

export interface ScenarioRun {
  readonly world: World
  /** 每个 tick 之后的状态哈希，hashes[0] 对应 tick 1 */
  readonly hashes: readonly string[]
  readonly finalHash: string
}

/** 跑完整场景并收集逐 tick 哈希。 */
export function runScenario(ticks: number = SCENARIO_TICKS): ScenarioRun {
  const world = buildScenarioWorld()
  applyScenarioScript(world)
  const hashes: string[] = []
  for (let tick = 0; tick < ticks; tick++) {
    step(world)
    hashes.push(hashWorld(world))
  }
  return { world, hashes, finalHash: hashes[hashes.length - 1] ?? hashWorld(world) }
}

/** 新起一个世界并推进到指定 tick，供逐帧播放使用（与 runScenario 结果必然一致）。 */
export function worldAtTick(tick: number): World {
  const world = buildScenarioWorld()
  applyScenarioScript(world)
  for (let i = 0; i < tick; i++) step(world)
  return world
}

export { FIXTURE_RULES_INI } from './fixture.js'
export {
  applyFixtureScript,
  buildDataDrivenScene,
  buildFixtureScene,
  movementPerSecond,
  parseFixtureRules,
  runFixtureScenario,
  FIXTURE_GOLDEN_HASH,
} from './data-scene.js'
export type { DataSceneResult, FixtureRun, UnitSpawn } from './data-scene.js'

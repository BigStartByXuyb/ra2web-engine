import { loadRules, parseUnitType, type UnitType } from '@ra2web/rules'
import {
  TICKS_PER_SECOND,
  createWorld,
  enqueueCommand,
  hashWorld,
  speedToMovementPerTick,
  step,
  type Cell,
  type World,
} from '@ra2web/sim'
import { FIXTURE_RULES_INI } from './fixture.js'

/**
 * 数据驱动的场景构建：单位数值来自 INI，而不是写死在场景代码里。
 *
 * 这一步把 `rules`（读表）与 `sim`（跑模拟）接起来 —— 之前两者是互不相干的两个包。
 */

export interface UnitSpawn {
  readonly unitId: string
  readonly owner: number
  readonly cell: Cell
}

export interface DataSceneResult {
  readonly world: World
  /** 参与本次场景的单位定义，供界面展示"数值从哪里来" */
  readonly unitTypes: readonly UnitType[]
}

export function parseFixtureRules(): readonly UnitType[] {
  const rules = loadRules([{ name: 'fixture-rules.ini', text: FIXTURE_RULES_INI }])
  const ids = ['HTNK', 'SMCV']
  return ids.map((id) => parseUnitType(rules, id)).filter((unit): unit is UnitType => unit !== undefined)
}

export function buildDataDrivenScene(
  unitTypes: readonly UnitType[],
  spawns: readonly UnitSpawn[],
  options: {
    readonly width: number
    readonly height: number
    readonly blocked?: readonly Cell[]
    readonly blockedSteps?: Uint8Array
    /** 每格地表速度系数（0..1），见 `WorldOptions.terrainSpeed` */
    readonly terrainSpeed?: Float32Array
    /** 上阵血量百分比（1..100）：伤车减速的人工验证入口，缺省满血 */
    readonly spawnHealthPercent?: number
    readonly seed: number
  },
): DataSceneResult {
  const byId = new Map(unitTypes.map((unit) => [unit.id.toLowerCase(), unit]))
  const units = spawns.map((spawn) => {
    const type = byId.get(spawn.unitId.toLowerCase())
    if (!type) throw new Error(`场景引用了未定义的兵种：${spawn.unitId}`)
    if (type.strength === undefined) throw new Error(`${type.id} 缺少 Strength，无法上阵`)
    if (type.speed === undefined) throw new Error(`${type.id} 缺少 Speed，无法上阵`)
    const health =
      options.spawnHealthPercent !== undefined
        ? Math.max(1, Math.round((type.strength * options.spawnHealthPercent) / 100))
        : type.strength
    return {
      owner: spawn.owner,
      cell: spawn.cell,
      health,
      // 伤车判定（ConditionYellow ×0.75）需要满血值；maxHealth 永远是类型满血
      maxHealth: type.strength,
      speed: speedToMovementPerTick(type.speed),
      ...(type.sight !== undefined ? { sight: type.sight } : {}),
    }
  })
  const world = createWorld({ ...options, units })
  return { world, unitTypes }
}

/** 浏览器演示用的数据驱动场景：两辆犀牛 + 一辆基地车，数值全部来自夹具 INI。 */
export function buildFixtureScene(): DataSceneResult {
  const unitTypes = parseFixtureRules()
  return buildDataDrivenScene(
    unitTypes,
    [
      { unitId: 'HTNK', owner: 0, cell: { x: 2, y: 2 } },
      { unitId: 'HTNK', owner: 0, cell: { x: 2, y: 5 } },
      { unitId: 'SMCV', owner: 1, cell: { x: 17, y: 17 } },
    ],
    {
      width: 20,
      height: 20,
      blocked: [
        { x: 6, y: 4 },
        { x: 6, y: 5 },
        { x: 6, y: 6 },
        { x: 6, y: 7 },
      ],
      seed: 20261010,
    },
  )
}

/** 每 tick 位移换算成"格/秒"，便于界面核对。 */
export function movementPerSecond(type: UnitType): number {
  if (type.speed === undefined) return 0
  return (speedToMovementPerTick(type.speed) / 256) * TICKS_PER_SECOND
}

/** 数据驱动场景的演出脚本：两辆犀牛分别向东北与东南推进。 */
export function applyFixtureScript(world: World): void {
  const [first, second] = world.units
  if (first) enqueueCommand(world, 1, { kind: 'move', unitId: first.id, target: { x: 15, y: 8 } })
  if (second) enqueueCommand(world, 20, { kind: 'move', unitId: second.id, target: { x: 14, y: 16 } })
}

export interface FixtureRun {
  readonly world: World
  readonly hashes: readonly string[]
  readonly finalHash: string
  readonly unitTypes: readonly UnitType[]
}

/** 跑完整的数据驱动场景，返回逐 tick 哈希与用到的兵种定义。 */
export function runFixtureScenario(ticks = 200): FixtureRun {
  const { world, unitTypes } = buildFixtureScene()
  applyFixtureScript(world)
  const hashes: string[] = []
  for (let tick = 0; tick < ticks; tick++) {
    step(world)
    hashes.push(hashWorld(world))
  }
  return { world, hashes, finalHash: hashes[hashes.length - 1] ?? hashWorld(world), unitTypes }
}

/** 数据驱动场景的 Node 端末态快照，供浏览器端对照。 */
export const FIXTURE_GOLDEN_HASH = 'FIXTURE_PLACEHOLDER'

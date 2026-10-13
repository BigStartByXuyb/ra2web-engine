import {
  armorIndex,
  loadRules,
  parseUnitType,
  parseWarheadType,
  parseWeaponType,
  type RawRules,
  type UnitType,
} from '@ra2web/rules'
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

/**
 * 从 rules 按单位类型的 Primary 武器名装配 sim 的 UnitWeapon（战斗线阶段 1/3 口径）。
 * 关键字段（Damage/ROF/Range）缺失视为无武器；Warhead 缺失时 Verses 全 1、CellSpread 0。
 */
function weaponOf(rules: RawRules | undefined, type: UnitType): import('@ra2web/sim').UnitWeapon | undefined {
  if (!rules || !type.primary) return undefined
  const weapon = parseWeaponType(rules, type.primary)
  if (!weapon || weapon.damage === undefined || weapon.rof === undefined || weapon.range === undefined) {
    return undefined
  }
  const warhead = weapon.warhead !== undefined ? parseWarheadType(rules, weapon.warhead) : undefined
  return {
    range: weapon.range,
    minRange: weapon.minimumRange ?? 0,
    rof: weapon.rof,
    damage: weapon.damage,
    verses: warhead?.verses ?? Array.from({ length: 11 }, () => 1),
    cellSpread: warhead?.cellSpread ?? 0,
  }
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
    /** 每格高度级（一级 = 90 lepton），见 `WorldOptions.heights` */
    readonly heights?: Int8Array
    /** 坡度乘数（rules.ini [General] Tracked/Wheeled Uphill/Downhill），见 `WorldOptions.slopeFactors` */
    readonly slopeFactors?: import('@ra2web/sim').SlopeFactors
    /** 上阵血量百分比（1..100）：伤车减速的人工验证入口，缺省满血 */
    readonly spawnHealthPercent?: number
    /** rules 表：给了就按 `type.primary` 装配武器（战斗线集成）；不给 = 无武器 */
    readonly rules?: RawRules
    /** 弹道散布上限（原版 rules+0x139c BallisticScatter）；给了就传进 world */
    readonly ballisticScatter?: number
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
      // 坡度乘数选组：SpeedType=Track（履带）走 Tracked 组，其余走 Wheeled/other 组
      ...(type.speedType !== undefined
        ? { slopeClass: (type.speedType === 'Track' ? 'track' : 'other') as 'track' | 'other' }
        : {}),
      ...(type.sight !== undefined ? { sight: type.sight } : {}),
      // 炮塔独立旋转门控（原版 Type+0xaed TurretSpins）：sim 用它在无战斗目标时决定炮塔是否追随车体
      ...(type.turretSpins ? { turretSpins: true } : {}),
      // 武器装配（战斗线集成）：Primary → WeaponType（+WarheadType 的 Verses/CellSpread）；
      // 全部字段来自 rules 解析（阶段 1 取证口径），缺关键字段则视为无武器
      ...(weaponOf(options.rules, type) !== undefined ? { weapon: weaponOf(options.rules, type)! } : {}),
      ...(type.armor !== undefined && armorIndex(type.armor) !== undefined
        ? { armorIndex: armorIndex(type.armor)! }
        : {}),
    }
  })
  const world = createWorld({
    ...options,
    ...(options.ballisticScatter !== undefined ? { ballisticScatter: options.ballisticScatter } : {}),
    units,
  } as Parameters<typeof createWorld>[0])
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

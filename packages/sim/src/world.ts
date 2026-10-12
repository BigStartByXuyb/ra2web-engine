import { type Command, type CommandInput } from './command.js'
import { fromFixed } from './fixed.js'
import { createGrid, type Cell, type Grid } from './grid.js'
import { findPath } from './path.js'
import { createRng, type RngState } from './rng.js'
import { DEFAULT_SIGHT, createShroud, updateShroud, type Shroud } from './shroud.js'
import { advanceAlongPath, createUnit, unitCell, type Unit } from './unit.js'

/**
 * 世界状态与 tick 推进。
 *
 * 状态转移只发生在 `step` 里：先应用到期的指令，再推进单位。指令按 (tick, 入队序号) 排序，
 * 因此同一批指令无论以什么顺序入队，只要最终集合相同，结果就相同。
 *
 * 碰撞：单位逐格占格（证据见 docs/ENGINE-MAP.md「单位移动核心」——原版每步推进前查
 * `Can_Enter_Cell`，目标格被占就进不去并等待）。推进按单位 id 序处理，占用表随移动即时更新，
 * 后处理的单位能看到先处理单位的让位。被挡等待的时长与重规划时机是本项目自定
 * （原版用随机等待，分布未核；本实现处理序确定，无需随机也满足确定性）。
 */

/** 被挡后原地等待的 tick 数，超过就按当前占用重规划（本项目自定）。 */
const BLOCKED_WAIT_TICKS = 15

export interface UnitSpec {
  readonly owner: number
  readonly cell: Cell
  readonly speed: number
  readonly health: number
  /** 满血值（单位类型的 Strength）；伤车判定用它算血量百分比。缺省按 health。 */
  readonly maxHealth?: number
  /** 视野半径（格）；不给按客户端缺省值 1 */
  readonly sight?: number
}

/** 伤车慢速参数：血量百分比 ≤ threshold 时移速 ×factor。
 *  原版证据（fn-4a2670 + 0x5d4540 + rules+0x1368=ConditionYellow）：阈值来自
 *  rules.ini `[General] ConditionYellow`（实测 50%），系数 0.75 写死在代码里。 */
export interface CrippledRule {
  readonly threshold: number
  readonly factor: number
}

export interface WorldOptions {
  readonly width: number
  readonly height: number
  readonly blocked?: readonly Cell[]
  /** 相邻格之间的阻挡（长度 width×height×4，见 `createGrid`）；不给就不做边判定 */
  readonly blockedSteps?: Uint8Array
  /** 每格地表速度系数（长度 width×height，0..1；原版 0x850ea0 表 × 移动类型的乘积，已封顶 1）。
   *  静态数据，不进世界状态哈希。不给就全 1。 */
  readonly terrainSpeed?: Float32Array
  /** 伤车慢速（ConditionYellow ×0.75）；不给就不做伤车判定 */
  readonly crippled?: CrippledRule
  readonly units: readonly UnitSpec[]
  readonly seed: number
}

export interface World {
  tick: number
  readonly grid: Grid
  readonly units: Unit[]
  /** 迷雾：每个玩家各一份"探索过 / 当前可见" */
  readonly shroud: Shroud
  readonly rng: RngState
  /** 每格地表速度系数（静态数据，与 grid.blockedSteps 同类，不进哈希） */
  readonly terrainSpeed: Float32Array | undefined
  /** 伤车慢速规则（静态数据，不进哈希）；undefined = 不做伤车判定 */
  readonly crippled: CrippledRule | undefined
  pending: Command[]
  /** 入队序号，用于同 tick 指令的稳定排序 */
  sequence: number
}

export function createWorld(options: WorldOptions): World {
  const grid = createGrid(options.width, options.height, options.blocked ?? [], options.blockedSteps)
  const units = options.units.map((spec, index) =>
    createUnit(
      index + 1,
      spec.owner,
      spec.cell,
      spec.speed,
      spec.health,
      spec.sight ?? DEFAULT_SIGHT,
      0,
      undefined,
      spec.maxHealth,
    ),
  )
  const ownerCount = units.reduce((max, unit) => Math.max(max, unit.owner + 1), 1)
  const shroud = createShroud(ownerCount, options.width, options.height)
  updateShroud(shroud, units)
  return {
    tick: 0,
    grid,
    units,
    shroud,
    rng: createRng(options.seed),
    terrainSpeed: options.terrainSpeed,
    crippled: options.crippled,
    pending: [],
    sequence: 0,
  }
}

export function enqueueCommand(world: World, tick: number, input: CommandInput): void {
  const sequence = world.sequence++
  const command: Command =
    input.kind === 'move'
      ? { sequence, tick, kind: 'move', unitId: input.unitId, target: input.target }
      : { sequence, tick, kind: 'stop', unitId: input.unitId }
  world.pending.push(command)
}

function applyDueCommands(world: World): void {
  const due = world.pending
    .filter((command) => command.tick <= world.tick)
    .sort((a, b) => a.tick - b.tick || a.sequence - b.sequence)
  if (due.length === 0) return
  const handled = new Set(due)
  world.pending = world.pending.filter((command) => !handled.has(command))

  for (const command of due) {
    const unit = world.units.find((candidate) => candidate.id === command.unitId)
    if (!unit) continue
    if (command.kind === 'stop') {
      unit.path = []
      unit.pathIndex = 0
      continue
    }
    const from = { x: fromFixed(unit.x), y: fromFixed(unit.y) }
    const path = findPath(world.grid, from, command.target)
    unit.target = { ...command.target }
    unit.path = path ? [...path] : []
    unit.pathIndex = 0
    unit.blockedTicks = 0
  }
}

/** 单位当前占的格索引。 */
function occupiedIndex(grid: Grid, unit: Unit): number {
  const cell = unitCell(unit)
  return cell.y * grid.width + cell.x
}

/**
 * 推进一 tick。模拟内唯一的状态推进入口。
 *
 * 占用表在 tick 开始时建立，随每个单位的移动即时更新；单位按 id 序处理。
 */
export function step(world: World): void {
  world.tick += 1
  applyDueCommands(world)

  const occupancy = new Map<number, number>()
  for (const unit of world.units) {
    if (unit.health > 0) occupancy.set(occupiedIndex(world.grid, unit), unit.id)
  }

  for (const unit of world.units) {
    if (unit.health <= 0 || unit.path.length === 0) continue
    const waypoint = unit.path[unit.pathIndex]!
    const waypointIndex = waypoint.y * world.grid.width + waypoint.x
    const holder = occupancy.get(waypointIndex)
    if (holder !== undefined && holder !== unit.id) {
      // 下一格被别的单位占着：原地等待，超时就按当前占用重规划
      unit.blockedTicks += 1
      if (unit.blockedTicks >= BLOCKED_WAIT_TICKS) {
        unit.blockedTicks = 0
        if (unit.target) {
          const from = unitCell(unit)
          const detour = findPath(world.grid, from, unit.target, occupancy)
          if (detour) {
            unit.path = [...detour]
            unit.pathIndex = 0
          }
        }
      }
      continue
    }
    unit.blockedTicks = 0
    // 地表速度系数（原版 min(1.0, 表[移动类型 + 地表×9])，0 兜底 0.5）；
    // "当前格 vs 进入格"口径未核，本项目按当前格（自定，待核）
    let effective = unit.speed
    if (world.terrainSpeed) {
      const cell = unitCell(unit)
      const raw = world.terrainSpeed[cell.y * world.grid.width + cell.x] ?? 1
      const factor = raw <= 0 ? 0.5 : Math.min(raw, 1)
      effective = Math.floor(unit.speed * factor)
    }
    // 伤车慢速（原版 0x5d4540 ≤ ConditionYellow → ×0.75，见 CrippledRule 注释）
    if (world.crippled && unit.maxHealth > 0) {
      if (unit.health / unit.maxHealth <= world.crippled.threshold) {
        effective = Math.floor(effective * world.crippled.factor)
      }
    }
    advanceAlongPath(unit, effective)
    occupancy.delete(occupiedIndex(world.grid, unit))
    if (unit.path.length > 0) {
      occupancy.set(occupiedIndex(world.grid, unit), unit.id)
    } else {
      unit.target = undefined
    }
  }

  updateShroud(world.shroud, world.units)
}

export function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world)
}

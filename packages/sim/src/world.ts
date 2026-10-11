import { type Command, type CommandInput } from './command.js'
import { fromFixed } from './fixed.js'
import { createGrid, type Cell, type Grid } from './grid.js'
import { findPath } from './path.js'
import { createRng, type RngState } from './rng.js'
import { advanceAlongPath, createUnit, type Unit } from './unit.js'

/**
 * 世界状态与 tick 推进。
 *
 * 状态转移只发生在 `step` 里：先应用到期的指令，再推进单位。指令按 (tick, 入队序号) 排序，
 * 因此同一批指令无论以什么顺序入队，只要最终集合相同，结果就相同。
 */

export interface UnitSpec {
  readonly owner: number
  readonly cell: Cell
  readonly speed: number
  readonly health: number
}

export interface WorldOptions {
  readonly width: number
  readonly height: number
  readonly blocked?: readonly Cell[]
  /** 相邻格之间的阻挡（长度 width×height×4，见 `createGrid`）；不给就不做边判定 */
  readonly blockedSteps?: Uint8Array
  readonly units: readonly UnitSpec[]
  readonly seed: number
}

export interface World {
  tick: number
  readonly grid: Grid
  readonly units: Unit[]
  readonly rng: RngState
  pending: Command[]
  /** 入队序号，用于同 tick 指令的稳定排序 */
  sequence: number
}

export function createWorld(options: WorldOptions): World {
  const grid = createGrid(options.width, options.height, options.blocked ?? [], options.blockedSteps)
  const units = options.units.map((spec, index) =>
    createUnit(index + 1, spec.owner, spec.cell, spec.speed, spec.health),
  )
  return { tick: 0, grid, units, rng: createRng(options.seed), pending: [], sequence: 0 }
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
    unit.path = path ? [...path] : []
    unit.pathIndex = 0
  }
}

/** 推进一 tick。模拟内唯一的状态推进入口。 */
export function step(world: World): void {
  world.tick += 1
  applyDueCommands(world)
  for (const unit of world.units) {
    if (unit.health > 0) advanceAlongPath(unit)
  }
}

export function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world)
}

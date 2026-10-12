import { readLocalText } from '@ra2web/assets'
import { loadRules, parseUnitType, valueOf, type UnitType } from '@ra2web/rules'
import { buildDataDrivenScene, type UnitSpawn } from '@ra2web/scenarios'
import { ONE, createWorld, type Cell, type World } from '@ra2web/sim'

/**
 * 对战：把档案变成一局可跑的战场状态。
 *
 * 本模块不碰 DOM、不装载美术：数值来自 `rules.ini`，模拟状态交给 `sim`，
 * 表现层（摄像机、画布、美术）在 `main.ts` 与 `unit-art.ts` 里。
 */

/** 界面要显示的单位定义：来自 `rules.ini`，内置示例时是固定值。 */
export interface UnitSummary {
  readonly id: string
  readonly name: string
  readonly strength: number | undefined
  readonly speed: number | undefined
}

export interface Battle {
  readonly world: World
  /** 与 world.units 同序：单位类型 ID，用来取美术 */
  readonly typeByUnit: readonly string[]
  /** 与 world.units 同序：界面显示的数值 */
  readonly summaryByUnit: readonly UnitSummary[]
  /** 视觉朝向，属于表现层，不进模拟状态 */
  readonly facingByUnit: number[]
  selectedIndex: number | undefined
}

export interface BattleOptions {
  readonly width: number
  readonly height: number
  readonly blocked: readonly Cell[]
  readonly blockedSteps?: Uint8Array
  /** 每格地表速度系数（0..1），见 `WorldOptions.terrainSpeed` */
  readonly terrainSpeed?: Float32Array
  readonly spawns: readonly UnitSpawn[]
  readonly seed: number
}

export function createBattle(archiveBytes: Uint8Array, options: BattleOptions): Battle {
  const rulesText = readRulesText(archiveBytes)
  const rules = loadRules([{ name: 'local.mix/rules.ini', text: rulesText }])
  const conditionYellow = conditionYellowOf(rules)
  const parsed = new Map<string, UnitType>()
  for (const spawn of options.spawns) {
    const key = spawn.unitId.toLowerCase()
    if (parsed.has(key)) continue
    const type = parseUnitType(rules, spawn.unitId)
    if (!type) throw new Error(`rules.ini 里没有 [${spawn.unitId}]`)
    parsed.set(key, type)
  }

  const scene = buildDataDrivenScene([...parsed.values()], options.spawns, {
    width: options.width,
    height: options.height,
    blocked: options.blocked,
    ...(options.blockedSteps ? { blockedSteps: options.blockedSteps } : {}),
    ...(options.terrainSpeed ? { terrainSpeed: options.terrainSpeed } : {}),
    ...(conditionYellow !== undefined ? { crippled: { threshold: conditionYellow, factor: CRIPPLED_FACTOR } } : {}),
    seed: options.seed,
  })
  return {
    world: scene.world,
    typeByUnit: options.spawns.map((spawn) => spawn.unitId),
    summaryByUnit: options.spawns.map((spawn) => summarize(spawn.unitId, parsed.get(spawn.unitId.toLowerCase()))),
    facingByUnit: options.spawns.map(() => 0),
    selectedIndex: undefined,
  }
}

/** 内置示例战场：不读档案，数值是固定值（不是原版数值），用于没有素材时看渲染与操作。 */
export function createDemoBattle(): Battle {
  const specs = [
    { owner: 0, cell: { x: 3, y: 3 }, speed: ONE / 12, health: 300 },
    { owner: 0, cell: { x: 3, y: 6 }, speed: ONE / 12, health: 300 },
    { owner: 0, cell: { x: 5, y: 4 }, speed: ONE / 16, health: 200 },
    { owner: 1, cell: { x: 20, y: 20 }, speed: ONE / 14, health: 400 },
    { owner: 1, cell: { x: 18, y: 22 }, speed: ONE / 14, health: 400 },
  ]
  return {
    world: createWorld({ width: 32, height: 32, blocked: buildDemoBlockedCells(), units: specs, seed: 20261010 }),
    typeByUnit: specs.map((_spec, index) => (index < 3 ? 'DEMO' : 'DEMO-A')),
    summaryByUnit: specs.map((_spec, index) =>
      index < 3
        ? { id: 'DEMO', name: '示例单位', strength: 300, speed: 12 }
        : { id: 'DEMO-A', name: '示例敌方单位', strength: 400, speed: 10 },
    ),
    facingByUnit: specs.map(() => 0),
    selectedIndex: undefined,
  }
}

function summarize(typeId: string, type: UnitType | undefined): UnitSummary {
  if (!type) return { id: typeId, name: typeId, strength: undefined, speed: undefined }
  return { id: type.id, name: type.displayName ?? type.id, strength: type.strength, speed: type.speed }
}

/** 伤车慢速系数：原版写死在推进核心里（fn-4a2670），不是 INI 键。 */
const CRIPPLED_FACTOR = 0.75

/** rules.ini `[General] ConditionYellow=50%` → 0.5（伤车阈值）。
 *  依据：推进核心 fn-4a2670 拿 FUN_005d4540（血量%）与 rules+0x1368 比较，
 *  而	INI 读值点（0x6464d0 附近）把 `ConditionYellow` 写进 rules+0x1368。 */
function conditionYellowOf(rules: ReturnType<typeof loadRules>): number | undefined {
  const raw = valueOf(rules, 'General', 'ConditionYellow')?.trim()
  if (!raw) return undefined
  const percent = raw.endsWith('%') ? Number(raw.slice(0, -1)) : Number(raw) * 100
  return Number.isFinite(percent) ? percent / 100 : undefined
}

function readRulesText(archiveBytes: Uint8Array): string {
  const text = readLocalText(archiveBytes, 'rules.ini')
  if (!text) throw new Error('档案里找不到 local.mix/rules.ini')
  return text
}

function buildDemoBlockedCells(): readonly Cell[] {
  const blocked: Cell[] = []
  for (let y = 6; y < 22; y++) {
    if (y === 13 || y === 14) continue
    blocked.push({ x: 11, y })
  }
  return blocked
}

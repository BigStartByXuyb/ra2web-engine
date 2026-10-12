import { parseBoolean, type ParseIssue } from './parse.js'
import { sectionOf, type RawRules } from './raw-rules.js'

/**
 * 地块类型（LandType）与各移动方式在它上面的通行系数。
 *
 * 段名就是类型名，**次序即引擎的枚举值**（`GAME.EXE` 按这个次序逐段读入）：
 * `Clear`、`Road`、`Water`、`Rock`、`Wall`、`Tiberium`、`Beach`、`Rough`、`Ice`、
 * `Railroad`、`Tunnel`、`Weeds`。段里的键是**移动方式**，值是百分比：`[Water] Track=0%`
 * 就是"履带车不能进水"，`[Clear] Track=100%` 是"正常通行"。
 *
 * 判定依据是原版 `GAME.EXE`（PE / x86，sha256 `fe67fdac…`）里加载这张表的函数 `VA 0x64d610`：
 * 段名指针表在 `0x7eebbc`（12 项），逐段把下表 9 个槽位写进 `0x850ea0`，步长 36 字节；
 * 表尾哨兵 `0x851054`，即 12 × 36 = 432 字节，存档序列化函数 `VA 0x657a60` 也按 `0x1b0` 刷这一段。
 *
 * 引擎的 12 段里 `Ice`、`Tunnel` 两段本项目还没收：地块类型来自 TMP 的 `terrainType`，
 * 而那份映射（`@ra2web/assets` 的 `landTypeOfTerrainType`）照抄客户端、还没对着引擎核实过，
 * 它不产出这两个地表。等引擎自己那张映射表读出来再一并收进来，避免先写一条没有来源的支路。
 *
 * | 槽位 | 0       | 1       | 2       | 3       | 4      | 5       | 6            | 7            | 8           |
 * | ---- | ------- | ------- | ------- | ------- | ------ | ------- | ------------ | ------------ | ----------- |
 * | 键   | `Foot`  | `Track` | `Wheel` | `Hover` | 不读 INI，恒 `1.0` | `Float` | `Amphibious` | `FloatBeach` | `Buildable` |
 *
 * 三条与"直接读百分比"不同的要点：
 *
 * - **缺键按 1.0**：读键时带默认值 `double 1.0`（`0x64d63a` 压栈的 `0x3ff00000, 0x0`），
 *   键不在段里取 1.0，不是取 0。
 * - **整段缺失按 0**：段不存在时整行不写（`0x64d632` 跳过），而出厂镜像 `0x850ea0` 是全零，
 *   于是那一行全是 0 —— 不可通行。
 * - **上限封顶到 1.0**：取到的值与 `[0x79a708]`（= `double 1.0`）比较后封顶，超过按 1.0 算。
 *
 * 槽位 4 不给 INI 键、恒为 `1.0`（名字表里与它同位的名字是 `Winged`，`VA 0x7d3a04`）：
 * 飞行类不受地块影响，所以本项目不把它收进表里。
 *
 * 这张表的用法在 `FUN_004a2670`（`VA 0x4a3cb1`）：
 * `速度系数 = min(1.0, 表[地表 × 9 + 移动类型])`；同处还可见桥面把地表强制成 `1`（`Road`）、
 * 地表 `10`（`Tunnel`）被单独判定。
 *
 * `Cliff` 不是引擎的一段：它来自客户端 `getLandType`，本项目的地块类型映射会产出它，
 * 这里按 `[Rock]` 段取（全 0%）。
 */

/** 移动方式：rules.ini 地块段里的键名，次序即引擎表里的槽位次序。 */
export const SPEED_TYPES = ['Foot', 'Track', 'Wheel', 'Hover', 'Float', 'Amphibious', 'FloatBeach'] as const
export type SpeedType = (typeof SPEED_TYPES)[number]

/** 地块类型名：先按引擎枚举次序，末尾 `Cliff` 是客户端多出来的一个名字（按 `[Rock]` 取段）。 */
export const LAND_TYPE_NAMES = [
  'Clear',
  'Road',
  'Water',
  'Rock',
  'Wall',
  'Tiberium',
  'Beach',
  'Rough',
  'Railroad',
  'Weeds',
  'Cliff',
] as const
export type LandTypeName = (typeof LAND_TYPE_NAMES)[number]

export interface LandTypeRules {
  readonly name: LandTypeName
  /** rules.ini 的 `Buildable=yes`：这种地块上能不能盖房子 */
  readonly buildable: boolean
  /** 移动方式 → 速度系数（0 = 不能进入）；每个移动方式都有值，缺键取 1.0 */
  readonly speed: ReadonlyMap<SpeedType, number>
  readonly issues: readonly ParseIssue[]
}

/** 悬崖没有自己的段，按 `[Rock]` 判定（与客户端一致）。 */
export function landRulesSectionName(landType: LandTypeName): LandTypeName {
  return landType === 'Cliff' ? 'Rock' : landType
}

export function readLandRules(rules: RawRules): ReadonlyMap<LandTypeName, LandTypeRules> {
  const parsed = new Map<LandTypeName, LandTypeRules>()
  for (const name of LAND_TYPE_NAMES) parsed.set(name, readLandType(rules, name))
  return parsed
}

/** 速度系数；段不存在返回 0（= 不能进入）。 */
export function speedFactor(
  land: ReadonlyMap<LandTypeName, LandTypeRules>,
  landType: LandTypeName,
  speedType: SpeedType,
): number {
  return land.get(landType)?.speed.get(speedType) ?? 0
}

function readLandType(rules: RawRules, name: LandTypeName): LandTypeRules {
  const section = sectionOf(rules, landRulesSectionName(name))
  const issues: ParseIssue[] = []
  const speed = new Map<SpeedType, number>()
  const buildableValue = section?.values.get('buildable')
  const buildable = parseBoolean(buildableValue) ?? false
  if (buildableValue !== undefined && parseBoolean(buildableValue) === undefined) {
    issues.push({ key: 'Buildable', value: buildableValue, reason: 'not a boolean' })
  }
  if (section === undefined) {
    // 段不存在：引擎整行不写，而表的出厂镜像是全零
    for (const speedType of SPEED_TYPES) speed.set(speedType, 0)
    return { name, buildable, speed, issues }
  }
  for (const speedType of SPEED_TYPES) {
    const value = section.values.get(speedType.toLowerCase())
    if (value === undefined) {
      // 键不在段里：引擎取读键时的默认值 1.0
      speed.set(speedType, 1)
      continue
    }
    const parsed = parsePercent(value)
    if (parsed === undefined) {
      issues.push({ key: speedType, value, reason: 'not a percentage' })
      speed.set(speedType, 0)
      continue
    }
    // 引擎把读到的值封顶到 1.0；原版数据里没有负值，负数按 0 处理
    speed.set(speedType, parsed <= 0 ? 0 : Math.min(parsed, 1))
  }
  return { name, buildable, speed, issues }
}

/** `100%` → 1、`50%` → 0.5；不带百分号的小数按原值。 */
function parsePercent(value: string): number | undefined {
  const text = value.trim()
  const isPercent = text.endsWith('%')
  const parsed = Number(isPercent ? text.slice(0, -1) : text)
  if (!Number.isFinite(parsed)) return undefined
  return isPercent ? parsed / 100 : parsed
}

import { parseBoolean, type ParseIssue } from './parse.js'
import { sectionOf, type RawRules } from './raw-rules.js'

/**
 * 地块类型（LandType）与各移动方式在它上面的通行系数。
 *
 * 段名就是类型名：`[Clear]`、`[Road]`、`[Rock]`、`[Water]`、`[Wall]`、`[Tiberium]`、
 * `[Beach]`、`[Rough]`、`[Railroad]`、`[Weeds]`。段里的键是**移动方式**，值是百分比：
 * `[Water] Track=0%` 就是"履带车不能进水"，`[Clear] Track=100%` 是"正常通行"。
 * 缺键与 `0%` 同样处理 —— 不能进入。
 *
 * 判定依据（客户端 `LandRules.readIni` 与 `getPassableSpeed`）：
 *
 * - `getPassableSpeed` 取 `rules.getLandRules(landType).getSpeedModifier(speedType)`，
 *   **系数为 0（缺键也算 0）就直接返回 0 = 该移动方式不能进入这一格**；
 * - `getLandRules` 对 `LandType.Cliff` 用的是 **`[Rock]` 段**（`e === Cliff ? "Rock" : LandType[e]`），
 *   而 rules.ini 里没有 `[Cliff]` 段 —— 所以悬崖照 `[Rock]` 的 `0%` 处理。
 */

/** 移动方式：rules.ini 地块段里的键名。`Winged`（飞行）不参与地块判定，不收。 */
export const SPEED_TYPES = ['Foot', 'Track', 'Wheel', 'Hover', 'Float', 'FloatBeach', 'Amphibious'] as const
export type SpeedType = (typeof SPEED_TYPES)[number]

/** 地块类型名，与 rules.ini 的段名一一对应。 */
export const LAND_TYPE_NAMES = [
  'Clear',
  'Road',
  'Rock',
  'Beach',
  'Rough',
  'Railroad',
  'Weeds',
  'Water',
  'Wall',
  'Tiberium',
  'Cliff',
] as const
export type LandTypeName = (typeof LAND_TYPE_NAMES)[number]

export interface LandTypeRules {
  readonly name: LandTypeName
  /** rules.ini 的 `Buildable=yes`：这种地块上能不能盖房子 */
  readonly buildable: boolean
  /** 移动方式 → 通行系数（0 = 不能进入；段里没写的键按 0） */
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

/** 通行系数；段里没有这个移动方式、或写了 0 都返回 0。 */
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
  for (const speedType of SPEED_TYPES) {
    const value = section?.values.get(speedType.toLowerCase())
    if (value === undefined) continue
    const parsed = parsePercent(value)
    if (parsed === undefined) {
      issues.push({ key: speedType, value, reason: 'not a percentage' })
      continue
    }
    if (parsed > 0) speed.set(speedType, parsed)
  }
  const buildableValue = section?.values.get('buildable')
  const buildable = parseBoolean(buildableValue) ?? false
  if (buildableValue !== undefined && parseBoolean(buildableValue) === undefined) {
    issues.push({ key: 'Buildable', value: buildableValue, reason: 'not a boolean' })
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

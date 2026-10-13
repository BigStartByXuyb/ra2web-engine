import { parseBoolean, parseInteger, parseList, type ParseIssue } from './parse.js'
import { sectionOf, valueOf, type RawRules } from './raw-rules.js'

/**
 * 单位（TechnoType）强类型视图。
 *
 * 只映射模拟内核当前需要的字段；其余键一律通过 `raw` 保留，需要时再逐步提升为强类型，
 * 避免"猜字段语义"。无法解析的值记录在 `issues` 里，不静默丢弃。
 */

export type MoveZone = 'ground' | 'water' | 'air'

export interface UnitType {
  readonly id: string
  readonly uiName: string | undefined
  readonly displayName: string | undefined
  readonly image: string | undefined
  readonly category: string | undefined
  readonly strength: number | undefined
  readonly armor: string | undefined
  readonly speed: number | undefined
  readonly rot: number | undefined
  readonly sight: number | undefined
  readonly cost: number | undefined
  readonly techLevel: number | undefined
  readonly primary: string | undefined
  readonly secondary: string | undefined
  /** 移动方式（rules.ini `SpeedType=`：Track/Wheel/Foot/Hover/Float/…），坡度乘数选组用 */
  readonly speedType: string | undefined
  readonly turret: boolean
  readonly owners: readonly string[]
  readonly prerequisites: readonly string[]
  /** 原始键值，供核对与未映射字段使用 */
  readonly raw: ReadonlyMap<string, string>
  readonly issues: readonly ParseIssue[]
}

function optional(key: string, value: string | undefined, issues: ParseIssue[]): string | undefined {
  if (value === undefined) return undefined
  if (value === '') {
    issues.push({ key, value, reason: 'empty value' })
    return undefined
  }
  return value
}

function integer(key: string, value: string | undefined, issues: ParseIssue[]): number | undefined {
  if (value === undefined) return undefined
  const parsed = parseInteger(key, value)
  if (parsed === undefined) issues.push({ key, value, reason: 'not an integer' })
  return parsed
}

export function parseUnitType(rules: RawRules, id: string): UnitType | undefined {
  const section = sectionOf(rules, id)
  if (!section) return undefined
  const issues: ParseIssue[] = []
  const lookup = (key: string): string | undefined => valueOf(rules, id, key)

  const turretValue = lookup('turret')
  const turret = parseBoolean(turretValue) ?? false
  if (turretValue !== undefined && parseBoolean(turretValue) === undefined) {
    issues.push({ key: 'Turret', value: turretValue, reason: 'not a boolean' })
  }

  return {
    id,
    uiName: optional('UIName', lookup('uiname'), issues),
    displayName: optional('Name', lookup('name'), issues),
    image: optional('Image', lookup('image'), issues),
    category: optional('Category', lookup('category'), issues),
    strength: integer('Strength', lookup('strength'), issues),
    armor: optional('Armor', lookup('armor'), issues),
    speed: integer('Speed', lookup('speed'), issues),
    rot: integer('ROT', lookup('rot'), issues),
    sight: integer('Sight', lookup('sight'), issues),
    cost: integer('Cost', lookup('cost'), issues),
    techLevel: integer('TechLevel', lookup('techlevel'), issues),
    primary: optional('Primary', lookup('primary'), issues),
    secondary: optional('Secondary', lookup('secondary'), issues),
    speedType: optional('SpeedType', lookup('speedtype'), issues),
    turret,
    owners: parseList(lookup('owner')),
    prerequisites: parseList(lookup('prerequisite')),
    raw: section.values,
    issues,
  }
}

/** 列出规则集里声明的全部单位 ID（VehicleTypes / InfantryTypes / AircraftTypes / BuildingTypes）。 */
export function listUnitIds(rules: RawRules, listName: string): readonly string[] {
  const section = sectionOf(rules, listName)
  if (!section) return []
  const entries: Array<{ index: number; id: string }> = []
  for (const [key, value] of section.values) {
    const index = Number(key)
    if (!Number.isInteger(index)) continue
    const id = value.split(';')[0]!.trim()
    if (id !== '') entries.push({ index, id })
  }
  return entries.sort((a, b) => a.index - b.index).map((entry) => entry.id)
}

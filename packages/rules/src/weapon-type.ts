import { parseFloatValue, parseInteger, type ParseIssue } from './parse.js'
import { sectionOf, valueOf, type RawRules } from './raw-rules.js'

/**
 * 武器（WeaponTypeClass）强类型视图。
 *
 * 证据：WeaponTypeClass::Read_INI = 0x733220（work/decompiled/ra2-engine/fn-733220.md）。
 * 只映射模拟内核当前需要的战斗字段；其余键（Report/Anim/Laser 系等）保留在 `raw`，
 * 需要时再提升。解析口径照原版：
 * - Damage(+0xa4)/ROF(+0xb0)/Burst(+0x9c)：int
 * - Range(+0xb4)/MinimumRange(+0xb8)：float 读入，-1.0 视为"未提供"，否则四舍五入取整（格数）
 * - Speed(+0xa8)：0..100 百分比 → (v<<8)/100 定点且 ≤0xff；-1 视为"未提供"（FUN_00469cd0）
 */

export interface WeaponType {
  readonly id: string
  /** +0xa4 */
  readonly damage: number | undefined
  /** +0xb0，开火间隔（逻辑帧） */
  readonly rof: number | undefined
  /** +0xb4，格数整数 */
  readonly range: number | undefined
  /** +0xb8，格数整数 */
  readonly minimumRange: number | undefined
  /** +0x9c，连发数 */
  readonly burst: number | undefined
  /** +0xa8，原版定点 0..255（255 = Speed 100 封顶） */
  readonly speed: number | undefined
  /** +0xa0，弹体类型名（按名引用） */
  readonly projectile: string | undefined
  /** +0xac，弹头类型名（按名引用） */
  readonly warhead: string | undefined
  /** 原始键值，供核对与未映射字段使用 */
  readonly raw: ReadonlyMap<string, string>
  readonly issues: readonly ParseIssue[]
}

/** 原版 Speed 换算（FUN_00469cd0）：>99 钳 100；≤0 得 0；否则 (v<<8)/100 截断，≤0xff。 */
export function speedPercentToFixed(v: number): number {
  const clamped = Math.min(v, 100)
  if (clamped <= 0) return 0
  return Math.min(Math.trunc((clamped << 8) / 100), 0xff)
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
  if (parsed === undefined) {
    issues.push({ key, value, reason: 'not an integer' })
    return undefined
  }
  return parsed
}

/** 原版口径：float 读入，-1.0 = 未提供，否则四舍五入取整（FUN_0077f110）。 */
function roundedRange(key: string, value: string | undefined, issues: ParseIssue[]): number | undefined {
  if (value === undefined) return undefined
  const parsed = parseFloatValue(key, value)
  if (parsed === undefined) {
    issues.push({ key, value, reason: 'not a number' })
    return undefined
  }
  if (parsed === -1) return undefined
  return Math.round(parsed)
}

export function parseWeaponType(rules: RawRules, id: string): WeaponType | undefined {
  const section = sectionOf(rules, id)
  if (!section) return undefined
  const issues: ParseIssue[] = []
  const lookup = (key: string): string | undefined => valueOf(rules, id, key)

  const rawSpeed = integer('Speed', lookup('speed'), issues)
  const speed = rawSpeed === undefined || rawSpeed === -1 ? undefined : speedPercentToFixed(rawSpeed)

  return {
    id,
    damage: integer('Damage', lookup('damage'), issues),
    rof: integer('ROF', lookup('rof'), issues),
    range: roundedRange('Range', lookup('range'), issues),
    minimumRange: roundedRange('MinimumRange', lookup('minimumrange'), issues),
    burst: integer('Burst', lookup('burst'), issues),
    speed,
    projectile: optional('Projectile', lookup('projectile'), issues),
    warhead: optional('Warhead', lookup('warhead'), issues),
    raw: section.values,
    issues,
  }
}

/** 列出规则集里声明的全部武器 ID（[Weapons] 编号列表）。 */
export function listWeaponIds(rules: RawRules, listName = 'Weapons'): readonly string[] {
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

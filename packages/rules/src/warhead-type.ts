import { parseFloatValue, type ParseIssue } from './parse.js'
import { sectionOf, valueOf, type RawRules } from './raw-rules.js'

/**
 * 弹头（WarheadTypeClass）强类型视图。
 *
 * 证据：WarheadTypeClass::Read_INI = 0x7204e0（work/decompiled/ra2-engine/fn-7204e0.md）。
 * 只映射模拟内核当前需要的字段；其余键保留在 `raw`。解析口径照原版：
 * - Verses（+0xa0..+0xf8）：逗号切分循环 11 次，带 % 项 ×0.01，无 % 项按浮点直存；
 *   键缺省 → 全 1.0（默认串 0x7fb1e0 = "100%%," ×11）。
 * - CellSpread（+0x124）：float。
 */

/** Verses 项数（原版解析循环恰好 11 次）。 */
export const VERSES_COUNT = 11

export interface WarheadType {
  readonly id: string
  /** +0xa0..+0xf8，11 项，按护甲枚举序（packages/rules/src/armor-type.ts），值 0..1（个别可 >1） */
  readonly verses: readonly number[]
  /** +0x124，float */
  readonly cellSpread: number | undefined
  /** 原始键值，供核对与未映射字段使用 */
  readonly raw: ReadonlyMap<string, string>
  readonly issues: readonly ParseIssue[]
}

function parseVerse(token: string): number | undefined {
  const text = token.trim()
  if (text === '') return undefined
  if (text.includes('%')) {
    const value = Number(text.slice(0, text.indexOf('%')))
    return Number.isFinite(value) ? value * 0.01 : undefined
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined
}

export function parseWarheadType(rules: RawRules, id: string): WarheadType | undefined {
  const section = sectionOf(rules, id)
  if (!section) return undefined
  const issues: ParseIssue[] = []
  const verses: number[] = []
  const versesValue = valueOf(rules, id, 'verses')

  if (versesValue !== undefined) {
    const tokens = versesValue.split(',')
    for (let i = 0; i < VERSES_COUNT && i < tokens.length; i++) {
      const parsed = parseVerse(tokens[i]!)
      if (parsed === undefined) {
        issues.push({ key: 'Verses', value: tokens[i]!, reason: 'not a number' })
        verses.push(1.0)
      } else {
        verses.push(parsed)
      }
    }
    if (tokens.length < VERSES_COUNT) {
      // 原版对短列表没有定义行为（解析循环仍跑满 11 次）；补 1.0 是本项目自定
      issues.push({ key: 'Verses', value: versesValue, reason: 'fewer than 11 entries' })
      while (verses.length < VERSES_COUNT) verses.push(1.0)
    }
  } else {
    // 默认串 0x7fb1e0 = "100%%," ×11
    for (let i = 0; i < VERSES_COUNT; i++) verses.push(1.0)
  }

  const cellSpreadValue = valueOf(rules, id, 'cellspread')
  const cellSpread = parseFloatValue('CellSpread', cellSpreadValue)
  if (cellSpreadValue !== undefined && cellSpread === undefined) {
    issues.push({ key: 'CellSpread', value: cellSpreadValue, reason: 'not a number' })
  }

  return {
    id,
    verses,
    cellSpread,
    raw: section.values,
    issues,
  }
}

/** 列出规则集里声明的全部弹头 ID（[Warheads] 编号列表，节名串见 FUN_006437f0 引用）。 */
export function listWarheadIds(rules: RawRules, listName = 'Warheads'): readonly string[] {
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

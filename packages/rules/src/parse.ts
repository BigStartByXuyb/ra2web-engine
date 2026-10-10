/** 数值解析：原版 INI 的值在格式错误时按"该键无效"处理，这里如实记录问题而不是猜。 */

export interface ParseIssue {
  readonly key: string
  readonly value: string
  readonly reason: string
}

const TRUE_VALUES = new Set(['yes', 'true', '1'])
const FALSE_VALUES = new Set(['no', 'false', '0'])

export function parseInteger(key: string, value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

export function parseFloatValue(key: string, value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 原版布尔写法：yes/no、true/false、1/0；其它值视为无效。 */
export function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (TRUE_VALUES.has(normalized)) return true
  if (FALSE_VALUES.has(normalized)) return false
  return undefined
}

/** 逗号分隔列表；去掉空项，保留原始大小写。 */
export function parseList(value: string | undefined): readonly string[] {
  if (value === undefined) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

export function parseNumberArray(value: string | undefined): readonly number[] {
  return parseList(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
}

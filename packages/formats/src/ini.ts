/**
 * INI 文本解析。
 *
 * 原版规则：`[Section]` 定节，`Key=Value` 定键；`;` 起注释；键名大小写不敏感，
 * 后出现的同键覆盖先出现的（这是原版 mod 覆盖机制的基础）。
 */

export interface IniSection {
  readonly name: string
  readonly values: ReadonlyMap<string, string>
}

export interface IniDocument {
  /** 节名（已转小写）到节的映射 */
  readonly sections: ReadonlyMap<string, IniSection>
  /** 原始节顺序，用于复现原版的加载次序 */
  readonly order: readonly string[]
}

const SECTION_PATTERN = /^\[([^\]]+)\]\s*(?:;.*)?$/
const KEY_PATTERN = /^\s*([^=;\s][^=]*?)\s*=\s*(.*?)\s*$/

export function parseIni(text: string): IniDocument {
  const sections = new Map<string, Map<string, string>>()
  const order: string[] = []
  let current: Map<string, string> | undefined

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith(';')) continue

    const section = SECTION_PATTERN.exec(line)
    if (section) {
      const name = section[1]!.trim().toLowerCase()
      if (!sections.has(name)) {
        sections.set(name, new Map())
        order.push(name)
      }
      current = sections.get(name)!
      continue
    }

    if (!current) continue
    const key = KEY_PATTERN.exec(rawLine)
    if (!key) continue
    const value = key[2]!.replace(/\s*;.*$/, '').trim()
    current.set(key[1]!.trim().toLowerCase(), value)
  }

  const result = new Map<string, IniSection>()
  for (const [name, values] of sections) result.set(name, { name, values })
  return { sections: result, order }
}

/** 取键值；不存在返回 undefined。键名大小写不敏感。 */
export function iniValue(document: IniDocument, section: string, key: string): string | undefined {
  return document.sections.get(section.toLowerCase())?.values.get(key.toLowerCase())
}

import { parseIni, type IniDocument, type IniSection } from '@ra2web/formats'

/**
 * 规则集的"无损"层：把若干 INI 文件按原版加载顺序合并，保留原文与来源，
 * 不做任何类型转换，也不丢弃未知键。
 */

export interface RulesFile {
  /** 文件名，仅用于溯源与诊断 */
  readonly name: string
  readonly text: string
}

export interface RawRules {
  readonly document: IniDocument
  /** 参与合并的文件名，按加载顺序 */
  readonly loadedFiles: readonly string[]
}

/**
 * 按顺序合并 INI 文件。
 *
 * 覆盖语义与原版一致：**逐键覆盖**。后加载文件里出现的键替换先前的同名键，
 * 没出现的键保持原值；节名大小写不敏感。
 */
export function loadRules(files: readonly RulesFile[]): RawRules {
  const values = new Map<string, Map<string, string>>()
  const order: string[] = []
  const loadedFiles: string[] = []

  for (const file of files) {
    loadedFiles.push(file.name)
    const document = parseIni(file.text)
    for (const name of document.order) {
      const section = document.sections.get(name)
      if (!section) continue
      let target = values.get(name)
      if (!target) {
        target = new Map<string, string>()
        values.set(name, target)
        order.push(name)
      }
      for (const [key, value] of section.values) target.set(key, value)
    }
  }

  const sections = new Map<string, IniSection>()
  for (const [name, keys] of values) sections.set(name, { name, values: keys })
  return { document: { sections, order }, loadedFiles }
}

export function sectionOf(rules: RawRules, name: string): IniSection | undefined {
  return rules.document.sections.get(name.toLowerCase())
}

/** 取键值；键名大小写不敏感。 */
export function valueOf(rules: RawRules, section: string, key: string): string | undefined {
  return sectionOf(rules, section)?.values.get(key.toLowerCase())
}

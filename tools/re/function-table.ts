/**
 * 函数表（Ghidra 导出）的公共解析与证据分类。
 *
 * 供 `classify-functions.ts`（直接分类）与 `propagate-subsystems.ts`（调用图传播）共用，
 * 保证"判据只有一处"。
 */

export interface SubsystemRule {
  readonly id: string
  readonly title: string
  readonly pattern: RegExp
}

/** 关键词只认引擎自身的证据：字符串常量与外部导入名。 */
export const SUBSYSTEMS: readonly SubsystemRule[] = [
  { id: 'ini', title: 'INI / 规则', pattern: /\.ini\b|rules|art\.ini|ai\.ini|langrule/i },
  { id: 'mix', title: 'MIX 档案', pattern: /\.mix\b|\.mmx\b/i },
  { id: 'art', title: '美术素材', pattern: /\.shp\b|\.vxl\b|\.hva\b|\.tmp\b|\.pal\b|\.pcx\b/i },
  { id: 'render', title: '渲染 / 显示', pattern: /ddraw|directdraw|blit|surface|palette|d3d|gdi32|opengl/i },
  { id: 'audio', title: '音频', pattern: /\.wav\b|\.aud\b|directsound|dsound|winmm/i },
  { id: 'net', title: '联机 / 网络', pattern: /winsock|ws2_32|wsock32|ipx|socket|recv|send|connect|network/i },
  { id: 'save', title: '存档 / 回放', pattern: /save|replay|\.sav\b/i },
  { id: 'ui', title: '界面', pattern: /dialog|menu|wndproc|messagebox|createwindow/i },
  { id: 'map', title: '地图', pattern: /\.map\b|\.mpr\b|isometric|theater/i },
  { id: 'csf', title: '字符串表', pattern: /\.csf\b/i },
]

export interface FunctionRecord {
  readonly address: string
  readonly name: string
  readonly bytes: number
  readonly strings: readonly string[]
  readonly externals: readonly string[]
  readonly callees: readonly string[]
}

/** TSV 记录以"行首是地址"为界；字符串里可能带换行，需要拼接。 */
export function parseFunctionTable(text: string): FunctionRecord[] {
  const records: FunctionRecord[] = []
  let buffer = ''

  const flush = (line: string): void => {
    if (line === '') return
    const [address, name, bytes, strings, externals, callees] = line.split('\t')
    if (!address || !name || address === 'address') return
    records.push({
      address,
      name,
      bytes: Number(bytes ?? 0),
      strings: splitList(strings),
      externals: splitList(externals),
      callees: splitList(callees),
    })
  }

  for (const line of text.split(/\r?\n/)) {
    if (/^[0-9a-f]{6,8}\t/.test(line)) {
      flush(buffer)
      buffer = line
    } else {
      buffer += ' ' + line
    }
  }
  flush(buffer)
  return records
}

function splitList(value: string | undefined): readonly string[] {
  return (value ?? '').split('|').filter((item) => item !== '')
}

/** 依据字符串与外部导入名给出直接分类。 */
export function classifyByEvidence(record: FunctionRecord): readonly string[] {
  const haystack = [...record.strings, ...record.externals].join('\n')
  return SUBSYSTEMS.filter((rule) => rule.pattern.test(haystack)).map((rule) => rule.id)
}

export function subsystemTitle(id: string): string {
  return SUBSYSTEMS.find((rule) => rule.id === id)?.title ?? id
}

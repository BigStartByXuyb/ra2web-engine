import fs from 'node:fs'
import path from 'node:path'

/**
 * 把 Ghidra 导出的函数表按子系统归类。
 *
 * 输入：`DumpFunctions.java` 产出的 TSV（address / name / bytes / strings / externals）
 * 输出：子系统统计 + 每个子系统的函数清单（Markdown，落到 docs/engine/）
 *
 * 用法：tsx tools/re/classify-functions.ts <functions-detail.tsv> <out.md>
 */

export interface SubsystemRule {
  readonly id: string
  readonly title: string
  readonly pattern: RegExp
}

/** 关键词只认"引擎自己的证据"：字符串常量与外部导入名。 */
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
}

/** TSV 里字符串可能带换行，按"行首是地址"来切记录。 */
export function parseFunctionTable(text: string): FunctionRecord[] {
  const records: FunctionRecord[] = []
  let buffer = ''
  const flush = (line: string) => {
    if (line === '') return
    const [address, name, bytes, strings, externals] = line.split('\t')
    if (!address || !name || address === 'address') return
    records.push({
      address,
      name,
      bytes: Number(bytes ?? 0),
      strings: (strings ?? '').split('|').filter((value) => value !== ''),
      externals: (externals ?? '').split('|').filter((value) => value !== ''),
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

export function classify(record: FunctionRecord): readonly string[] {
  const haystack = [...record.strings, ...record.externals].join('\n')
  return SUBSYSTEMS.filter((rule) => rule.pattern.test(haystack)).map((rule) => rule.id)
}

function main(): void {
  const [tsvPath, outPath] = process.argv.slice(2)
  if (!tsvPath || !outPath) {
    console.error('usage: classify-functions.ts <functions-detail.tsv> <out.md>')
    process.exit(1)
  }

  const records = parseFunctionTable(fs.readFileSync(tsvPath, 'utf8'))
  const buckets = new Map<string, FunctionRecord[]>()
  for (const rule of SUBSYSTEMS) buckets.set(rule.id, [])
  let unclassified = 0

  for (const record of records) {
    const ids = classify(record)
    if (ids.length === 0) {
      unclassified++
      continue
    }
    for (const id of ids) buckets.get(id)!.push(record)
  }

  const lines: string[] = []
  lines.push('# 函数分类（按子系统）')
  lines.push('')
  lines.push(
    `来源：\`work/decompiled/ra2-engine/functions-detail.tsv\`（Ghidra 12.1.4 导出，共 ${records.length} 个函数）。`,
  )
  lines.push('分类依据：函数内部引用到的字符串常量与外部导入符号，不做语义猜测。')
  lines.push('')
  lines.push('## 统计')
  lines.push('')
  lines.push('| 子系统 | 函数数 |')
  lines.push('| --- | --- |')
  for (const rule of SUBSYSTEMS) {
    lines.push(`| ${rule.title} | ${buckets.get(rule.id)!.length} |`)
  }
  lines.push(`| 未命中任何关键词 | ${unclassified} |`)
  lines.push('')

  for (const rule of SUBSYSTEMS) {
    const bucket = buckets
      .get(rule.id)!
      .slice()
      .sort((a, b) => b.bytes - a.bytes)
    lines.push(`## ${rule.title}（${bucket.length}）`)
    lines.push('')
    lines.push('| 地址 | 名字 | 字节 | 命中字符串（节选） |')
    lines.push('| --- | --- | --- | --- |')
    for (const record of bucket.slice(0, 40)) {
      const matched = [...record.strings, ...record.externals]
        .filter((value) => rule.pattern.test(value))
        .slice(0, 2)
        .map((value) => value.replace(/\|/g, '/').slice(0, 40))
        .join(' ; ')
      lines.push(`| \`${record.address}\` | \`${record.name}\` | ${record.bytes} | ${matched} |`)
    }
    if (bucket.length > 40) lines.push(`| … | 其余 ${bucket.length - 40} 个略 | | |`)
    lines.push('')
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, lines.join('\n'))
  console.log(`函数总数 ${records.length}，未分类 ${unclassified}`)
  for (const rule of SUBSYSTEMS) console.log(`  ${rule.title}: ${buckets.get(rule.id)!.length}`)
  console.log(`写出 ${outPath}`)
}

main()

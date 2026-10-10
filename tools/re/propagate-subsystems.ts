import fs from 'node:fs'
import path from 'node:path'
import {
  classifyByEvidence,
  parseFunctionTable,
  subsystemTitle,
  SUBSYSTEMS,
  type FunctionRecord,
} from './function-table.js'

/**
 * 子系统分类：直接证据（字符串/导入名）+ 调用图传播。
 *
 * 传播规则：不引用任何字符串的函数，若其被调用者都属于同一子系统，就归入该子系统。
 * 层级 0 = 直接证据，n = 传播第 n 层。
 *
 * 两个防泛化约束（否则错误弹窗这类公共工具会把标签撒满全程序）：
 *   1. 枢纽过滤：被调用次数超过 hubInDegree 的函数视为公共基础设施，不参与传播；
 *   2. 占比过滤：某子系统经传播后覆盖超过 maxShare 比例时，判定该标签不具区分度，
 *      丢弃其传播结果（直接证据保留），并在文档里列出被丢弃的类别。
 *
 * 用法：tsx tools/re/propagate-subsystems.ts <functions-detail.tsv> <out.md> [maxDepth=8]
 */

interface Assignment {
  readonly labels: Set<string>
  level: number
  propagated: boolean
}

const [tsvPath, outPath, maxDepthArg] = process.argv.slice(2)
if (!tsvPath || !outPath) {
  console.error('usage: propagate-subsystems.ts <functions-detail.tsv> <out.md> [maxDepth=8]')
  process.exit(1)
}
const maxDepth = Number(maxDepthArg ?? 8)
const HUB_IN_DEGREE = 25
const MAX_SHARE = 0.15

const records = parseFunctionTable(fs.readFileSync(tsvPath, 'utf8'))
const byAddress = new Map<string, FunctionRecord>(records.map((record) => [record.address.toLowerCase(), record]))
const inDegree = new Map<string, number>()
for (const record of records) {
  for (const callee of record.callees) {
    const key = callee.toLowerCase()
    inDegree.set(key, (inDegree.get(key) ?? 0) + 1)
  }
}
const isHub = (address: string): boolean => (inDegree.get(address.toLowerCase()) ?? 0) > HUB_IN_DEGREE
const assignments = new Map<string, Assignment>()

for (const record of records) {
  const labels = classifyByEvidence(record)
  if (labels.length > 0) {
    assignments.set(record.address.toLowerCase(), { labels: new Set(labels), level: 0, propagated: false })
  }
}
const seedCount = assignments.size

/** 跑一轮传播：只给没有标签的函数补标签，来源是其非枢纽被调用者。 */
function runPropagation(banned: ReadonlySet<string>): number {
  let added = 0
  for (let depth = 0; depth < maxDepth; depth++) {
    const additions: Array<[string, Set<string>]> = []
    for (const record of records) {
      const key = record.address.toLowerCase()
      if (assignments.has(key)) continue
      const inherited = new Set<string>()
      for (const callee of record.callees) {
        if (isHub(callee)) continue
        const found = assignments.get(callee.toLowerCase())
        if (!found) continue
        for (const label of found.labels) {
          if (banned.has(label)) continue
          inherited.add(label)
        }
      }
      if (inherited.size > 0) additions.push([key, inherited])
    }
    if (additions.length === 0) break
    for (const [key, labels] of additions) {
      assignments.set(key, { labels, level: depth + 1, propagated: true })
      added++
    }
  }
  return added
}

/**
 * 迭代：先传播，再把"覆盖比例过高"的标签判为不具区分度并禁用它，重新传播。
 * 最多 3 轮，保证结果稳定。
 */
const banned = new Set<string>()
let propagatedTotal = 0
for (let round = 0; round < 3; round++) {
  propagatedTotal = runPropagation(banned)
  const counts = new Map<string, number>()
  for (const record of records) {
    const assignment = assignments.get(record.address.toLowerCase())
    if (!assignment?.propagated) continue
    for (const label of assignment.labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  let bannedThisRound = 0
  for (const [label, count] of counts) {
    if (count > records.length * MAX_SHARE && !banned.has(label)) {
      banned.add(label)
      bannedThisRound++
    }
  }
  if (bannedThisRound === 0) break
  // 清掉本轮产生、且带被禁标签的传播结果，下一轮重算
  for (const [key, assignment] of assignments) {
    if (!assignment.propagated) continue
    if ([...assignment.labels].some((label) => banned.has(label))) assignments.delete(key)
  }
}

const directBySubsystem = new Map<string, number>(SUBSYSTEMS.map((rule) => [rule.id, 0]))
const propagatedBySubsystem = new Map<string, number>(SUBSYSTEMS.map((rule) => [rule.id, 0]))
const members = new Map<string, FunctionRecord[]>(SUBSYSTEMS.map((rule) => [rule.id, []]))

for (const record of records) {
  const assignment = assignments.get(record.address.toLowerCase())
  if (!assignment) continue
  for (const label of assignment.labels) {
    if (assignment.propagated) propagatedBySubsystem.set(label, (propagatedBySubsystem.get(label) ?? 0) + 1)
    else directBySubsystem.set(label, (directBySubsystem.get(label) ?? 0) + 1)
    members.get(label)!.push(record)
  }
}

const unclassified = records.length - assignments.size
const lines: string[] = []
lines.push('# 函数分类（直接证据 + 调用图传播）')
lines.push('')
lines.push(`来源：\`functions-detail.tsv\`（Ghidra 12.1.4 导出，共 ${records.length} 个函数）。`)
lines.push('')
lines.push('方法：层级 0 = 函数自身引用到子系统特征字符串或外部导入；层级 n = 由"被调用者属于调用者子系统"')
lines.push(`逐层传播得到，最多 ${maxDepth} 层。传播结果必须人工复核后才能写进实现。`)
lines.push('')
lines.push(`防泛化：被调用次数超过 ${HUB_IN_DEGREE} 的函数视为公共基础设施，不参与传播；`)
lines.push(`传播后覆盖超过 ${(MAX_SHARE * 100).toFixed(0)}% 函数的标签判为无区分度，禁用其传播结果。`)
if (banned.size > 0) {
  lines.push('')
  lines.push(`被判定为无区分度（仅保留直接证据）的标签：${[...banned].map(subsystemTitle).join('、')}`)
}
lines.push('')
lines.push('## 统计')
lines.push('')
lines.push('| 子系统 | 直接证据(层级0) | 传播补全 | 合计 |')
lines.push('| --- | --- | --- | --- |')
for (const rule of SUBSYSTEMS) {
  const direct = directBySubsystem.get(rule.id) ?? 0
  const propagated = propagatedBySubsystem.get(rule.id) ?? 0
  lines.push(`| ${rule.title} | ${direct} | ${propagated} | ${direct + propagated} |`)
}
lines.push(`| 仍未归类 | ${unclassified} | - | ${unclassified} |`)
lines.push('')

for (const rule of SUBSYSTEMS) {
  const bucket = members
    .get(rule.id)!
    .slice()
    .sort((a, b) => b.bytes - a.bytes)
  if (bucket.length === 0) continue
  lines.push(`## ${rule.title}（${bucket.length}）`)
  lines.push('')
  lines.push('| 地址 | 名字 | 字节 | 层级 | 依据 |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const record of bucket.slice(0, 30)) {
    const assignment = assignments.get(record.address.toLowerCase())!
    const evidence = assignment.propagated
      ? `由被调用者传播（层级 ${assignment.level}）`
      : [...record.strings, ...record.externals]
          .filter((value) => rule.pattern.test(value))
          .slice(0, 2)
          .map((value) => value.replace(/\|/g, '/').slice(0, 36))
          .join(' ; ')
    lines.push(`| \`${record.address}\` | \`${record.name}\` | ${record.bytes} | ${assignment.level} | ${evidence} |`)
  }
  if (bucket.length > 30) lines.push(`| … | 其余 ${bucket.length - 30} 个略 | | | |`)
  lines.push('')
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, lines.join('\n'))

console.log(
  `函数总数 ${records.length}，直接证据 ${seedCount}，传播补全 ${assignments.size - seedCount}，未归类 ${unclassified}`,
)
for (const rule of SUBSYSTEMS) {
  const direct = directBySubsystem.get(rule.id) ?? 0
  const propagated = propagatedBySubsystem.get(rule.id) ?? 0
  console.log(`  ${rule.title}: 直接 ${direct} + 传播 ${propagated} = ${direct + propagated}`)
}
console.log(`写出 ${outPath}`)

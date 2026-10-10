import fs from 'node:fs'
import { loadRules, parseUnitType, valueOf } from '../packages/rules/src/index.js'

/**
 * 打印某个单位的全部数值：原文（无损）+ 强类型视图 + 解析问题。
 *
 * 用法：tsx tools/rules-dump.ts <unit id> <rules.ini> [overlay.ini ...]
 */
const [unitId, ...paths] = process.argv.slice(2)
if (!unitId || paths.length === 0) {
  console.error('usage: rules-dump.ts <unit id> <rules.ini> [overlay.ini ...]')
  process.exit(1)
}

const rules = loadRules(paths.map((filePath) => ({ name: filePath, text: fs.readFileSync(filePath, 'latin1') })))
const unit = parseUnitType(rules, unitId)

if (!unit) {
  console.error(`规则集里找不到 [${unitId}]（已加载 ${rules.loadedFiles.join(', ')}）`)
  process.exit(2)
}

console.log(`# ${unit.id}`)
console.log(`文件：${rules.loadedFiles.join(' → ')}`)
console.log('')
console.log('## 强类型视图')
console.log(`  名称        ${unit.displayName ?? '-'}`)
console.log(`  UIName      ${unit.uiName ?? '-'}`)
console.log(`  图像        ${unit.image ?? '-'}`)
console.log(`  分类        ${unit.category ?? '-'}`)
console.log(`  血量        ${unit.strength ?? '-'}`)
console.log(`  护甲        ${unit.armor ?? '-'}`)
console.log(`  速度        ${unit.speed ?? '-'}`)
console.log(`  转向 ROT    ${unit.rot ?? '-'}`)
console.log(`  视野        ${unit.sight ?? '-'}`)
console.log(`  造价        ${unit.cost ?? '-'}`)
console.log(`  科技等级    ${unit.techLevel ?? '-'}`)
console.log(`  主武器      ${unit.primary ?? '-'}`)
console.log(`  副武器      ${unit.secondary ?? '-'}`)
console.log(`  炮塔        ${unit.turret}`)
console.log(`  归属        ${unit.owners.join(', ') || '-'}`)
console.log(`  前置        ${unit.prerequisites.join(', ') || '-'}`)
console.log('')
console.log('## 原文键值（无损）')
for (const [key, value] of unit.raw) console.log(`  ${key} = ${value}`)
if (unit.issues.length > 0) {
  console.log('')
  console.log('## 解析问题')
  for (const issue of unit.issues) console.log(`  ${issue.key} = ${issue.value} → ${issue.reason}`)
}
console.log('')
console.log(`（核对用：Turret=${valueOf(rules, unitId, 'turret') ?? '-'}，键数 ${unit.raw.size}）`)

import fs from 'node:fs'
import path from 'node:path'
import { crc32, findMixEntry, readMixEntry, readMixIndex } from '@ra2web/formats'
import { loadRules, parseUnitType, type UnitType } from '@ra2web/rules'
import { hashWorld, run } from '@ra2web/sim'
import { buildDataDrivenScene, movementPerSecond } from '@ra2web/scenarios'

/**
 * 用**玩家自备的原版游戏文件**构建场景：RA2.MIX → local.mix → rules.ini → 单位数值。
 *
 * 这是"数值来自原版数据"这条链的端到端证明：全程只读本地文件，不依赖任何内置副本。
 *
 * 用法：tsx tools/vanilla-scene.ts <RA2.MIX 路径> [兵种ID=HTNK] [tick=200]
 */
const [mixPath, unitId = 'HTNK', ticksArg = '200'] = process.argv.slice(2)
if (!mixPath) {
  console.error('usage: vanilla-scene.ts <RA2.MIX path> [unitId=HTNK] [ticks=200]')
  process.exit(1)
}
const ticks = Number(ticksArg)

const archive = new Uint8Array(fs.readFileSync(mixPath))
const rootIndex = readMixIndex(archive)
const localEntry = findMixEntry(rootIndex, 'local.mix', crc32)
if (!localEntry) throw new Error('RA2.MIX 里找不到 local.mix')

const local = readMixEntry(archive, rootIndex, localEntry)
const localIndex = readMixIndex(local)
const rulesEntry = findMixEntry(localIndex, 'rules.ini', crc32)
if (!rulesEntry) throw new Error('local.mix 里找不到 rules.ini')

// local.mix 的条目偏移是相对 local.mix 的；地址要换算回父档案
const absolute = {
  hash: rulesEntry.hash,
  offset: localEntry.offset + localIndex.dataStart + rulesEntry.offset,
  length: rulesEntry.length,
}
const rulesText = Buffer.from(readMixEntry(archive, rootIndex, absolute)).toString('latin1')

const rules = loadRules([{ name: `${path.basename(mixPath)}/local.mix/rules.ini`, text: rulesText }])
const unit = parseUnitType(rules, unitId)
if (!unit) throw new Error(`rules.ini 里找不到 [${unitId}]`)

const unitTypes: readonly UnitType[] = [unit, { ...unit, id: `${unit.id}_B` }]
const scene = buildDataDrivenScene(
  unitTypes,
  [
    { unitId: unit.id, owner: 0, cell: { x: 2, y: 2 } },
    { unitId: `${unit.id}_B`, owner: 1, cell: { x: 17, y: 17 } },
  ],
  { width: 20, height: 20, seed: 20261010 },
)

console.log(`数据来源：${rules.loadedFiles.join(', ')}`)
console.log(`兵种 ${unit.id}：${unit.displayName ?? '-'}`)
console.log(`  血量 ${unit.strength}  护甲 ${unit.armor}  速度 ${unit.speed}（原版值）`)
console.log(`  换算每 tick 位移 ${scene.world.units[0]!.speed}，约 ${movementPerSecond(unit).toFixed(2)} 格/秒`)
console.log(`  造价 ${unit.cost}  视野 ${unit.sight}  主武器 ${unit.primary}  炮塔 ${unit.turret}`)
console.log(`  解析问题 ${unit.issues.length} 条`)

run(scene.world, ticks)
console.log(`跑满 ${ticks} tick → 末态哈希 ${hashWorld(scene.world)}`)

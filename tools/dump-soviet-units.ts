import fs from 'node:fs'
import path from 'node:path'
import { readLocalText } from '../packages/assets/src/local-ini.js'
import { readAsset } from '../packages/assets/src/overrides.js'

/**
 * 列出苏军系地面载具清单（量产出模顺序的依据）：
 * 从 RA2.MIX 解 rules.ini → [VehicleTypes] 段逐单位查 Owner= 含 Russians，
 * 输出 代码 / Image / Category / voxel 是否在包内（RA2.MIX 里 <image>.vxl 实查）。
 *
 * 用法：tsx tools/dump-soviet-units.ts <RA2.MIX> [voxelGlbDir]
 *   voxelGlbDir 给了就同时标注 units3d 里 <image>-voxel.glb 是否已转。
 */

const ra2Bytes = new Uint8Array(fs.readFileSync(process.argv[2] ?? 'D:/AI_GAME/work/assets/pack/RA2.MIX'))
const rules = readLocalText(ra2Bytes, 'rules.ini')
if (!rules) throw new Error('RA2.MIX 里没有 rules.ini')

const voxelGlbDir = process.argv[3]
const converted = new Set(
  voxelGlbDir && fs.existsSync(voxelGlbDir)
    ? fs
        .readdirSync(voxelGlbDir)
        .filter((name) => name.endsWith('-voxel.glb'))
        .map((name) => name.replace(/-voxel\.glb$/i, '').toLowerCase())
    : [],
)

const sectionOf = (text: string, name: string): Record<string, string> => {
  const match = text.match(new RegExp(`^\\[${name}\\]([^\\[]*)`, 'im'))
  const section: Record<string, string> = {}
  if (!match) return section
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = line.match(/^\s*([^=;]+)\s*=\s*(.*)$/)
    if (pair) section[pair[1]!.trim().toLowerCase()] = pair[2]!.trim()
  }
  return section
}

const vehicleList = Object.values(sectionOf(rules, 'vehicletypes'))
  .join(',')
  .split(',')
  .map((code) => code.trim())
  .filter(Boolean)

const rows: { code: string; image: string; category: string; inPack: boolean; converted: boolean }[] = []
for (const code of vehicleList) {
  const section = sectionOf(rules, code)
  const owner = (section['owner'] ?? '').toLowerCase()
  if (!owner.includes('russians')) continue
  const image = (section['image'] || code).toUpperCase()
  const vxl = readAsset(ra2Bytes, undefined, `${image.toLowerCase()}.vxl`, 'local.mix')
  rows.push({
    code,
    image,
    category: section['category'] ?? '-',
    inPack: vxl !== undefined,
    converted: converted.has(image.toLowerCase()),
  })
}

console.log(`苏军地面载具 ${rows.length} 个（[Vehicles] 共 ${vehicleList.length}）：`)
console.log('代码       Image      Category            voxel在包  已转GLB')
for (const row of rows) {
  console.log(
    `${row.code.padEnd(10)}${row.image.padEnd(11)}${row.category.padEnd(20)}${row.inPack ? '是' : '否'}          ${row.converted ? '是' : '-'}`,
  )
}
console.log(`\npath: ${path.basename(process.argv[2] ?? 'RA2.MIX')}`)

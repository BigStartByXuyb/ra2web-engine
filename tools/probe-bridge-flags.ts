/* 桥标志数据侧探针：MULTI.MIX 第 7 张（有木桥 LOBRDG26=overlay 102）——
 * 桥格的 11 字节地形记录末字节 vs 邻格，看桥标志位是否来自地图数据。 */
import { readFileSync } from 'node:fs'
import { decodeBase64, parseIni, readMixEntry, readMixIndex, readPackedBlocks, readMap } from '@ra2web/formats'

const PACK = 'D:/AI_GAME/work/assets/pack'
const bytes = new Uint8Array(readFileSync(`${PACK}/MULTI.MIX`))
const index = readMixIndex(bytes)
const entry = index.entries[7]!
const mapBytes = readMixEntry(bytes, index, entry)

// 1) 常规解析：拿 overlay 网格（找桥格）与 z
const map = readMap(mapBytes)
const bridgeCells = map.cells.filter((cell) => cell.overlay?.id === 102)
console.log(`总格数 ${map.cells.length}，overlay=102 的格 ${bridgeCells.length}`)
console.log(
  '桥格样例:',
  bridgeCells.slice(0, 6).map((cell) => `(${cell.cellX},${cell.cellY}) z=${cell.z} data=${cell.overlay?.data}`),
)

// 2) 原始记录：末字节（第 11 字节）逐格看
const document = parseIni(Buffer.from(mapBytes).toString('latin1'))
const section = document.sections.get('isomappack5')
const ordered = [...(section?.values.entries() ?? [])]
  .filter(([key, value]) => Number.isInteger(Number(key)) && value !== '')
  .sort((left, right) => Number(left[0]) - Number(right[0]))
  .map(([, value]) => value)
const raw = readPackedBlocks(decodeBase64(ordered.join('')), 'lzo1x')

const byCell = new Map<string, { z: number; flag: number }>()
for (let at = 0; at + 11 <= raw.byteLength; at += 11) {
  const x = raw[at]! | (raw[at + 1]! << 8)
  const y = raw[at + 2]! | (raw[at + 3]! << 8)
  if (x === 0xffff && y === 0xffff) break
  byCell.set(`${x - 1},${y - 1}`, { z: raw[at + 9]!, flag: raw[at + 10]! })
}
const hist = new Map<number, number>()
for (const { flag } of byCell.values()) hist.set(flag, (hist.get(flag) ?? 0) + 1)
console.log('末字节分布:', [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10))

console.log('桥格 (cellX,cellY) z/末字节 vs 四邻:')
for (const cell of bridgeCells.slice(0, 8)) {
  const self = byCell.get(`${cell.cellX},${cell.cellY}`)
  const up = byCell.get(`${cell.cellX},${cell.cellY - 1}`)
  const down = byCell.get(`${cell.cellX},${cell.cellY + 1}`)
  console.log(
    `(${cell.cellX},${cell.cellY}) 自 z=${self?.z} b=0x${(self?.flag ?? 0).toString(16)}` +
      ` | 上 z=${up?.z} b=0x${(up?.flag ?? 0).toString(16)}` +
      ` | 下 z=${down?.z} b=0x${(down?.flag ?? 0).toString(16)}`,
  )
}

import fs from 'node:fs'
import { crc32, findMixEntry, readMixEntry, readMixIndex } from '@ra2web/formats'

/**
 * 从 MIX 里按名字取出一个条目落到磁盘 —— 素材包/材质包的成包自检用。
 *
 * 用法：tsx tools/mix-extract-entry.ts <pack.mix> <entryName> <outFile>
 */
const [mixPath, entryName, outPath] = process.argv.slice(2)
if (!mixPath || !entryName || !outPath) {
  console.error('usage: tsx tools/mix-extract-entry.ts <pack.mix> <entryName> <outFile>')
  process.exit(1)
}
const bytes = new Uint8Array(fs.readFileSync(mixPath))
const index = readMixIndex(bytes)
const entry = findMixEntry(index, entryName, crc32)
if (!entry) {
  console.error(`${mixPath} 里没有 ${entryName}`)
  process.exit(1)
}
const data = readMixEntry(bytes, index, entry)
fs.writeFileSync(outPath, data)
console.log(`${entryName} → ${outPath}（${data.length} 字节）`)

import fs from 'node:fs'
import { readLocalText } from '../packages/assets/src/local-ini.js'

const bytes = new Uint8Array(fs.readFileSync('D:/AI_GAME/work/assets/pack/RA2.MIX'))
const text = readLocalText(bytes, 'rules.ini')
if (!text) throw new Error('rules.ini not found')
let inGeneral = false
for (const line of text.split(/\r?\n/)) {
  const trimmed = line.trim()
  if (trimmed.startsWith('[')) {
    inGeneral = /^\[General\]/i.test(trimmed)
    continue
  }
  if (!inGeneral || trimmed === '' || trimmed.startsWith(';')) continue
  // 候选：与坡度/爬升/损伤相关的一切
  if (/hill|slope|grade|climb|cripple|condition|speed/i.test(trimmed)) console.log(trimmed)
}

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { crc32 } from '../src/crc32.js'
import { findMixEntry, readMixEntry, readMixIndex } from '../src/mix.js'

/**
 * 加密索引（RA2/TS 型）的端到端核对：只有本机提供原版档案时才运行。
 * 设定 `RA2_MIX=<RA2.MIX 路径>` 启用；仓库不存放受版权保护的原始档案。
 */
const mixPath = process.env.RA2_MIX

test('原版 RA2.MIX 的加密索引能被正确解密', { skip: !mixPath ? '未设置 RA2_MIX' : false }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const index = readMixIndex(archive)
  assert.equal(index.encrypted, true, 'RA2.MIX 应当使用加密索引')
  assert.ok(index.entries.length > 10, `条目数异常：${index.entries.length}`)

  const localEntry = findMixEntry(index, 'local.mix', crc32)
  assert.ok(localEntry, '索引里应当有 local.mix')

  const local = readMixEntry(archive, index, localEntry!)
  const localIndex = readMixIndex(local)
  assert.ok(localIndex.entries.length > 100, `local.mix 条目数异常：${localIndex.entries.length}`)

  const rulesEntry = findMixEntry(localIndex, 'rules.ini', crc32)
  assert.ok(rulesEntry, 'local.mix 里应当有 rules.ini')
  assert.ok(rulesEntry!.length > 100_000, `rules.ini 长度异常：${rulesEntry!.length}`)
})

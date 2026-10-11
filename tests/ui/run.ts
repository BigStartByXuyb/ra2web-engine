import { cases } from './cases.js'
import { missingVanillaAssets, openUiSession } from './harness.js'
import { DEFAULT_PACK_DIR } from '../../tools/serve-game.js'

/**
 * 战场页 UI 测试：`npm run test:ui [-- --only=关键字]`
 *
 * 需要玩家自备的原版档案（默认 `D:\AI_GAME\work\assets\pack`，可用 `RA2_PACK_DIR` 覆盖）；
 * 缺档时整批跳过并以 0 退出 —— 与 `vanilla:*` 那批单元测试同一口径。
 */
const packDir = process.env.RA2_PACK_DIR ?? DEFAULT_PACK_DIR
const missing = missingVanillaAssets(packDir)
if (missing !== undefined) {
  console.log(`跳过 UI 测试：缺少原版档案 ${missing}`)
  process.exit(0)
}

const only = process.argv.find((argument) => argument.startsWith('--only='))?.slice('--only='.length)
const selected = only === undefined ? cases : cases.filter((item) => item.name.includes(only))
if (selected.length === 0) {
  console.error(`没有匹配 --only=${only} 的用例`)
  process.exit(1)
}

const session = await openUiSession({ packDir })
let failed = 0
for (const testCase of selected) {
  const started = Date.now()
  try {
    const note = await testCase.run(session)
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`✔ ${testCase.name}${note === undefined ? '' : ` —— ${note}`}（${seconds}s）`)
  } catch (error) {
    failed++
    console.log(`✘ ${testCase.name}`)
    console.log(`  ${error instanceof Error ? error.message : String(error)}`)
  }
}
await session.close()
console.log(`\nUI 用例 ${selected.length - failed}/${selected.length} 通过（截图在 tests/ui/out）`)
process.exit(failed === 0 ? 0 : 1)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { SPEED_TYPES, readLandRules, speedFactor } from '../src/land-type.js'
import { loadRules } from '../src/raw-rules.js'

/**
 * 地块速度表的读取口径，对着原版 `GAME.EXE` 的 `VA 0x64d610` 核（依据见 docs/ENGINE-MAP.md）：
 * 每段 8 个系数 + 1 个 `Buildable`，槽位次序 = 引擎枚举次序；缺键取 1.0、整段缺失取 0、上限封顶 1.0。
 */

/** 原版数值核对：只在本地提供原版 rules.ini 时运行。 */
const rulesPath = process.env.RA2_RULES_INI

test('移动方式的次序就是引擎表里的槽位次序', () => {
  // 槽位 4（Winged）不给 INI 键、恒 1.0，所以不在表里；槽位 8 是 Buildable，也不是系数
  assert.deepEqual(SPEED_TYPES, ['Foot', 'Track', 'Wheel', 'Hover', 'Float', 'Amphibious', 'FloatBeach'])
})

test('缺键取 1.0，不是取 0', () => {
  const land = readLandRules(loadRules([{ name: 'x', text: '[Clear]\nTrack=0%\n[Rock]\nFoot=0%\n' }]))
  assert.equal(speedFactor(land, 'Clear', 'Track'), 0, '显式 0% 按 0')
  assert.equal(speedFactor(land, 'Clear', 'Foot'), 1, '段里没写 Foot')
  assert.equal(speedFactor(land, 'Rock', 'Hover'), 1, '段里没写 Hover')
})

test('系数上限封顶到 1.0，负值按 0', () => {
  const land = readLandRules(loadRules([{ name: 'x', text: '[Clear]\nTrack=150%\nWheel=-50%\n' }]))
  assert.equal(speedFactor(land, 'Clear', 'Track'), 1)
  assert.equal(speedFactor(land, 'Clear', 'Wheel'), 0)
})

test('整段缺失的行走全 0（引擎整行不写，出厂镜像全零）', () => {
  const land = readLandRules(loadRules([{ name: 'x', text: '[Clear]\nTrack=100%\n' }]))
  const rock = land.get('Rock')
  assert.ok(rock)
  assert.equal(rock.buildable, false)
  for (const speedType of SPEED_TYPES) assert.equal(speedFactor(land, 'Rock', speedType), 0, `Rock ${speedType}`)
  assert.ok(rock.issues.length === 0, '段不存在不是解析错误')
})

test('解析不了的值记 issue 并判 0，不静默放过', () => {
  const land = readLandRules(loadRules([{ name: 'x', text: '[Clear]\nTrack=abc\nBuildable=maybe\n' }]))
  const clear = land.get('Clear')
  assert.equal(speedFactor(land, 'Clear', 'Track'), 0)
  assert.deepEqual(clear?.issues.map((issue) => issue.key).sort(), ['Buildable', 'Track'])
})

test('原版 rules.ini 的地块系数与本项目解析一致', { skip: !rulesPath ? '未设置 RA2_RULES_INI' : false }, () => {
  const rules = loadRules([{ name: 'rules.ini', text: fs.readFileSync(rulesPath!, 'latin1') }])
  const land = readLandRules(rules)
  assert.equal(speedFactor(land, 'Clear', 'Track'), 1)
  assert.equal(speedFactor(land, 'Road', 'Hover'), 0.75)
  assert.equal(speedFactor(land, 'Railroad', 'Track'), 1)
  assert.equal(speedFactor(land, 'Tiberium', 'Track'), 0.7)
  assert.equal(speedFactor(land, 'Water', 'Track'), 0)
  assert.equal(speedFactor(land, 'Water', 'Hover'), 1)
  assert.equal(speedFactor(land, 'Beach', 'Track'), 0)
  assert.equal(speedFactor(land, 'Beach', 'FloatBeach'), 1)
  assert.equal(speedFactor(land, 'Cliff', 'Track'), 0, '悬崖按 [Rock] 的全 0% 处理')
  assert.equal(land.get('Clear')?.buildable, true)
  assert.equal(land.get('Rock')?.buildable, false)
  assert.deepEqual(
    [...land.values()].flatMap((item) => item.issues),
    [],
  )
})

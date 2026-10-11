import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { crc32, hashFileName, readMixFile, readShp, readVxl } from '@ra2web/formats'
import {
  findOverride,
  loadUnitSheet,
  loadVoxelUnit,
  openStructures,
  openTheater,
  type AssetOverride,
} from '../src/index.js'

/**
 * 覆盖素材包：包里的同名文件优先于原版。
 *
 * 用法与原版 MOD 一致 —— 换材质不动引擎代码，只把替换文件放进自己的 MIX。
 */

/** 拼一个明文头 MIX（与 `mix.ts` 的读取分支对应），供测试造包。 */
function buildMix(entries: ReadonlyArray<{ name: string; data: Uint8Array }>): Uint8Array {
  const tableBytes = 6 + entries.length * 12
  const dataSize = entries.reduce((total, entry) => total + entry.data.length, 0)
  const bytes = new Uint8Array(tableBytes + dataSize)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, entries.length, true)
  view.setUint32(2, dataSize, true)
  let offset = 0
  entries.forEach((entry, index) => {
    const at = 6 + index * 12
    view.setUint32(at, hashFileName(entry.name, crc32), true)
    view.setUint32(at + 4, offset, true)
    view.setUint32(at + 8, entry.data.length, true)
    bytes.set(entry.data, tableBytes + offset)
    offset += entry.data.length
  })
  return bytes
}

test('覆盖包按文件名优先命中，未命中回落原版；内嵌包目录也认', () => {
  const pack = buildMix([
    { name: 'natsla.shp', data: new Uint8Array([1, 2, 3]) },
    { name: 'nested.mix', data: buildMix([{ name: 'inside.shp', data: new Uint8Array([4, 5, 6]) }]) },
  ])
  const overrides: readonly AssetOverride[] = [{ name: 'hd.mix', bytes: pack }]

  assert.deepEqual([...findOverride(overrides, 'natsla.shp')!], [1, 2, 3])
  // 第二个参数是资源名，第三个是原版档案里的内嵌包名（覆盖包里同名的内嵌包也会被找到）
  assert.deepEqual([...findOverride(overrides, 'inside.shp', 'nested.mix')!], [4, 5, 6])
  assert.equal(findOverride(overrides, 'nothing.shp'), undefined, '包里没有就返回 undefined')
  assert.equal(findOverride(undefined, 'natsla.shp'), undefined, '没挂包时不影响原版')
})

/** 本机原版档案：把一张真实 SHP 塞进覆盖包，验证它真的被优先取用。 */
const mixPath = process.env.RA2_MIX
const skip = !mixPath || !fs.existsSync(mixPath) ? '未设置 RA2_MIX' : false
/** 281MB 的原版档案只读一次：几个用例各读一遍会把并行测试的内存顶爆 */
let archiveBytes: Uint8Array | undefined
function readArchive(): Uint8Array {
  archiveBytes ??= new Uint8Array(fs.readFileSync(mixPath!))
  return archiveBytes
}

test('原版档案 + 覆盖包：建筑图形换成包里的那一份', { skip }, () => {
  const archive = readArchive()
  const original = openStructures(archive, 'snow')!.loadStructure('TESLA')!
  // 拿另一张真实 SHP 当"高清版"：只要它被优先取用，尺寸就会变
  const substitute = readMixFile({ bytes: archive, fileName: 'gapowr.shp', containerFileName: 'snow.mix' })!
  const substituteShp = readShp(substitute)
  assert.notEqual(substituteShp.width, original.shp!.width, '两张图必须尺寸不同才能区分')

  const overrides: readonly AssetOverride[] = [
    { name: 'hd.mix', bytes: buildMix([{ name: 'natsla.shp', data: substitute }]) },
  ]
  const replaced = openStructures(archive, 'snow', overrides)!.loadStructure('TESLA')!
  assert.equal(replaced.shp!.width, substituteShp.width, '应当取到覆盖包里的那一份')
  assert.equal(replaced.shp!.height, substituteShp.height)
})

test('覆盖包也能换单位体素模型', { skip }, () => {
  const archive = readArchive()
  const original = loadVoxelUnit({ bytes: archive, containerFileName: 'local.mix' }, 'htnk')!
  const heavier = loadVoxelUnit({ bytes: archive, containerFileName: 'local.mix' }, 'mtnk')!
  assert.notEqual(heavier.body.voxelCount, original.body.voxelCount, '两个模型的体素数必须不同')

  const overrides: readonly AssetOverride[] = [
    {
      name: 'hd.mix',
      bytes: buildMix([
        {
          name: 'htnk.vxl',
          data: readMixFile({ bytes: archive, fileName: 'mtnk.vxl', containerFileName: 'local.mix' })!,
        },
      ]),
    },
  ]
  const replaced = loadVoxelUnit({ bytes: archive, containerFileName: 'local.mix', overrides }, 'htnk')!
  assert.equal(replaced.body.voxelCount, heavier.body.voxelCount)
  assert.ok(readVxl(readMixFile({ bytes: archive, fileName: 'htnk.vxl', containerFileName: 'local.mix' })!))
})

test('覆盖包给真彩 PNG 时优先用它（建筑与单位各一条）', { skip }, () => {
  const archive = readArchive()
  const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
  const overrides: readonly AssetOverride[] = [
    {
      name: 'hd.mix',
      bytes: buildMix([
        { name: 'natsla.png', data: fakePng },
        { name: 'htnk.png', data: fakePng },
      ]),
    },
  ]

  // 建筑：图形名 NATSLA（TESLA 的 rules.ini Image=）→ natsla.png 命中，SHP 不再参与
  const structure = openStructures(archive, 'snow', overrides)!.loadStructure('TESLA')!
  assert.deepEqual([...(structure.pngBytes ?? [])], [...fakePng])
  assert.equal(structure.shp, undefined, 'PNG 命中时不再去取 SHP')
  // 没给 PNG 的类型仍走 SHP
  assert.ok(openStructures(archive, 'snow', overrides)!.loadStructure('NAFLAK')!.shp)

  // 单位：<单位>.png 命中
  assert.deepEqual([...(loadUnitSheet(overrides, 'HTNK') ?? [])], [...fakePng])
  assert.equal(loadUnitSheet(overrides, 'MTNK'), undefined)
  assert.equal(loadUnitSheet(undefined, 'HTNK'), undefined)
})

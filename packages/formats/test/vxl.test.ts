import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { crc32 } from '../src/crc32.js'
import { absoluteEntryOffset, findMixEntry, readMixEntry, readMixIndex } from '../src/mix.js'
import { readVxl } from '../src/vxl.js'

/**
 * 合成一个最小 VXL：1 节、2×1 列、高 2，两列分别放 1 个和 2 个体素。
 * 用于验证解析而不依赖任何受版权保护的素材。
 */
function buildSyntheticVxl(): Uint8Array {
  const headerBase = 16 + 4 * 4 + 2
  const palette = 768
  const sectionHeader = 28
  const bodyStart = headerBase + palette + sectionHeader

  const startTable = 2 * 4
  const endTable = 2 * 4
  // 列(0,0)：skip0/count1/(10,1)/end1，再用 skip1/count0 把 z 推到 sizeZ；
  // 列(1,0)：skip0/count2/(20,2)(21,3)/end2，z 自然到达 sizeZ
  const runs = [0, 1, 10, 1, 1, 1, 0, 0, 0, 2, 20, 2, 21, 3, 2]
  const bodySize = startTable + endTable + runs.length
  const total = bodyStart + bodySize + 92
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)

  const name = 'TEST'
  for (let i = 0; i < name.length; i++) bytes[i] = name.charCodeAt(i)
  view.setUint32(16, 0, true) // paletteCount
  view.setUint32(20, 1, true) // headerCount
  view.setUint32(24, 1, true) // tailerCount
  view.setUint32(28, bodySize, true)
  // 内嵌调色板前 3 字节：6 位分量
  bytes[headerBase] = 63
  bytes[headerBase + 1] = 32
  bytes[headerBase + 2] = 0
  // 节名
  const sectionName = 'DUMMY01'
  const sectionNameAt = headerBase + palette
  for (let i = 0; i < sectionName.length; i++) bytes[sectionNameAt + i] = sectionName.charCodeAt(i)

  view.setInt32(bodyStart, 0, true)
  view.setInt32(bodyStart + 4, 0, true)
  view.setInt32(bodyStart + 8, 4, true)
  view.setInt32(bodyStart + 12, 8, true)
  runs.forEach((value, index) => (bytes[bodyStart + 16 + index] = value))

  const tailerAt = bodyStart + bodySize
  view.setUint32(tailerAt, 0, true) // startingSpanOffset
  view.setUint32(tailerAt + 4, 0, true)
  view.setUint32(tailerAt + 8, 0, true)
  view.setFloat32(tailerAt + 12, 1 / 12, true) // hvaMultiplier
  const boundsAt = tailerAt + 16 + 48
  view.setFloat32(boundsAt, -1, true)
  view.setFloat32(boundsAt + 4, -1, true)
  view.setFloat32(boundsAt + 8, 0, true)
  view.setFloat32(boundsAt + 12, 1, true)
  view.setFloat32(boundsAt + 16, 1, true)
  view.setFloat32(boundsAt + 20, 1, true)
  view.setUint8(boundsAt + 24, 2) // sizeX
  view.setUint8(boundsAt + 25, 1) // sizeY
  view.setUint8(boundsAt + 26, 2) // sizeZ
  view.setUint8(boundsAt + 27, 2) // normalsMode
  return bytes
}

test('解析合成 VXL：节尺寸、体素、内嵌调色板', () => {
  const model = readVxl(buildSyntheticVxl())
  assert.equal(model.fileName, 'TEST')
  assert.equal(model.sections.length, 1)
  const section = model.sections[0]!
  assert.equal(section.name, 'DUMMY01')
  assert.deepEqual([section.sizeX, section.sizeY, section.sizeZ], [2, 1, 2])
  assert.equal(section.normalsMode, 2)
  assert.ok(Math.abs(section.hvaMultiplier - 1 / 12) < 1e-6)
  assert.equal(model.voxelCount, 3)
  assert.deepEqual(
    section.voxels.map((v) => [v.x, v.y, v.z, v.colorIndex, v.normalIndex]),
    [
      [0, 0, 0, 10, 1],
      [1, 0, 0, 20, 2],
      [1, 0, 1, 21, 3],
    ],
  )
  assert.equal(model.embeddedPalette?.length, 768)
})

test('长度不足报截断错误', () => {
  assert.throws(() => readVxl(new Uint8Array(10)))
})

/** 真实档案核对：设定 `RA2_MIX` 后启用。 */
const mixPath = process.env.RA2_MIX

test('原版 RA2.MIX 里的犀牛模型能被读出', { skip: !mixPath ? '未设置 RA2_MIX' : false }, () => {
  const archive = new Uint8Array(fs.readFileSync(mixPath!))
  const root = readMixIndex(archive)
  const localEntry = findMixEntry(root, 'local.mix', crc32)!
  const localBytes = readMixEntry(archive, root, localEntry)
  const local = readMixIndex(localBytes)
  const vxlEntry = findMixEntry(local, 'htnk.vxl', crc32)!
  const model = readVxl(readMixEntry(archive, root, absoluteEntryOffset(localEntry, local, vxlEntry)))

  assert.equal(model.sections.length, 1)
  const section = model.sections[0]!
  assert.deepEqual([section.sizeX, section.sizeY, section.sizeZ], [46, 34, 12])
  assert.equal(section.voxels.length, 4816)
  assert.equal(model.embeddedPalette?.length, 768)
})

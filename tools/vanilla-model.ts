import fs from 'node:fs'
import {
  absoluteEntryOffset,
  crc32,
  findMixEntry,
  paletteColor,
  readMixEntry,
  readMixIndex,
  readPalette,
  readVxl,
  type Rgb,
} from '../packages/formats/src/index.js'
import { writePng } from './png-write.js'

/**
 * 用**原版档案**渲染一个体素模型：
 *   RA2.MIX → local.mix → <单位>.vxl → 逐体素等距投影 → PNG。
 *
 * 这是"我们能读并使用原版美术"的端到端证明，也是后续渲染器的参考实现。
 *
 * 用法：tsx tools/vanilla-model.ts <RA2.MIX> <单位ID=htnk> <输出.png=model.png> [scale=3]
 */
const [mixPath, unitId = 'htnk', outPath = 'model.png', scaleArg = '3'] = process.argv.slice(2)
if (!mixPath) {
  console.error('usage: vanilla-model.ts <RA2.MIX> [unitId=htnk] [out.png=model.png] [scale=3]')
  process.exit(1)
}
const scale = Number(scaleArg)

const archive = new Uint8Array(fs.readFileSync(mixPath))
const root = readMixIndex(archive)
const localEntry = findMixEntry(root, 'local.mix', crc32)
if (!localEntry) throw new Error('RA2.MIX 里找不到 local.mix')
const localBytes = readMixEntry(archive, root, localEntry)
const local = readMixIndex(localBytes)

/** local.mix 的条目偏移是相对 local.mix 的，读取时要换算回父档案。 */
function readFromLocal(name: string): Uint8Array {
  const entry = findMixEntry(local, name, crc32)
  if (!entry) throw new Error(`local.mix 里找不到 ${name}`)
  return readMixEntry(archive, root, absoluteEntryOffset(localEntry!, local, entry))
}

const bodyBytes = readFromLocal(`${unitId}.vxl`)
const body = readVxl(bodyBytes)
const turret = (() => {
  try {
    return readVxl(readFromLocal(`${unitId}tur.vxl`))
  } catch {
    return undefined
  }
})()

const palette = body.embeddedPalette ? readPalette(body.embeddedPalette) : undefined
console.log(`模型 ${body.fileName || unitId}.vxl：节数 ${body.sections.length}，体素 ${body.voxelCount}`)
for (const section of body.sections) {
  console.log(
    `  [${section.name}] ${section.sizeX}x${section.sizeY}x${section.sizeZ} 体素 ${section.voxels.length} hvaMultiplier=${section.hvaMultiplier.toFixed(4)}`,
  )
}
console.log(`内嵌调色板：${palette ? `${palette.colors.length} 色` : '无'}`)

/**
 * 收集所有体素（机体 + 炮塔），统一到同一坐标系。
 *
 * 每节的体素是"该节局部坐标"，而 bounds 已经给出该节在整机空间中的位置
 * （例如炮塔 min.z≈11.7 正好接在机体 max.z≈11.4 之上），因此按 bounds.min 平移即可拼合。
 */
interface PlacedVoxel {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly colorIndex: number
  readonly normalIndex: number
}

function place(model: {
  sections: readonly { bounds: { min: readonly [number, number, number] }; voxels: readonly PlacedVoxel[] }[]
}): PlacedVoxel[] {
  const placed: PlacedVoxel[] = []
  for (const section of model.sections) {
    const [ox, oy, oz] = section.bounds.min
    for (const voxel of section.voxels) {
      placed.push({
        x: Math.round(ox) + voxel.x,
        y: Math.round(oy) + voxel.y,
        z: Math.round(oz) + voxel.z,
        colorIndex: voxel.colorIndex,
        normalIndex: voxel.normalIndex,
      })
    }
  }
  return placed
}

const allVoxels = [...place(body), ...(turret ? place(turret) : [])]
const minX = Math.min(...allVoxels.map((v) => v.x))
const minY = Math.min(...allVoxels.map((v) => v.y))
const minZ = Math.min(...allVoxels.map((v) => v.z))
const normalized = allVoxels.map((v) => ({ ...v, x: v.x - minX, y: v.y - minY, z: v.z - minZ }))
console.log(`合计体素 ${normalized.length}`)

const light = { x: -0.35, y: 0.55, z: 0.75 }
const normals = (() => {
  const list: Array<{ x: number; y: number; z: number }> = []
  const phi = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < 36; i++) {
    const y = 1 - (i / 35) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    list.push({ x: Math.cos(phi * i) * r, y, z: Math.sin(phi * i) * r })
  }
  return list
})()

const spanX = Math.max(...normalized.map((v) => v.x)) + 1
const spanY = Math.max(...normalized.map((v) => v.y)) + 1
const spanZ = Math.max(...normalized.map((v) => v.z)) + 1
const pad = 4
const width = Math.ceil((spanX + spanY + pad * 2) * scale)
const height = Math.ceil(((spanX + spanY) / 2 + spanZ + pad * 2) * scale)
const pixels = new Uint8Array(width * height * 4)
for (let i = 0; i < width * height; i++) {
  pixels[i * 4] = 20
  pixels[i * 4 + 1] = 24
  pixels[i * 4 + 2] = 28
  pixels[i * 4 + 3] = 255
}

const fallback: Rgb = { r: 200, g: 200, b: 200 }
const put = (px: number, py: number, color: Rgb): void => {
  if (px < 0 || py < 0 || px >= width || py >= height) return
  const i = (py * width + px) * 4
  pixels[i] = color.r
  pixels[i + 1] = color.g
  pixels[i + 2] = color.b
}

normalized.sort((a, b) => a.x + a.y + a.z - (b.x + b.y + b.z) || a.z - b.z)
for (const voxel of normalized) {
  const normal = normals[voxel.normalIndex % normals.length]!
  const diffuse = Math.max(0.35, normal.x * light.x + normal.y * light.y + normal.z * light.z)
  const base = palette ? paletteColor(palette, voxel.colorIndex) : fallback
  const shade = 0.55 + 0.75 * diffuse
  const color: Rgb = {
    r: Math.min(255, Math.round(base.r * shade)),
    g: Math.min(255, Math.round(base.g * shade)),
    b: Math.min(255, Math.round(base.b * shade)),
  }
  const sx = Math.round((voxel.x - voxel.y + spanY + pad) * scale)
  const sy = Math.round(((voxel.x + voxel.y) / 2 - voxel.z + spanZ + pad) * scale)
  for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) put(sx + dx, sy + dy, color)
}

fs.writeFileSync(outPath, writePng(width, height, pixels))
console.log(`渲染完成 → ${outPath}（${width}x${height}）`)

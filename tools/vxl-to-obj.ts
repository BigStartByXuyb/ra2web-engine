import fs from 'node:fs'
import { paletteColor, type Palette } from '@ra2web/formats'
import { loadUnitModel } from './game-assets.js'

// 原版单位体素 → OBJ + MTL，给 Blender 做高模与材质（3D 材质线的入口）。
//
// 用法：tsx tools/vxl-to-obj.ts <RA2.MIX> <out.obj> <单位ID> [--theater=temperate] [--scale=1]
//
// `--scale` 默认 **1**：`docs/ENGINE-UNIT3D.md` 的契约要求参考模型落在**体素空间**，
// 建模脚本的自检也拿它当尺寸基准（例如 HTNK 46×34×21）。默认值曾经是 3，
// 漏写就会拿到三倍尺寸的参考，于是每次构建都卡在"车长偏离参考"上。
//
// 只导出**表面体素**（六邻都实心的内部体素不导）；每个调色板颜色一个材质（`c<索引>`，Kd 取该颜色），
// Blender 里换材质就是换这几个槽位，这正是"材质可替换"要在美术侧留的口子。
// 坐标是体素空间（z 向上，1 体素 = `scale` 个单位）；贴地枢轴放在原点：
// 水平以模型中心为 0、竖直以底面为 0，与引擎精灵的锚点口径一致。
const [archivePath, outPath, unitId, ...rest] = process.argv.slice(2)
if (!archivePath || !outPath || !unitId) {
  console.error('usage: tsx tools/vxl-to-obj.ts <RA2.MIX> <out.obj> <unitId> [--theater=temperate] [--scale=1]')
  process.exit(1)
}
const option = (name: string, fallback: string): string =>
  rest.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const theater = option('theater', 'temperate')
const scale = Number(option('scale', '1'))

const archive = new Uint8Array(fs.readFileSync(archivePath))
const { model, palette } = loadUnitModel(archive, unitId, theater)
if (model.voxels.length === 0) {
  console.error(`${unitId}：档案里没有体素模型`)
  process.exit(1)
}
if (!palette) {
  console.error(`${unitId}：既没有内嵌色板，也取不到 ${theater} 的单位色板`)
  process.exit(1)
}

// 占位索引：x + y·spanX + z·spanX·spanY，用来判断六个邻居是否实心
const spanX = model.spanX
const spanY = model.spanY
const occupied = new Set<number>()
const key = (x: number, y: number, z: number): number => x + y * spanX + z * spanX * spanY
for (const voxel of model.voxels) occupied.add(key(voxel.x, voxel.y, voxel.z))

// 每个方向的四个角（逆时针，法线朝外），偏移是相对体素原点的 0/1
const FACES: ReadonlyArray<{
  readonly normal: readonly [number, number, number]
  readonly corners: readonly (readonly [number, number, number])[]
}> = [
  {
    normal: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  {
    normal: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    normal: [0, 1, 0],
    corners: [
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
    ],
  },
  {
    normal: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    normal: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    normal: [0, 0, -1],
    corners: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
  },
]

const halfX = (model.spanX - 1) / 2
const halfY = (model.spanY - 1) / 2
const vertices: string[] = []
const body: string[] = []
const colors = new Set<number>()
let vertexCount = 0
let faceCount = 0

for (const voxel of model.voxels) {
  for (const face of FACES) {
    const neighbourX = voxel.x + face.normal[0]!
    const neighbourY = voxel.y + face.normal[1]!
    const neighbourZ = voxel.z + face.normal[2]!
    if (occupied.has(key(neighbourX, neighbourY, neighbourZ))) continue
    colors.add(voxel.colorIndex)
    body.push(`usemtl c${voxel.colorIndex}`)
    const start = vertexCount
    for (const corner of face.corners) {
      vertices.push(
        `v ${(voxel.x + corner[0]! - halfX) * scale} ${(voxel.y + corner[1]! - halfY) * scale} ` +
          `${(voxel.z + corner[2]!) * scale}`,
      )
      vertexCount++
    }
    body.push(`f ${start + 1} ${start + 2} ${start + 3} ${start + 4}`)
    faceCount++
  }
}

const materialName = `${unitId.toLowerCase()}.mtl`
const material: string[] = []
for (const index of [...colors].sort((left, right) => left - right)) {
  const color = paletteColor(palette as Palette, index)
  material.push(
    `newmtl c${index}`,
    `Kd ${(color.r / 255).toFixed(4)} ${(color.g / 255).toFixed(4)} ${(color.b / 255).toFixed(4)}`,
    'Ks 0.0000 0.0000 0.0000',
    'd 1.0000',
    'illum 2',
    '',
  )
}

fs.writeFileSync(outPath, [`mtllib ${materialName}`, ...vertices, ...body, ''].join('\n'))
fs.writeFileSync(outPath.replace(/\.obj$/i, '.mtl'), material.join('\n'))
console.log(
  `${unitId}：${model.voxels.length} 体素（${model.spanX}×${model.spanY}×${model.spanZ}）→ ` +
    `${faceCount} 面 / ${vertexCount} 顶点 / ${colors.size} 种材质（scale=${scale}）→ ${outPath}`,
)

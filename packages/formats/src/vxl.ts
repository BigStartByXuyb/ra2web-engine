import { TruncatedInputError } from './errors.js'

/**
 * VXL 体素模型读取。
 *
 * 磁盘布局：
 *   header  16 字节文件名 + 4×u32 + 2×u8 + 768 字节内嵌调色板（共 802 字节）
 *   section headers  每节 28 字节：16 字节名字 + 3×u32
 *   body     每节顺序拼接：起始偏移表(sizeX×sizeY 个 i32) + 结束偏移表 + 体素游程
 *   tailers  每节 92 字节：3×u32 偏移 + f32 hvaMultiplier + 3×4 f32 变换矩阵
 *            + 3 f32 最小包围 + 3 f32 最大包围 + u8 sizeX/Y/Z + u8 normalsMode
 *
 * 体素游程：每个 (y,x) 列上 [跳过格数 u8, 体素数 u8, (颜色 u8, 法线 u8)×n, 结束计数 u8]，
 * 直到累计到 sizeZ。起始/结束偏移为 -1 表示该列没有体素。
 */

export interface VxlVoxel {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly colorIndex: number
  readonly normalIndex: number
}

export interface VxlSection {
  readonly name: string
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ: number
  readonly normalsMode: number
  readonly hvaMultiplier: number
  readonly bounds: {
    readonly min: readonly [number, number, number]
    readonly max: readonly [number, number, number]
  }
  readonly voxels: readonly VxlVoxel[]
}

export interface VxlModel {
  readonly fileName: string
  readonly embeddedPalette: Uint8Array | undefined
  readonly sections: readonly VxlSection[]
  readonly voxelCount: number
}

const HEADER_BASE_BYTES = 16 + 4 * 4 + 2
const EMBEDDED_PALETTE_BYTES = 768
const SECTION_HEADER_BYTES = 28
const SECTION_TAILER_BYTES = 92

export function readVxl(bytes: Uint8Array): VxlModel {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const stream = new Cursor(view)
  if (bytes.byteLength < HEADER_BASE_BYTES) throw new TruncatedInputError(HEADER_BASE_BYTES, 0)

  const fileName = stream.readFixedString(16)
  stream.skip(4) // paletteCount
  const sectionCount = stream.readUint32()
  const tailerCount = stream.readUint32()
  const bodySize = stream.readUint32()
  stream.skip(2) // paletteRemapStart / End

  const embeddedPalette =
    stream.remaining >= EMBEDDED_PALETTE_BYTES
      ? bytes.subarray(stream.position, stream.position + EMBEDDED_PALETTE_BYTES)
      : undefined
  stream.skip(EMBEDDED_PALETTE_BYTES)

  if (sectionCount !== tailerCount) {
    throw new TruncatedInputError(HEADER_BASE_BYTES + EMBEDDED_PALETTE_BYTES, 0)
  }

  const sectionNames: string[] = []
  for (let i = 0; i < sectionCount; i++) {
    sectionNames.push(stream.readFixedString(16))
    stream.skip(12)
  }

  const bodyStart = stream.position
  const tailerStart = bodyStart + bodySize
  const sections: VxlSection[] = []
  let voxelCount = 0

  for (let i = 0; i < sectionCount; i++) {
    const tailer = new Cursor(view, tailerStart + i * SECTION_TAILER_BYTES)
    const startingSpanOffset = tailer.readUint32()
    tailer.skip(8) // endingSpanOffset / dataSpanOffset
    const hvaMultiplier = tailer.readFloat32()
    tailer.skip(48) // 变换矩阵 3×4 f32
    const min: [number, number, number] = [tailer.readFloat32(), tailer.readFloat32(), tailer.readFloat32()]
    const max: [number, number, number] = [tailer.readFloat32(), tailer.readFloat32(), tailer.readFloat32()]
    const sizeX = tailer.readUint8()
    const sizeY = tailer.readUint8()
    const sizeZ = tailer.readUint8()
    const normalsMode = tailer.readUint8()

    const spans = new Cursor(view, bodyStart + startingSpanOffset)
    const startOffsets: number[] = []
    const endOffsets: number[] = []
    const cells = sizeX * sizeY
    for (let cell = 0; cell < cells; cell++) startOffsets.push(spans.readInt32())
    for (let cell = 0; cell < cells; cell++) endOffsets.push(spans.readInt32())

    const voxels: VxlVoxel[] = []
    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeX; x++) {
        const cell = y * sizeX + x
        if (startOffsets[cell] === -1 || endOffsets[cell] === -1) continue
        readVoxelColumn(spans, x, y, sizeZ, voxels)
      }
    }

    voxelCount += voxels.length
    sections.push({
      name: sectionNames[i]!,
      sizeX,
      sizeY,
      sizeZ,
      normalsMode,
      hvaMultiplier,
      bounds: { min, max },
      voxels,
    })
  }

  return { fileName, embeddedPalette, sections, voxelCount }
}

/** 一列的游程解码：跳过 → 计数 → 体素 → 结束计数，直到累计格数达到 sizeZ。 */
function readVoxelColumn(cursor: Cursor, x: number, y: number, sizeZ: number, out: VxlVoxel[]): void {
  let z = 0
  while (z < sizeZ) {
    z += cursor.readUint8()
    const count = cursor.readUint8()
    for (let i = 0; i < count; i++) {
      if (z >= sizeZ) break
      out.push({ x, y, z, colorIndex: cursor.readUint8(), normalIndex: cursor.readUint8() })
      z++
    }
    cursor.readUint8() // 结束计数
  }
}

/** 带边界的顺序读取游标。 */
class Cursor {
  public position: number

  public constructor(
    private readonly view: DataView,
    position = 0,
  ) {
    this.position = position
  }

  public get remaining(): number {
    return this.view.byteLength - this.position
  }

  public skip(count: number): void {
    this.ensure(count)
    this.position += count
  }

  public readUint8(): number {
    this.ensure(1)
    return this.view.getUint8(this.position++)
  }

  public readUint32(): number {
    this.ensure(4)
    const value = this.view.getUint32(this.position, true)
    this.position += 4
    return value >>> 0
  }

  public readInt32(): number {
    this.ensure(4)
    const value = this.view.getInt32(this.position, true)
    this.position += 4
    return value
  }

  public readFloat32(): number {
    this.ensure(4)
    const value = this.view.getFloat32(this.position, true)
    this.position += 4
    return value
  }

  public readFixedString(length: number): string {
    this.ensure(length)
    let text = ''
    for (let i = 0; i < length; i++) {
      const code = this.view.getUint8(this.position + i)
      if (code === 0) break
      text += String.fromCharCode(code)
    }
    this.position += length
    return text
  }

  private ensure(count: number): void {
    if (this.position + count > this.view.byteLength)
      throw new TruncatedInputError(this.position + count, this.position)
  }
}

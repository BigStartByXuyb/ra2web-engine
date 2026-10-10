import type { VxlModel } from '@ra2web/formats'

/** 仓库不存放受版权保护的素材：测试用 `buildDemoVoxelModels` 的合成模型与这个单个体素模型。 */

export function buildSingleVoxelModel(): readonly VxlModel[] {
  return [
    {
      fileName: 'ONE.VXL',
      embeddedPalette: buildSyntheticPalette(),
      voxelCount: 1,
      sections: [
        {
          name: 'ONLY',
          sizeX: 1,
          sizeY: 1,
          sizeZ: 1,
          normalsMode: 1,
          hvaMultiplier: 1 / 12,
          bounds: { min: [0, 0, 0], max: [0, 0, 0] },
          voxels: [{ x: 0, y: 0, z: 0, colorIndex: 1, normalIndex: 0 }],
        },
      ],
    },
  ]
}

/** 6 位分量调色板：读取后应当被放大 4 倍。 */
function buildSyntheticPalette(): Uint8Array {
  const bytes = new Uint8Array(768)
  for (let index = 0; index < 256; index++) {
    bytes[index * 3] = index & 63
    bytes[index * 3 + 1] = (index * 2) & 63
    bytes[index * 3 + 2] = (index * 3) & 63
  }
  return bytes
}

/** 像素级快照用的字节哈希：实现故意与仓库里的哈希分开，避免"用被测代码验证被测代码"。 */
export function hashBytes(bytes: Uint8Array): string {
  let hash = 2166136261
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0
  return hash.toString(16).padStart(8, '0')
}

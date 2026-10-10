import type { VxlModel } from '@ra2web/formats'

/**
 * 演示与自检用模型：4×3 的钩形机体 + 2 个体素的炮塔，全部手工构造。
 *
 * 公开页面与单元测试都不能携带原版素材，因此用一个够大、左右前后都不对称的形状：
 * 形状太小或对称时，45° 档旋转后取整会塌回同一张像素图，8 朝向就测不出差别。
 */
export function buildDemoVoxelModels(): readonly VxlModel[] {
  return [
    {
      fileName: 'DEMO.VXL',
      embeddedPalette: buildDemoPalette(),
      voxelCount: 10,
      sections: [
        {
          name: 'BODY',
          sizeX: 4,
          sizeY: 3,
          sizeZ: 2,
          normalsMode: 1,
          hvaMultiplier: 1 / 12,
          bounds: { min: [0, 0, 0], max: [3, 2, 1] },
          voxels: [
            { x: 0, y: 0, z: 0, colorIndex: 10, normalIndex: 0 },
            { x: 1, y: 0, z: 0, colorIndex: 11, normalIndex: 5 },
            { x: 2, y: 0, z: 0, colorIndex: 12, normalIndex: 17 },
            { x: 3, y: 0, z: 0, colorIndex: 13, normalIndex: 9 },
            { x: 0, y: 1, z: 0, colorIndex: 14, normalIndex: 2 },
            { x: 1, y: 1, z: 0, colorIndex: 15, normalIndex: 6 },
            { x: 2, y: 1, z: 0, colorIndex: 16, normalIndex: 11 },
            { x: 1, y: 2, z: 0, colorIndex: 17, normalIndex: 21 },
            { x: 1, y: 1, z: 1, colorIndex: 18, normalIndex: 30 },
            { x: 2, y: 1, z: 1, colorIndex: 19, normalIndex: 33 },
          ],
        },
      ],
    },
    {
      fileName: 'DEMOTUR.VXL',
      embeddedPalette: undefined,
      voxelCount: 2,
      sections: [
        {
          name: 'TURRET',
          sizeX: 2,
          sizeY: 1,
          sizeZ: 1,
          normalsMode: 1,
          hvaMultiplier: 1 / 12,
          bounds: { min: [1, 1, 3], max: [2, 1, 3] },
          voxels: [
            { x: 0, y: 0, z: 0, colorIndex: 20, normalIndex: 3 },
            { x: 1, y: 0, z: 0, colorIndex: 21, normalIndex: 8 },
          ],
        },
      ],
    },
  ]
}

/** 6 位分量调色板：读取后应当被放大 4 倍。 */
function buildDemoPalette(): Uint8Array {
  const bytes = new Uint8Array(768)
  for (let index = 0; index < 256; index++) {
    bytes[index * 3] = index & 63
    bytes[index * 3 + 1] = (index * 2) & 63
    bytes[index * 3 + 2] = (index * 3) & 63
  }
  return bytes
}

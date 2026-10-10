# @ra2web/render

把模拟状态与原版素材画成像素：等距投影、体素模型定位、体素光栅化成 8 朝向精灵。

## 是什么

- `iso.ts`：格坐标 ↔ 屏幕像素的等距投影，地图地块与单位精灵共用这一份。
- `voxel-model.ts`：把 VXL 各节的体素按节包围盒拼成整机坐标并归一化。
- `voxel-sprite.ts`：体素投影 + 画家算法排序 + 定向光着色 → RGBA 精灵（8 朝向 + 贴地锚点）。
- `shading.ts`：法线索引 → 方向向量 → 漫反射着色。

纯函数、无浏览器 API，Node 与浏览器跑同一份代码。

## 怎么用

```ts
import { readVxl } from '@ra2web/formats'
import { positionVoxelModel, renderVoxelSprite } from '@ra2web/render'

const model = positionVoxelModel([readVxl(bodyBytes), readVxl(turretBytes)])
const sprite = renderVoxelSprite(model, { facing: 3, pixelsPerVoxel: 4 })
// sprite.rgba / sprite.width / sprite.height；贴到格中心时用 sprite.anchorX/anchorY 对齐
```

## 不覆盖

- 不读文件、不认识档案：字节 → 模型由 `@ra2web/formats` 负责。
- 不写模拟状态：只读 `PositionedModel`，不 import `@ra2web/sim`。
- 不做 HVA 动画：炮塔/车体的逐帧变换尚未接入，当前只用静态姿态。
- 不做地块绘制：TMP 地形渲染是后续阶段。

## 未核对项

以下取值是"能画出正确形状"的近似，必须核对原版后再回填，核对方法与位置：

| 项                     | 位置                        | 核对方法                                                |
| ---------------------- | --------------------------- | ------------------------------------------------------- |
| 地块像素尺寸 60×30     | `src/iso.ts` `RA2_ISO_VIEW` | 用原版截图逐格测量，或从 GAME.EXE 地块绘制函数取常数    |
| 法线表                 | `src/shading.ts`            | 按 VXL 的 `normalsMode` 还原原版法线表（6 面 / 精细表） |
| 着色系数 0.55 / 0.75   | `src/shading.ts`            | 与原版同一模型同朝向的截图像素比对                      |
| 朝向编号 ↔ 游戏方向    | `src/voxel-sprite.ts`       | 用原版同一单位的 8 朝向精灵逐档比对                     |
| 旋转中心（包围盒中心） | `src/voxel-sprite.ts`       | 核对 VXL 节的变换矩阵原点，确认是否等于包围盒中心       |
| 体素 → 格的比例        | `src/iso.ts` 未使用         | 需要时从原版单位尺寸反推（1 格 = 多少体素）             |

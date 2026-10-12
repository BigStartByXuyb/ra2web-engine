# 3D 单位模型契约

`?units3d=1` 下引擎按单位类型找 `/packs/units3d/<单位>.glb`，直接当体素坐标画（`webgl-unit3d.ts`）。
找不到就退回 8 朝向贴图或原版体素，三种来源可以逐单位混用。

## 模型必须满足的约定

| 项     | 要求                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------- |
| 坐标轴 | glTF 一手交进来，引擎只做轴交换：glTF X → 体素 X（车长）、glTF Y → 体素 Z（向上）、glTF −Z → 体素 Y |
| 单位   | **体素**，引擎不做任何缩放                                                                          |
| 尺寸   | 与参考（`htnk-voxel.glb` 这类原版体素翻模）一致：X 46.0 / Y 34.0 / Z 17.15                          |
| 贴地   | 最低点 z = 0，X/Y 居中（车体枢轴落在格子中心＋底面）                                                |
| 朝向   | 车头朝 +X                                                                                           |
| 材质   | 每种材质给 baseColor / metallic / roughness 即可（引擎当前不读贴图）                                |

## 工具

都在 `tools/blender/`，用便携版 Blender 跑：`work/tools/blender-4.5.13-windows-x64/blender.exe -b -P <脚本> -- <参数>`。

| 脚本                   | 作用                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `unit_build.py`        | 共用件：材质、基础体、合并贴地、与参考对齐、自检、导出（形状脚本只 import 这一份） |
| `unit_audit.py`        | 共用量法：包围盒、横向看穿缝（被上面与下面两个脚本 import，不要另抄一份）          |
| `build-unit-tank.py`   | 重型坦克（HTNK）的形状                                                             |
| `build-unit-mcv.py`    | 基地车（SMCV）的形状                                                               |
| `render-unit-views.py` | 正前／正侧／正上正交图 + 3/4 参考图，另拼 2×2 版面；加 `--clay` 只渲形体           |
| `audit-unit-parts.py`  | 逐材质包围盒、高度分带、正视/俯视 ASCII 剪影                                       |

```powershell
$blender = "D:\AI_GAME\work\tools\blender-4.5.13-windows-x64\blender.exe"
$pack = "D:\AI_GAME\work\hd-packs\units3d"
& $blender -b -P tools\blender\build-unit-tank.py -- "$pack\htnk-voxel.glb" "$pack\htnk.glb"
& $blender -b -P tools\blender\build-unit-mcv.py -- "$pack\smcv-voxel.glb" "$pack\smcv.glb"
& $blender -b -P tools\blender\render-unit-views.py -- "$pack\htnk.glb" "D:\AI_GAME\work\soviet-hd\out\htnk-views" 720 56
```

参考模型一律取原版体素翻模（`<单位>-voxel.glb`）：它就是"这个单位多大、朝哪边、枢轴在哪"的口径。

## 建模脚本里的三条定数

1. **盒子边长**：`primitive_cube_add(size=2)` 再乘 `size/2` 才等于 `size`；写 `size=1` 会把每个盒子砍成一半，
   只有配一次整体放大才看不出来 —— 一旦按目标尺寸直接建模就会散架。
2. **横向必须连续**：车体侧面与履带要重叠（车体半宽 ≥ 履带内侧面），外加上覆盖履带上半段的侧裙。
   留缝就会在正视图里露出贯穿的空档。自检用"沿车长看有没有一条 |y| 上完全没有面盖住"来卡，
   阈值 0.8 体素。
3. **不要造共面的两张面**：两个盒子的侧面算出来落在同一个坐标上时，渲染会互相遮挡成一条黑带
   （游戏里表现为闪烁）。要让它们错开一点，或者干脆合成一个体。
4. **自检不达标不导出**：X/Y/Z 与参考差 > 0.6（导出前先整体平移到与参考同枢轴）、横向看穿缝 > 0.8，
   任一条挂掉就只打印原因、不写文件。

## 出图的打光

主光 + 反向补光 + 中性环境（背景 0.30 灰）。只用一盏侧光会让朝相机那一面整个压黑，
三视图是拿来读形体和颜色的，两面都要看得清。`--clay` 把材质全换成一盏浅灰：
这时还发黑的地方就是"洞或深槽"，不是材质黑。

## 量法的坑

横向"有没有缝"要按**三角面的 y 跨度**打格。按顶点取样（更别说先取 |y|）会把整片平面判成空的：
盒子的顶点只在角上，跨中线的顶面三个角的 |y| 全都等于半宽。

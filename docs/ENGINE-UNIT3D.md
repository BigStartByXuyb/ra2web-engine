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

| 脚本                   | 作用                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `build-unit-tank.py`   | 参数化造一辆重型坦克并导出 GLB；**自检不过就不导出**                      |
| `unit_audit.py`        | 共用量法：包围盒、横向看穿缝（被上面与下面两个脚本 import，不要另抄一份） |
| `render-unit-views.py` | 正前／正侧／正上正交图 + 3/4 参考图，另拼 2×2 版面                        |
| `audit-unit-parts.py`  | 逐材质包围盒、高度分带、正视/俯视 ASCII 剪影                              |

```powershell
$blender = "D:\AI_GAME\work\tools\blender-4.5.13-windows-x64\blender.exe"
& $blender -b -P tools\blender\build-unit-tank.py -- "D:\AI_GAME\work\hd-packs\units3d\htnk-voxel.glb" "D:\AI_GAME\work\hd-packs\units3d\htnk.glb"
& $blender -b -P tools\blender\render-unit-views.py -- "D:\AI_GAME\work\hd-packs\units3d\htnk.glb" "D:\AI_GAME\work\soviet-hd\out\htnk-views" 720 56
```

## 建模脚本里的三条定数

1. **盒子边长**：`primitive_cube_add(size=2)` 再乘 `size/2` 才等于 `size`；写 `size=1` 会把每个盒子砍成一半，
   只有配一次整体放大才看不出来 —— 一旦按目标尺寸直接建模就会散架。
2. **横向必须连续**：车体侧面与履带要重叠（车体半宽 ≥ 履带内侧面），外加上覆盖履带上半段的侧裙。
   留缝就会在正视图里露出贯穿的空档。自检用"沿车长看有没有一条 |y| 上完全没有面盖住"来卡，
   阈值 0.8 体素。
3. **尺寸自检不达标不导出**：X/Y/Z 与参考差 > 0.6、最低点离地 > 0.06、横向未居中 > 0.3，
   任一条挂掉就只打印原因、不写文件。

## 量法的坑

横向"有没有缝"要按**三角面的 y 跨度**打格。按顶点取样（更别说先取 |y|）会把整片平面判成空的：
盒子的顶点只在角上，跨中线的顶面三个角的 |y| 全都等于半宽。

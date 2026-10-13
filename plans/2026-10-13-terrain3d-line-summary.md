# 地貌线整线总结（任务 1–4）

规格：`docs/TERRAIN-ROADMAP.md`。执行：地貌线会话（持久），总工逐任务验收。全部未 push 的提交以总工推送为准。

## 提交清单（16 提交 + 1 UI 用例待提交）

| 任务 | 提交 | 内容 |
| --- | --- | --- |
| 1 地表 PBR 材质 | a6cc9b6 | zStep 取证（未闭合：读者全在移动侧、.text 无 30/256 浮点；试算 10.547 + 台账 unk_3a77f19a） |
| | c100d56 | 材质采样（调色板/TMP 证据取色 + TERRAIN_PBR_STYLE 自定表） |
| | 0dd1a80 | 面片→3D 顶点（复用 buildTerrainMesh；崖壁竖直棱 worldY 相等单测钉） |
| | 0db583f | GL 渲染器 + 场景工厂（固定噪声种子、WeakMap 按图缓存） |
| | b23b73a | 接缝 4 处（总工批）：GlTileLayer.gl / terrain3d 钩子 / 清屏后 drawGround / overlay 抬升 |
| | 1b2ace7 | UI 用例 ×2 + **修两真 bug**：顶点投影必须世界系直落屏；缺图 1035 格按 Clear 垫底（曾落绿斑） |
| 2 崖壁与过渡 | 56b8ae1 | 取证入档：崖块集合三键 / RampTiles 缺 / 岸线摆位语义（ENGINE-MAP 文末） |
| | aaea52b | theater.ts 崖集查询（新增接缝，总工批；app.readable.js:5887/6047 口径） |
| | 5ed2b32 | 边界混合（共享角 albedo 均值）+ 岸线湿边（Beach 邻水 ×0.85） |
| | dbd6e07 | 崖壁分档材质 + 墙面岩理 + 坡道几何（terrain-mesh 加法扩展 rampTypeAt+逐角 zs，缺省逐值等价、回归零改动） |
| | 0281350 | 崖图 UI 用例（MULTI.MIX #7，218 崖格） |
| 3 水面 PBR | 5ec6ed8 | 帧色表（WaterSet 逐帧真实像素×调色板，空帧占位） |
| | bcba129 | 水格标记（STRIDE 13）+ 水面分支（帧号驱动波纹/菲涅尔）+ render 帧号参数 |
| | 709727f | 补 fallbackMaterial 导入（typecheck 抓到的运行时崩溃） |
| | 5897b91 | terrain3d 水面 UI 用例（开动画在动 / 关动画逐像素静止） |
| 4 地貌细节 | ac06254 | 痕迹缓冲（世界→缓冲换算/盖章参数/脏位，纯逻辑可测） |
| | d05aeef | 痕迹贴花接线（单位位置流盖章→纹理→压暗）+ 低频污渍 + ?decals=0 |
| | bc6e526 | 车辙/踩痕 UI 用例（decals 开关差异 92178 像素） |

## 四个任务验收状态

1. **地表 PBR 材质管线**——总工验收通过。TMP 地块类型驱动的程序化 PBR；默认路径逐像素不变（UI 差异 0 全程保持）。
2. **崖壁与过渡**——总工验收通过（含机制层：缺省逐值等价算术已核 + render 回归 13/13 零改动）。
3. **水面 PBR**——总工验收通过（帧机制零改动/反射免新管线/自抓运行时崩溃正面案例）。
4. **地貌细节**——实现完成，UI 用例跑验中。

## 全部自定项清单（本项目自定，代码注释与提交信息逐处标注）

1. `TERRAIN_PBR_STYLE`：11 类地块 roughness/metallic/noiseScale 参数表；
2. 2 倍频值噪声（0.05 / 0.21）打碎大平面 + 方差调制；
3. 崖壁墙面：沿墙走向竖向条纹（0.8+0.3×stripe）+ 距崖顶约一级内接触带压暗（0.72→1）；
4. 边界混合：共享角 albedo 均值；岸线湿边 = Beach 邻水角先混后 ×0.85；
5. 水面：波纹相位由帧号驱动（帧不动即静止）；菲涅尔边缘 +0.35；反射复用既有物体倒影 pass 与其 WET_REFLECTION 参数；
6. 地貌细节：痕迹软刷半径 1.6 格 / 单枚强度 0.35 / 压暗系数 0.78；低频污渍 0.90–1.00 乘性；`?decals=0` 开关；
7. 调试开关本身：`?terrain3d=1`（默认关）、`?decals=0`（默认开）；
8. 缺图格（loadTile 失败）按 Clear 垫底画 —— 与 2D 路径 groundCanvas 同口径；
9. 水面帧色表空帧回落"前一有效帧"策略。

## 待核台账汇总

| 项 | 状态 | 位置 / 探针 |
| --- | --- | --- |
| zStep 一级折像素（10.547 试算 vs 12.245 候选） | 未闭合，试算值使用中 | unk_3a77f19a（medium/rendering）；证据 work/decompiled/ra2-engine/zstep-lepton-to-pixel.md + ENGINE-MAP「地貌线：一级高度折像素」；闭合探针=战术显示地块绘制/单位落屏例程 |
| `RAMP_HEIGHTS` / 坡道角序 | 参考实现口径（非二进制） | ENGINE-MAP「崖块集合与坡道语义」待核条目；可随引擎线 Can_Enter_Cell 取证顺路核 |
| `cliffBackImpassability`（崖后格标 Rock） | 通行性语义，归引擎线 | ENGINE-MAP 已入档，地貌线不实现 |
| 各剧场崖集缺键兜底 | 三剧场实测齐全，MOD 未测 | cliffSetIndexesOf 缺键按缺席处理（不抛错） |

## 门禁与纪律

- 每任务收尾：`npm run app:build` → `npm run test` → `npm run test:ui` 全绿；逐像素用例（WebGL vs 2D 差异 0）全程保持；**黄金哈希零变更**（纯渲染层，未触 sim）；
- 共享文件接缝 3 处全部先报总工批复（webgl-tile-layer / assets·theater / render·terrain-mesh）；
- TDD 全程：每模块先失败测试再实现；共享门禁 skip 纪律按总工两次纠正执行。

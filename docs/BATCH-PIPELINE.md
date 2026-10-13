# 量产出模调用序列（苏军地面载具线）

打样过审后，每个单位一条命令链跑完"配色 → 建模 → 自检导出 → 审阅图"。
形状脚本（`tools/blender/build-unit-<单位>.py`）是每个单位的建模劳动量所在，
其余三段全部固化——本文件就是那条命令链的权威版本，改口径先改这里。

## 队列（辨识度排序，主力优先）

| # | 单位 | 代码 | Image | voxel | cameo | 状态 |
| - | ---- | ---- | ----- | ----- | ----- | ---- |
| 1 | 犀牛坦克 | HTNK | HTNK | ✓ | ✓ | **定稿**（4935405） |
| 2 | 天启 | APOC | MTNK | ✓ | ✓ | **v2 迭代中** |
| 3 | V3 导弹车 | V3 | V3 | ✓ | ✓ | 待开 |
| 4 | 特斯拉坦克 | TTNK | TTNK | ✓ | ✓ | 待开 |
| 5 | 战争矿车 | HARV | HARV | ✓ | ✓ | 待开 |
| 6 | 轻型坦克 | LTNK | LTNK | ✓ | ✗（无图标） | 待开 |
| 7 | 战役运输车 | HTK | HTK | ✓ | ✓ | 待开 |
| - | 恐怖机器人 | DRON | DRON | ✗ | ✓ | 需全手建（蜘蛛足） |
| - | 潜艇/无畏/基洛夫/雌鹿 | SUB/DRED/ZEP | - | ✓ | - | 海/空线另立 |

步兵是人形骨架架构，不在这条车体系队列里。

## 一单位一命令链

```bash
# ① 配色（识别色已自动排除灰阶聚类，红系单位免手工校正）
npx tsx tools/build-unit-textures.ts D:/AI_GAME/work/assets/pack/RA2.MIX \
  D:/AI_GAME/work/hd-packs/unit-textures-<单位> <image小写> temperate

# ② 建模 + 烘焙 + 自检导出（形状脚本每单位一份；分件层级/枢轴照 HTNK 契约）
D:/AI_GAME/work/tools/blender-4.5.13-windows-x64/blender.exe -b \
  -P tools/blender/build-unit-<单位>.py -- \
  <参考voxel.glb> D:/AI_GAME/work/hd-packs/units3d/<单位>.glb \
  D:/AI_GAME/work/hd-packs/unit-textures-<单位>

# ③ 审阅三视图 + 与 voxel 参考的成对 iso
D:/AI_GAME/work/tools/blender-4.5.13-windows-x64/blender.exe -b \
  -P tools/blender/render-unit-views.py -- \
  D:/AI_GAME/work/hd-packs/units3d/<单位>.glb D:/AI_GAME/work/tmp-shots/<单位>

# ⓪ 可选：单位清单核对（Owner=Russians + voxel 在包）
npx tsx tools/dump-soviet-units.ts D:/AI_GAME/work/assets/pack/RA2.MIX \
  D:/AI_GAME/work/hd-packs/units3d
```

 cameo 预提取（建模参考，一次跑完）：
`npx tsx tools/extract-cameo.ts D:/AI_GAME/work/hd-packs/refs <单位ID...>`
（LTNK 无图标——战役单位，用 voxel 参考替代 cameo。）

## 验收口径（ART-ROADMAP + 本线追加）

- 分件层级 root/hull/turret/barrel，枢轴=炮塔环中心/耳轴（脚本固化）
- 分层剖面对照 mean|Δ|>2 拒导出；屏幕轮廓按车长差补偿
- 贴图内嵌、逐面采样零暗面；Blender GUI 直开
- 金属度：BareMetal ≤0.45、TrackLink ≤0.35（发黑修复红线）

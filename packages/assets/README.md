# @ra2web/assets

把原版档案里的字节对应到"可用的美术资源"。

## 是什么

- `voxel-unit.ts`：一个单位的体素美术 = `<单位>.vxl`（机体）+ `<单位>tur.vxl`（炮塔，可选）。
- `theater.ts`：一个剧场的地块美术 = 地块控制文件（`temperat.ini` 等）+ 地块图形档案
  （`isotemp.mix` 等）+ 地形调色板（`cache.mix` 里的 `isotem.pal` 等）。

## 怎么用

```ts
import { loadTerrainPalette, loadVoxelUnit, openTheater, voxelUnitModels } from '@ra2web/assets'
import { paintTmpSubTile, positionVoxelModel } from '@ra2web/render'

const unit = loadVoxelUnit({ bytes: archiveBytes, containerFileName: 'local.mix' }, 'htnk')
if (unit) positionVoxelModel(voxelUnitModels(unit))

const theater = openTheater(archiveBytes, map.theater ?? 'temperate')
const palette = loadTerrainPalette(archiveBytes, map.theater ?? 'temperate')
const tile = theater?.loadTile(0)
const sub = tile?.subTiles[0]
if (tile && sub && palette) paintTmpSubTile(tile, sub, palette)
```

命令行工具与浏览器页面都用这一份，不在各自代码里重写"哪个文件是哪个部位"。

## 与 formats 的边界

`formats` 只认字节与格式，不认识"单位""炮塔"；`assets` 才持有原版素材的命名与布局约定
（`tur` 后缀、`local.mix` 嵌套）。取不到资源返回 `undefined`，由调用方决定怎么提示。

## 不覆盖

- 不画像素：调色板上色与菱形排布在 `@ra2web/render` 的 `paintTmpSubTile`。
- 不取 SHP/水域动画层/矿与树（按阶段补）。
- 不做缓存、不做 MOD 覆盖层：那是加载器与 MOD 加载阶段的事。

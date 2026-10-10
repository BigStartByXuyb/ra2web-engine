# @ra2web/assets

把原版档案里的字节对应到"可用的美术资源"。

## 是什么

- `voxel-unit.ts`：一个单位的体素美术 = `<单位>.vxl`（机体）+ `<单位>tur.vxl`（炮塔，可选）。

## 怎么用

```ts
import { loadVoxelUnit, voxelUnitModels } from '@ra2web/assets'
import { positionVoxelModel } from '@ra2web/render'

const unit = loadVoxelUnit({ bytes: archiveBytes, containerFileName: 'local.mix' }, 'htnk')
if (unit) positionVoxelModel(voxelUnitModels(unit))
```

命令行工具与浏览器页面都用这一份，不在各自代码里重写"哪个文件是哪个部位"。

## 与 formats 的边界

`formats` 只认字节与格式，不认识"单位""炮塔"；`assets` 才持有原版素材的命名与布局约定
（`tur` 后缀、`local.mix` 嵌套）。取不到资源返回 `undefined`，由调用方决定怎么提示。

## 不覆盖

- 不解析调色板文件（PAL/SHP/TMP 的取用按阶段补）。
- 不做缓存、不做 MOD 覆盖层：那是加载器与 MOD 加载阶段的事。

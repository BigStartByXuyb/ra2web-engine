# @ra2web/formats

原版数据格式读取层。纯函数、零业务概念、可在 Node 与浏览器中运行。

## 覆盖

- `mix.ts`：MIX 档案索引与条目读取（明文头与 RA2 加密头）、文件名哈希、嵌套档案取文件
- `ini.ts` / `theater.ts`：INI 文本解析；剧场的地块控制表（`[TileSet####]` → 全局地块编号）
- `map.ts`：地图（`[IsoMapPack5]` 地形、`[OverlayPack]` 覆盖物、坐标换算）
- `packed-blocks.ts` / `lzo1x.ts` / `format80.ts`：地图"分块包"容器与两种解码器
- `tmp.ts` / `shp.ts`：等距地块图块、SHP 图形（含各压缩类型）
- `vxl.ts` / `pal.ts`：体素模型、调色板
- `base64.ts` / `crc32.ts` / `errors.ts`：底座

## 不覆盖

- 不解析游戏语义（单位、武器等）——那是 `@ra2web/rules` 的职责。
- 不认"哪个文件是哪个部位"、不画像素——那是 `@ra2web/assets` 与 `@ra2web/render` 的职责。
- 不做缓存，不为损坏数据兜底：越界一律抛错，不做静默截断。

## 用法

```ts
import { parseIni, readMixIndex } from '@ra2web/formats'
```

# @ra2web/formats

原版数据格式读取层。纯函数、零业务概念、可在 Node 与浏览器中运行。

## 覆盖

- `mix.ts`：MIX/MMX 档案索引与条目读取，文件名哈希（原版算法）
- `ini.ts`：INI 文本解析（节、键、大小写规则、注释）

## 不覆盖

- 不解析游戏语义（单位、武器等）——那是 `@ra2web/rules` 的职责。
- 暂不支持加密头（RA/TS 型）的 MIX 档案，遇到时抛 `UnsupportedMixHeaderError`。

## 用法

```ts
import { parseIni, readMixIndex } from '@ra2web/formats'
```

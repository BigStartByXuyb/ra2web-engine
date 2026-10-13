# 编码规范

本文件是硬性约束。任何提交与本文件冲突时，以本文件为准；需要例外时先在评审里改本文件。

## 语言与命名

- 标识符（变量、函数、类型、文件）一律**英文**；面向玩家的文案与文档**中文**。
- 类型与接口：`PascalCase`（`VxlSection`、`MixArchive`）。
- 函数与方法：`camelCase`，动词开头（`readVxlSection`、`parseIni`）。
- 常量：`UPPER_SNAKE_CASE`；单位与量纲写进名字（`TICKS_PER_SECOND`、`BYTES_PER_VOXEL`）。
- 布尔量用 `is/has/can/should` 前缀；禁止 `flag`、`data`、`info`、`temp` 这类无信息量命名。
- 禁止默认导出；只用具名导出，保证重命名与检索可靠。

## 类型

- `strict: true`，禁止 `any`；外部输入用 `unknown` + 解析函数收窄。
- 领域模型用 `readonly` 字段；可变状态只允许出现在模拟内核里，并且必须带显式类型别名。
- 数值语义用 branded type 区分（`type Tick = number & { readonly __brand: 'Tick' }`），
  防止把 tick、秒、像素互相赋值。

## 分层与依赖方向

依赖只能单向流动，禁止反向 import 与循环依赖：

```
formats  →  rules  →  sim  →  app
                    ↘  render  ↗
```

- `formats`：纯函数，零业务概念，只认字节与格式。
- `rules`：把 INI 变成强类型领域模型，不含游戏循环。
- `sim`：确定性模拟，禁止触碰 DOM、WebGL、计时器、随机数（随机必须来自种子）。
- `render`：只读 `sim` 的状态，禁止写入。
- `app`：组装层，唯一允许接触浏览器 API 的地方。

## 确定性与可测性

- `sim` 里禁止 `Date.now()`、`Math.random()`、`performance.now()`；时间来自 tick 计数。
- 每个模块必须能脱离浏览器运行；测试在 Node 下跑。
- 单个函数 ≤ 40 行，单个文件 ≤ 300 行，超出就拆分。
- 纯逻辑与副作用分离：副作用集中在少数"驱动"函数里，其余为纯函数。

## 错误处理

- 解析层返回 `Result<T, ParseError>`，不抛异常跨模块边界。
- 只有"调用方无法继续"的情况才 `throw`，且必须是自定义错误类型。
- 禁止空 `catch`；捕获后必须记录或转换为返回值。

## 注释与文档

- 注释写"为什么"，不写"做了什么"；代码能表达的不要用注释重复。
- 每个包的 `README.md` 说明：是什么、怎么用、不覆盖什么。
- 逆向结论必须带证据：函数地址、字符串地址、伪代码文件路径，写进 `docs/ENGINE-MAP.md`。

## 提交与评审

- 提交信息用 Conventional Commits（`feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`chore:`）。
- 一个提交只做一件事；格式化与逻辑改动分开提交。
- 提交前必须本地通过 `npm run typecheck && npm run test && npm run lint`。
- 改到战场页的渲染或交互时，另外跑 `npm run test:ui`（需要玩家自备的原版档案，
  缺档时整批跳过）：它比对的是画面事实，`npm run test` 那批纯逻辑用例覆盖不到。

## 逆向取证：fastcall 参数识别不可靠

Ghidra 对 `__fastcall`/`__thiscall`（ECX/EDX 传参）的伪代码**寄存器-形参对应经常错位**，
尤其调用点与被调函数分属两处时（实例：fn-421710 调 0x47e2c0 的实参被显示成
`AnimType+0x2f0`，实际 Warhead 存于 `+0x2c8`——由字段解析实录纠正）。

**关键字段结论必须双源印证，缺一不可：**

1. **Read_INI 字段解析实录**（键名串 → xref → 解析函数 → `读值函数(键, 旧值) → 存偏移`
   模式，见 fn-70e470.c）——偏移语义的第一证据；
2. **汇编级实参对齐**（`procedure_assembly` 看调用点 ECX/EDX/栈布局，或被调函数头部
   取参指令）——运行时数据流证据。

反编译器伪代码只作线索，不得单独支撑"字段 X 存于偏移 Y"的结论。两层冲突时以
Read_INI 实录为准，汇编定运行时行为；冲突本身记进证据文件（勘误链）。

**实际战绩（2026-10-13 战斗线，两次同源纠错的案例指针）**：本注记当天回本两次——
① `AnimType+0x2f0` 被反编译 fastcall 混淆显示为 Warhead，键解析实录纠正为 +0x2c8
（后又被双源印证推翻为平行 schema，见下）；② 真解析器 fn-4258d3 的键表证明 `0x2c4`
是 ExpireAnim 而非 DamageRadius、`Warhead=→+0x2f0`。两次都因"键解析实录 > 反编译
寄存器推断"而避免硬编错误结论。证据文件：work/decompiled/ra2-engine/fn-4258d3.c、
combat-fireloop-notes.md「终九」节，ENGINE-MAP「爆炸伤害载体」勘误块。

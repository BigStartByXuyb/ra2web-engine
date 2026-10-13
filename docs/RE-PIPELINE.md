# 逆向流程

目标：从原版二进制里取出**可核对的行为依据**，供 `sim` 实现对照。产出伪代码与证据，不复刻实现细节。
动手前置要求见 `AGENTS.md`。

## 工具链

| 组件               | 版本              | 位置                                 |
| ------------------ | ----------------- | ------------------------------------ |
| REA（morluto/rea） | 6.4.0             | 全局 CLI `rea`；MCP 服务名同为 `rea` |
| Ghidra             | 12.1.4            | `work/tools/ghidra_12.1.4_PUBLIC`    |
| JDK                | Temurin 21.0.12.1 | `work/tools/jdk-21.0.12.1+1`         |

目标二进制：`work/assets/pack/GAME.EXE`（v1.006）。

环境变量：`GHIDRA_INSTALL_DIR` 指向 Ghidra 安装目录，`JAVA_HOME` 指向 JDK，`PATH` 需包含
`%JAVA_HOME%\bin`。MCP 注册的 `[mcp_servers.rea].env` 已带前两项；CLI 与 MCP 是同一份二进制、同一套提供方。

## 步骤

### 1. 总览与检索

```bash
rea analyze <GAME.EXE> --format md          # 段、函数数、字符串数
rea search <GAME.EXE> --pattern=<字符串>    # 字符串 → 地址
rea search <GAME.EXE> --kind=procedures --mode=regex --pattern='.*'   # 全量函数清单
```

### 2. 字符串 → 代码

`rea search` 只给字符串地址。要反查引用它的指令，用本仓工具（无需再次加载 Ghidra）：

```bash
tsx ../../work/soviet-hd/scripts/pe-xref.ts <GAME.EXE> 0x7dbb3c
```

注意 `PUSH imm32` 的立即数出现在操作码之后，指令起点要往前退一个字节。

### 3. 反编译单函数

```bash
rea function <GAME.EXE> <函数入口地址> --format md > fn-<addr>.md
```

产物含：伪代码、引用字符串、调用者/被调用者、基本块。

#### 补充：函数地址不在 Ghidra 函数表里（"No procedure exists"）

Ghidra 自动分析会漏掉只经虚表/间接调用进入的函数（实例：移动核心 `0x4a05f0`，两个函数表
条目之间的空洞）。用仓库里的脚本在已保存的 Ghidra 项目里建函数并直接反编译：

```bash
analyzeHeadless <projDir> ra2 -process GAME.EXE -noanalysis \
  -scriptPath <脚本目录> -postScript DecompileAt.java 0x<addr> <out.c>
```

脚本在 `tools/re/DecompileAt.java`（含调用者清单）。判断"函数起点"的办法：
先 `rea function` 报错拿不到伪代码 → 用调用点 xref 定位函数区间 → 十六进制查看区间找
`0x90` 填充后的序言（`83 EC .. 53 55 56` 一类）确定入口。

### 4. 全量函数表（含每个函数引用的字符串）

```bash
analyzeHeadless <projDir> ra2 -process GAME.EXE -noanalysis \
  -postScript DumpFunctions.java <out.tsv> -scriptPath <脚本目录>
```

脚本源码见 `work/decompiled/ghidra-scripts/DumpFunctions.java`（首次导入用 `-import`，之后用 `-process` 复用已保存项目）。

### 5. 分类（直接证据 + 调用图传播）

```bash
tsx tools/re/propagate-subsystems.ts <functions-detail.tsv> docs/engine/functions-by-subsystem.md
```

层级 0 是直接证据（字符串/外部导入名）；不引用字符串的函数按"被调用者属于调用者子系统"逐层传播补全，
并标注层级。传播只是**缩小复核范围**，写进实现前必须人工读伪代码确认。

## 产出位置

| 内容              | 路径                                              |
| ----------------- | ------------------------------------------------- |
| 引擎总览          | `work/decompiled/ra2-engine/overview.md`          |
| 全量函数清单      | `work/decompiled/ra2-engine/functions.csv`        |
| 函数 + 引用字符串 | `work/decompiled/ra2-engine/functions-detail.tsv` |
| 单函数伪代码      | `work/decompiled/ra2-engine/fn-<addr>.md`         |
| 分类结果（入仓）  | `docs/engine/functions-by-subsystem.md`           |

## 约束

- 伪代码只作为**行为依据**，不逐行翻译进 `sim`。
- 每条实现规则在代码注释里标注函数地址与证据文件，便于复核。
- 逆向产物不进 npm 包，不随发行版分发。

### 6. 静态字节解码（无 Ghidra 通道）

Ghidra/rea 因资源竞争、JDK 探测、快照失配等不可用时，INI 键名与字段偏移的机械核对
可直接在 PE 字节上完成——比反编译快，且零依赖：

**键名 → 偏移**：全 .text 扫「`push imm32`（imm 指向 .data 键串区 0x7cxxxx~0x80xxxx）→
`call 读值函数` → `mov/fstp [reg+disp32]`」，把每个目标偏移的存储点与其前 ≤0x100 字节内
最近一次键串 push 配对，即得键名（读值函数：bool=FUN_0050f410 / int=FUN_0050d7f0 /
float=FUN_0050e3a0 / 按名=FUN_0050e9a0）。注意：**call 不清除配对**（读值调用在 push 与
存储之间）；fstp（DD/D9 9x）= float/double 存储形态。

**偏移 → 写入者**：扫 `mov [reg+disp32], r`（89 mod=10）或 `mov [reg+disp32], imm`（C7）
定位写入点，用 functions-detail.tsv 映射所属函数；落在 gap 时用序言字节
（`55 8B EC` / `6A FF 68` SEH 型）向后猎函数入口。

实战战绩（2026-10-13 战斗线）：rules 7 键（C4Warhead/Gravity/MaxDamage/AllyReveal/
HunterSeekerDescentSpeed 等）一次性核完，未开 Ghidra；+0x2f0 写入者（真 AnimType 解析器
0x4258d3，SEH 序言猎取）亦由该通道发现。脚本示例见 work/decompiled/scan-*.ps1 与
会话沉淀的 python 配对扫描（可复用，见 combat-fireloop-notes.md 终十节）。

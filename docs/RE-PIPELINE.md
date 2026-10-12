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

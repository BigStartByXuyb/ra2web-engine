# 项目约定

《红色警戒 2》引擎的网页重实现工程。本文件是项目级硬性约束，与 `docs/CONVENTIONS.md`（编码规范）、
`docs/ARCHITECTURE.md`（依赖边界）并列；三者冲突时先改本文件再改代码。

## 先取证，再动手

任何改动动手前，先取到对口证据。证据只能来自原版：

1. REA 对原版 `GAME.EXE`（`work/assets/pack/GAME.EXE`）的分析结果：MCP 服务 `rea`，或同一二进制的 `rea` CLI；
2. 原版档案的真实字节：`work/assets/pack` 下的 `.mix` / `.ini` / `.pal` / `.shp` / `.vxl` 等；
3. 原版运行时的直接观测。

"对口"按改动对象判定：

| 改动对象                                                | 先取到的证据                                     |
| ------------------------------------------------------- | ------------------------------------------------ |
| 行为规则：单位、武器、指令、寻路、经济、生产、AI、时序  | 实现该行为的过程地址与伪代码                     |
| 数据格式：MIX / INI / CSF / SHP / VXL / HVA / TMP / MAP | 读取该格式的例程；字段顺序与语义由例程确定       |
| 素材与美术参数：调色板、帧序、朝向、锚点、图标          | 原版文件里的真实数据，加上决定这些参数的原版例程 |
| 前端与展示：`app`、渲染呈现、交互                       | 涉及"原版如何显示"的部分同上                     |

## 自定项必须标注

本项目自己的取舍（界面布局、配色、文案、工程结构）不需要原版证据，但必须在代码注释或提交信息里
写明"本项目自定"。没有地址的数值、时序、位置就是自定项，禁止写成"原版如此"。

## 取证怎么落

- 工具链、命令、产物路径：`docs/RE-PIPELINE.md`。
- 结论与证据的写法：`docs/CONVENTIONS.md` 的"注释与文档"、`docs/ARCHITECTURE.md` 的"与逆向产物的关系"。
- 取不到的项用 `record_unknown` 记进台账，不允许用猜测、相似实现或"常见做法"填。
- 同一份结论只取一次：先查 `docs/ENGINE-MAP.md` 与 `docs/engine/`，已有地址直接复用。
- 交付说明里列出本次用到的过程地址与证据文件。

## REA MCP

服务名 `rea`，注册在 `~/.codex/config.toml` 的 `[mcp_servers.rea]`，已带 Ghidra 提供方的
`GHIDRA_INSTALL_DIR` 与 `JAVA_HOME`。取证前先确认这两个口径为 `healthy`：

- `rea doctor --client codex --json`：注册是否对齐；
- `rea doctor --provider ghidra --json`：Ghidra 与 JDK 是否可用。

不带范围的 `rea doctor` 会连未配置的其它客户端和引擎一起审计，`healthy` 为 false 属正常，不据此改配置。

| 用途             | 工具                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 绑定目标与概览   | `open_binary`（`provider_id: "ghidra"`）、`binary_overview`、`binary_session`、`list_segments`                                               |
| 字符串与过程检索 | `search_strings`、`search_procedures`、`list_procedures`、`xrefs`                                                                            |
| 读某个过程       | `procedure_pseudo_code`、`procedure_assembly`、`procedure_callers`、`procedure_callees`、`read_function_instructions`                        |
| 追调用与数据流   | `resolve_native_call_targets`、`trace_native_values`、`trace_call_path`、`get_call_graph`                                                    |
| 原版字节与地址   | `read_bytes`、`address_to_file_offset`                                                                                                       |
| 证据台账         | `record_unknown`、`list_unknowns`、`verify_unknown_resolution`、`build_reconstruction_obligation_ledger`、`evaluate_reconstruction_coverage` |

会话里看不到 REA 工具（新注册未重启、注册漂移、提供方失效）时，先修注册再取证，不要降级成猜测。
与证据无关的工作（仓库分析、重构、跑测试）照常做，交付说明里写明被阻断的取证项。

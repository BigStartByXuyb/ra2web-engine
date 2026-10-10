# 引擎地图（逆向证据）

目标二进制：原版《红色警戒 2》`GAME.EXE`（v1.006），
sha256 `fe67fdac5073530a79baec14c4e072b5e7e4c0c462cee9659870c5330e9e6e3e`，PE / x86。

证据目录：`work/decompiled/ra2-engine/`（总览、函数清单、单函数伪代码）。

## 规模

| 项目                 | 数值                                   |
| -------------------- | -------------------------------------- |
| 函数                 | 8442                                   |
| 字符串（Ghida 识别） | 7724                                   |
| `.text`              | 3,772,416 字节（VA 0x401000–0x79a000） |
| `.data`              | 3,553,732 字节（VA 0x7c9000–0xb2c9c4） |

## 锚点字符串按子系统统计

| 子系统                          | 唯一字符串数 |
| ------------------------------- | ------------ |
| 美术素材（SHP/VXL/HVA/TMP/PAL） | 183          |
| 联机/网络（socket/收发包）      | 301          |
| INI / 规则                      | 50           |
| MIX 档案                        | 40           |
| 音频                            | 17           |
| 回放 / 存档                     | 3            |

## 已读出的函数

### `FUN_005129c0` — 规则集加载（VA 0x5129c0–0x513070，1713 字节）

证据：`work/decompiled/ra2-engine/fn-512cac.md`（伪代码 + 引用 + 调用关系）。

行为：枚举 `RULE*.INI` → 逐个加载 → 再加载 `RULES.INI`、`ART.INI`、`LANGRULE.INI`、`AI.INI`；
失败时用 `DialogBoxParamA` 弹窗报错。

| 字符串                    | 地址     | 引用指令            |
| ------------------------- | -------- | ------------------- |
| `RULE*.INI`               | 0x7dbb6c | 0x5129e7            |
| `RULES.INI`               | 0x7dbb60 | 0x512a73 / 0x512b88 |
| `ART.INI`                 | 0x7dbb58 | 0x512c83            |
| `Failed to load ART.INI!` | 0x7dbb3c | 0x512cac            |
| `LANGRULE.INI`            | 0x7dbb2c | 0x512d8c            |
| `AI.INI`                  | 0x7dbb24 | 0x512f98            |

关键调用：`KERNEL32.FindFirstFileA / FindNextFileA / FindClose`、`USER32.DialogBoxParamA`、
内部 `FUN_0051ad50`（INI 对象构造，对象大小 0x50）、`FUN_004696b0`（容器构造）、
`FUN_00783290`（数组插入搬移）。调用方为 `FUN_005116a0`。

**对实现的意义**：这是全部单位数值的入口。`packages/rules` 的加载顺序必须与之一致
（先 `RULE*.INI`、后 `RULES.INI`、再 `ART.INI`/`LANGRULE.INI`/`AI.INI`），
这样 MOD 的覆盖语义才与原版相同。

## 待分类（下一步）

已完成第一遍粗分类，见 [engine/functions-by-subsystem.md](engine/functions-by-subsystem.md)：

| 子系统       | 函数数 |
| ------------ | ------ |
| 联机 / 网络  | 263    |
| 存档 / 回放  | 49     |
| INI / 规则   | 45     |
| 美术素材     | 53     |
| 界面         | 31     |
| 渲染 / 显示  | 26     |
| 地图         | 13     |
| MIX 档案     | 12     |
| 音频         | 5      |
| 未命中关键词 | 7643   |

分类依据是函数内引用的字符串与外部导入名，属**粗分类**：7643 个未命中的函数不引用字符串，
需要靠调用图从已分类锚点向外传播，再人工阅读确认。

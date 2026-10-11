# RA2 Web Engine

以网页前端为目标的《命令与征服：红色警戒 2》引擎重实现工程。数据来源为玩家自备的正版游戏文件；
本项目不分发任何 EA 版权素材。

## 目标

1. 用 TypeScript 重实现红警 2 的**模拟核心**（单位、指令、寻路、经济、AI 接口），行为以原版
   `GAME.EXE`（v1.006）为准，逐条对照验证。
2. 提供**网页前端**：浏览器里直接开局、操作、对战，不需要安装任何东西。
3. 兼容原版数据：`.mix` / `.ini` / `.csf` / `.shp` / `.vxl` / `.hva` / `.tmp` / `.map`，
   以及基于这些数据格式的社区 MOD（含共和国之辉这类数据型 MOD）。

## 非目标

- 不复刻原版二进制的实现细节（寄存器、内存布局、编译器产物），只复刻**行为**。
- 不分发游戏素材；运行需要用户自备原版文件。
- 不做官方渠道的发布承诺（红警 2 知识产权属 EA）。

## 当前阶段

**P0 — 逆向与数据层**。已完成：原版 `GAME.EXE` 进入 Ghidra（8442 个函数、7724 个字符串），
INI 加载例程已读出并归档。进行中：函数清单分类、数据格式读取库。

阶段划分与验收标准见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## 工程约定

- 编码规范：[docs/CONVENTIONS.md](docs/CONVENTIONS.md)
- 架构与依赖边界：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 逆向流程与产物：[docs/RE-PIPELINE.md](docs/RE-PIPELINE.md)
- 引擎地图（已读出的子系统）：[docs/ENGINE-MAP.md](docs/ENGINE-MAP.md)

## 快速开始

```bash
npm install
npm run typecheck
npm run test
npm run test:ui   # 战场页 UI 用例：需要原版档案，缺档时整批跳过
npm run build
```

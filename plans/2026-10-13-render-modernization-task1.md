# 渲染现代化线 任务 1：WebGL2 探测 + 离屏 pass 链骨架 实施计划

> REQUIRED SUB-SKILL: superpowers:executing-plans。

**Goal:** 建成离屏渲染骨架（FBO 双缓冲 + 全屏 pass 链，WebGL2 主路径 / WebGL1 回退），并交付能力探测工具与报告——后续任务 2（后处理栈+AA）、4（阴影）、5（SSAO）全部挂在这条链上；骨架以"拷贝 pass"首验：`?pipeline=1` 画面与默认直绘路径**逐像素一致**。

**Spec:** `docs/RENDER-ROADMAP.md` 任务 1（经建议扩展为"探测+骨架"；建议内容见交接说明，待总工点头后按此执行，探测部分不涉接缝先行）。

## 探测结果（2026-10-13，tools/webgl2-probe.ts，Chromium headless/SwiftShader）

| 能力 | WebGL2 | WebGL1 回退 |
| --- | --- | --- |
| 上下文 | ✓ GLSL ES 3.00 | ✓ GLSL ES 1.00 |
| 离屏 RT | 原生 FBO + `EXT_color_buffer_float`✓ + `EXT_color_buffer_half_float`✓ | FBO + `WEBGL_depth_texture`✓ |
| HDR 后处理 | RGBA16F RT + `OES_texture_float_linear`✓ | 退 RGBA8（LDR 近似） |
| 多采样 | `MAX_SAMPLES=4`（自建 MSAA resolve 可行） | 无 FBO MSAA，退画布级 MSAA |
| 各向异性 | ✓ 上限 16 | ✓ 上限 16 |
| 深度预pass（阴影/SSAO 用） | 原生深度纹理 | `WEBGL_depth_texture`✓ |

注：headless 为 SwiftShader 软渲染，真机 GPU 的 MAX_SAMPLES/性能须在总工预览机复测（工具需入库供随时复跑）。

## 骨架设计（本项目自定）

新模块 `packages/app/src/game/render-pipeline.ts`（**不动现有文件**，接线放任务 1b 接缝批）：

- `createRenderPipeline(gl, canvas)` → 探测代际（gl2 prefers）→ 建 **主 RT 池**（RGBA16F/8 + 可选深度、尺寸 = 画布）+ **ping-pong 双缓冲**；
- `pipeline.begin()` / `pipeline.pass(fragmentShader, uniforms)` / `pipeline.composite()` 三段式：当前任务只挂一个 **拷贝 pass**（把场景 RT 画回 canvas，含预乘 alpha 语义）；
- 尺寸自适应（resize 重建 RT）；`dispose()`；
- 纯逻辑部分（RT 尺寸计算、双缓冲切换、pass 描述校验）与 GL 调用分离，可单测。

## 任务分解

- **Task 0（无接缝，先做）**：`tools/webgl2-probe.ts` 入库 + `plans/` 报告（已跑）。单测不适用，验收=工具可复跑。
- **Task 1（无接缝）**：`render-pipeline.ts` 骨架 + 单测（纯逻辑：RT 尺寸/双缓冲/pass 校验）。
- **Task 1b（接缝，需总工批）**：接线——`webgl-tile-layer` 场景绘到离屏 RT（`?pipeline=1` 时），`draw.ts` 走 `pipeline.composite()`；默认缺省路径直绘不变。**验收红线：`?pipeline=1` 与默认路径逐像素一致（复用现有 UI 逐像素用例机制加一条）**。
- **Task 2（接缝，同批报）**：质量档「现代」口径落地（新增档位承载新栈；散装 ?开关 仅调试）——与任务 2 交付合并。

## 纪律

继承全线：默认路径零影响、UI 用例、黄金哈希零变更、共用文件先批、不 push。接缝报批因跨会话通道暂停（防循环保护）暂缓，恢复后立即发总工。

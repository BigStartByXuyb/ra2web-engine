# 地貌线任务 4：地貌细节（车辙/踩痕/污渍）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 `- [ ]` 跟踪。

**Goal:** terrain3d 模式下地面出现随单位行进而累积的车辙/雪地踩痕（痕迹缓冲贴花层）与静态程序化污渍；全部为**本项目自定**观感并逐处标注；默认路径与既有确定性用例零影响。

**Architecture:** 痕迹缓冲 = 一张"每格 4px"的 RGBA canvas 覆盖全图（世界坐标线性映射）；每帧把可见单位位置以软刷盖入（dirty 时才 texImage2D 上传）；地形片元着色器按世界坐标采样该纹理，痕迹处按材质压暗（雪地踩痕 = 更明显的压暗+边缘提亮，自定）；污渍 = 着色器内低频值噪声乘性暗斑（静态、无缓冲）。痕迹由"单位位置流"驱动，基线用例（无单位）逐像素不受影响。

**Spec:** `docs/TERRAIN-ROADMAP.md` 任务范围 4「地貌细节（后置）：地面污渍/车辙类贴花、雪地踩痕——全部自定项标注」。

**无新接缝**：全在 `packages/app/src/game/` 本线模块 + 自有顶点/纹理格式。总工已批开工（2026-10-13）。

## Review Focus

1. **基线零影响**：无单位/地图预览场景 decals 层为空白纹理，采样乘性因子恒 1 → 全量 UI 既有用例（含逐像素对）不受影响；
2. **痕迹单调积累**：同一位置重复盖章只增强不衰减，缓冲值 clamp 到 1（单测钉）；
3. **坐标换算**：世界坐标 → 缓冲 UV 正确（worldX∈[minX,maxX] 线性映射，越界丢弃不崩）；单测钉四角与中心；
4. **上传节流**：无 stamp 的帧不 texImage2D（走查 + dirty 标志单测）；
5. **开关**：`?decals=0` 关掉痕迹与污渍（自定开关，默认开）；关闭时着色器分支不采样。

---

### Task 0: 痕迹缓冲（纯逻辑，TDD）

**Files:**
- Create: `packages/app/src/game/terrain3d-decals.ts`
- Test: `packages/app/test/terrain3d-decals.test.ts`

**Interfaces:**
- Produces:
  - `interface DecalBufferOptions { readonly minX: number; readonly minY: number; readonly width: number; readonly height: number; readonly pixelsPerCell: number }`
  - `createDecalBuffer(options, stampPixels: (px: number, py: number, radius: number, strength: number) => void): DecalBuffer`——**纯逻辑**（不碰 DOM）：坐标换算 + 盖章中心/半径/强度计算 + clamp；实际像素写入通过注入的 `stampPixels` 回调（生产实现画到 canvas，测试传数组记录）。
  - `DecalBuffer.stampWorld(worldX: number, worldY: number): boolean`——世界坐标盖一枚软痕（半径 = 1.6 格 × pixelsPerCell，强度 0.35）；返回是否真的盖了（越界 false）。
  - `DecalBuffer.dirty` 读属性（有未上传的盖章）。
  - `DecalBuffer.takeDirty(): boolean`——读并清（渲染器每帧问它决定是否上传）。

- [ ] TDD：坐标换算（四角/中心 → 期望像素坐标）、越界返回 false 不调 stampPixels、连续盖章 dirty 状态与 takeDirty 清位 → RED → 实现 → GREEN → 全量 → Commit。

### Task 1: 渲染器接线（痕迹纹理 + 污渍 + 开关）

**Files:**
- Modify: `packages/app/src/game/webgl-terrain3d.ts`（decals canvas→纹理、uniform、着色器痕迹/污渍分支、render 增加 stamps 参数）
- Modify: `packages/app/src/game/draw.ts`（把可见单位世界坐标传给 render；`?decals=0` 透传）

**Interfaces:**
- Produces:
  - `Terrain3dScene.render(camera, w, h, waterFrame?, stamps?: readonly { x: number; y: number }[])`——append 参数；stamps 为空/缺省时零开销。
  - `createTerrain3dScene(..., decalsEnabled?: boolean)`——append 参数（缺省 true）。
- 着色器：`uniform sampler2D u_decals; uniform vec2 u_decalOrigin; uniform vec2 u_decalScale; uniform float u_decalsOn;`
  - 痕迹：`vec2 duv = (v_world - u_decalOrigin) / u_decalScale; float track = u_decalsOn * texture2D(u_decals, duv).a * step(0.0, duv.x) * step(duv.x, 1.0) * step(0.0, duv.y) * step(duv.y, 1.0); albedo *= mix(1.0, 0.80, track);`
  - 污渍：`float stain = valueNoise(v_world * 0.013); albedo *= mix(1.0, 0.90 + 0.10 * stain, u_decalsOn);`
  - 分支与自定标注齐全。

- [ ] 实现 → `app:build` + 全量单测 → 手动核对基线用例不受影响（跑 test:ui）→ Commit。

### Task 2: UI 用例 + 整线总结与汇报

**Files:**
- Modify: `tests/ui/cases.ts`

- [ ] 用例：开战 + 移动指令后，`decals=1` 与 `decals=0` 两页在同"移动完成"信号后截屏，差异 ≥ 阈值（痕迹上屏）；同一页两次连拍在 anim=0 下允许差异（单位仍在走）——不断言确定性，只断言"痕迹开关确实改变画面"。
- [ ] 全量 `app:build`→`test`→`test:ui` 绿；并排图（痕迹特写：单位走过后的地面）。
- [ ] **整线总结**（总工要求）：4 任务回顾（提交清单/验收状态）+ 全部自定项清单（zStep 试算、PBR 参数表、噪声/岩理/湿边/波纹/痕迹/污渍具体项）+ 待核台账汇总（unk_3a77f19a zStep、RAMP_HEIGHTS 参考口径、cliffBackImpassability 归引擎线）→ 发总工，供其对用户整线验收。

# 地貌线任务 3：水面 PBR 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 `- [ ]` 跟踪。

**Goal:** terrain3d 模式下水面走 PBR 材质（低粗糙度高光 + 帧号驱动的波纹 + 复用湿地倒影参数），原版 Water01..14 帧动画的**逐帧播放机制与帧号口径完全保持**（`waterFrameAt` 同一处），默认路径一个像素不变。

**Architecture:** 水格与陆地格在同一地形 pass 内用顶点标记区分（新增 `waterFlag` 顶点通道）；14 帧水色表在**装图时**从 WaterSet 各地块真实像素采样一次（证据），每帧只把当前帧色作为 uniform 传入（WebGL1 片元不能动态索引 uniform 数组，逐帧查表在 CPU 侧）；波纹相位由当前帧号驱动 —— 帧不动画面即逐像素静止（天然满足「关动画静止」UI 口径）；水面反射复用现有物体倒影 pass（`WET_REFLECTION` 参数，水格上压着的正是它们）。

**Spec:** `docs/TERRAIN-ROADMAP.md` 任务范围 3。总工要求：①帧动画逐帧口径保持（UI 用例盯）；②复用湿地倒影 pass 参数；③skip 纪律。

**无新接缝**：全部改动在 `packages/app/src/game/`（terrain3d 系列 + draw.ts 自加闭包）与我自己的顶点格式内；不动 webgl-tile-layer / assets / render / sim。

## Review Focus

1. **关动画必须逐像素静止**：`?anim=0` 时波纹相位恒定（帧号 0），terrain3d 两次截图差异 0；
2. **开动画必须真的在动**：`?anim=1` 连拍两帧画面变化 ≥ 阈值（镜像现有「水面在动」用例判据）；
3. **非水格不受帧号影响**：帧 uniform 只作用于 waterFlag>0.5 的片元——陆地格两次不同帧号必须逐像素一致；
4. **水色表来自原版像素**：每帧色 = 该帧地块（WaterSet start+frame）子块像素 + 剧场调色板采样；帧数与 WaterSet `TilesInSet` 一致；
5. **缺 WaterSet/缺图的图不崩**：`preview.water === undefined` 或帧地块缺图时该帧用上一有效帧/兜底 Water 采样色。

---

### Task 0: 帧色表采样（纯函数，TDD）

**Files:**
- Modify: `packages/app/src/game/terrain3d-materials.ts`（新增 `waterFrameAlbedos`）
- Test: `packages/app/test/terrain3d-materials.test.ts`

**Interfaces:**
- Produces:
  - `interface WaterFrameInput { readonly pixelIndices: Uint8Array }`
  - `waterFrameAlbedos(frames: readonly WaterFrameInput[], palette: Palette): readonly (readonly [number, number, number])[]`——每帧一个 0..1 三元组；空像素的帧跳过（返回 `undefined` 占位），全空返回空表。

- [ ] TDD：写失败测试（3 帧不同像素 → 3 色；透明 0 不计；空帧占位 undefined）→ RED → 实现 → GREEN → 全量 → Commit。

### Task 1: 水格标记 + 渲染器水面色/波纹（STRIDE 12→13）

**Files:**
- Modify: `packages/app/src/game/terrain3d-geometry.ts`（顶点加 `waterFlag`：`landTypeAt==='Water'` 的格 1，其余 0）
- Modify: `packages/app/src/game/webgl-terrain3d.ts`（着色器水面分支；`render` 增加帧号参数；场景工厂采样水色表）
- Test: `packages/app/test/terrain3d-geometry.test.ts`

**Interfaces:**
- Consumes: `waterFrameAlbedos`（Task 0）；`waterTileRange`/`waterFrameAt` 口径（`water-animation.ts` 不动）。
- Produces:
  - `Terrain3dScene.render(camera, viewportWidth, viewportHeight, waterFrame?: number)`——帧号 append 参数，缺省 0（静止）。
  - 顶点交错 13 float（append `waterFlag`）。
  - 着色器：`waterFlag>0.5` 的片元——基色 = `u_waterColor`（当前帧色），法线按帧号驱动的波纹扰动（两次正弦叠加，相位 = 帧号 × 0.9），菲涅尔边缘提亮 + 低粗糙度高光；水色表为空时回落静态 Water 采样色。

- [ ] TDD：geometry 用水格断言 waterFlag（水 1 / 陆 0）→ RED → 实现 → GREEN。
- [ ] 渲染器 + 场景工厂（采样：`preview.water` 的 start+frame 逐帧过 `theater.loadTile(...)` 取子块像素；缺帧用前一帧）→ 全量 → Commit。

### Task 2: 帧号接线（draw.ts）

**Files:**
- Modify: `packages/app/src/game/draw.ts`（`drawGround` 闭包传 `scene.waterFrame ?? 0`）

- [ ] 改一行闭包传参 → `npm run app:build` + 全量 → Commit。

### Task 3: UI 用例（水在动 / 关动画静止，terrain3d 专属）+ 汇报

**Files:**
- Modify: `tests/ui/cases.ts`

- [ ] 追加两用例（沿用「水面在动」的 snapshot 连拍手法）：`terrain3d=1&anim=1` 300ms 内变化 ≥ 阈值；`terrain3d=1&anim=0` 变化 === 0。
- [ ] 全量 `app:build`→`test`→`test:ui` 绿（新增用例先 skip 后解开，遵门禁纪律）。
- [ ] 同机位并排图（水域图：Maps01 index 0，1097 水格）+ 汇报四要素发总工；更新记忆。

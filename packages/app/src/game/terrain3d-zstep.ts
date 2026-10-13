/**
 * 一级高度折多少像素（screenY 里 z 的系数）——**试算值待核**。
 *
 * 取证现状（2026-10-13）：未闭合。`0x8529d0`（=90 lepton/级）的读者全在移动引擎
 * （FUN_004a1000 / FUN_004a2670，显示侧不读它）；.text 对浮点 30/256、60/256、15/256
 * 零引用（全节区字节扫描，工具 work/decompiled/scan-float.ps1，本项目自定）。
 * 台账 `unk_3a77f19a21db32fd217ecd87d06ed70f806e54b51e0918ccbdf3b5055127b84c`，
 * 证据 `work/decompiled/ra2-engine/zstep-lepton-to-pixel.md`、`docs/ENGINE-MAP.md`「地貌线：一级高度折像素」。
 *
 * 取 90 × 30/256 = 10.546875 px/级：与 ENGINE-MAP 原有两个候选中的第一个同口径，
 * 整数形态 (z×30)>>8 与浮点同值；另一候选 12.245（104.5 口径）差 1.16 倍。
 * 引擎线的坡度俯仰若要用此值，先确认台账是否已闭合。
 */
export const TERRAIN_Z_STEP_PX = 10.546875

# 战斗线阶段 3 结项报告（弹道链）

2026-10-14，战斗线。范围：阶段 3「弹道 Projectile」（COMBAT-ROADMAP 任务序第 3 项）+
阶段 2 收尾（Verses 应用侧）。**结论：弹道链取证全部定案，sim 侧可落部分全部落地，
余两项低优细枝 + 一处"最后一米"接手位点。**

## 一、链路终版（全有址，证据 = work/decompiled/ra2-engine/fn-*.c）

```
判定：Get_Weapon(虚槽231/+0x39C→0x44d980) → In_Range(0x6c4bb0) → 瞄准角(虚槽+0x2A8→0x43b7e0
      =0x47f8b0/0x47f9b0：距离/高差/重力→16位角，无弹速) → Should_Target(0x6c5570)
执行：0x4bcd50 直击链 / 0x6ca890 多炮塔开火（火力门控 type+0x105/106/109/10c）
弹体：BulletClass ctor 0x7213a0（0x208B，vtable 0x7aecd0）→ 发射初始化 0x4616b0
      （起点快照 + 散布定终点 r=RNG(0,scatter×2)×dist/WeaponType.Range）
      → 移动组件 0x499a90 注册进全局移动系统（DAT_00852578）
      → 每帧判定 0x461c10（时间耗尽/遮挡/地形接触）→ 引爆 0x462110 → AoE 0x47e2c0
成因：散布=BallisticScatter（rules+0x139c，fn-6ca890 分支B/0x4616b0 双实现解码）；
      爆炸载体=Anim（AnimType{Warhead+0x2f0/DamageRadius+0x2f4/Damage+0x270}）
类型：BulletTypeClass::Read_INI=0x70e470（Warhead=+0x2c8/DamageRadius=+0x2c4/Normalized+0x264/
      Elasticity/MinZVel+0x26c/StopSound+0x2ac…）
```

## 二、sim 落地对照（packages/sim）

| 模块 | 内容 | 证据状态 |
| --- | --- | --- |
| `combat.ts` | Verses 修正 / In_Range / 爆炸承载（ExplosionAnim）| 全部原版口径 |
| `bullet.ts` | 抛射角（标准式=**自定**）/ ROM 转写（封存勿用）/ scatterShot / 常量 | 散布与常量原版口径；抛射角自定 |

测试：sim 全套 13 项绿（combat 5 + bullet 8）。**tick 集成等合龙窗口**（总工排期，
等引擎线炮塔双 FacingClass 就绪）。

## 三、开放项（终版 2+1）

1. **散布分支 A 变体**（低优）：fn-6ca890:196 的 `RNG(scatter/2,scatter)` 分流 +
   四 flag（+0x272/0x26b/0x273/0x26e）精确语义——两分支都已见公式，缺分流判别式。
2. **+0x9c/+0xa0 派生值**（低优）：无键串可配对。
3. **弹体运动"最后一米"**（接手位点）：全局移动系统 DAT_00852578 的**移动类型条目枚举 +
   各类型算法**（匀直/弧线/下坠类）——确定"哪种武器用哪种运动"。**与 sim 的"发射描述"
   接口正交**，不阻塞合龙；建议排给合龙后的下一自然轮。

## 四、各线可接手位点

- **引擎线**：可消费 `bullet.ts` 的 scatterShot/常量做 shell 演出（瞄准角+插值+散布终点）；
  移动系统对齐（引擎线 locomotion 与 DAT_00852578 类型表的对应）。
- **战斗线后续（阶段 4 结算）**：距离衰减 fn-47e1c0（×Warhead+0x12c、cap rules+0x1330）+
  取整时点 + AoE 半径筛选（fn-47e2c0 的 CellSpread 判定链）——证据已有大半。
- **任何线**：全部证据在 `work/decompiled/ra2-engine/`（notes 终十一~十八 = 弹道战役全程），
  台账在 ENGINE-MAP「武器链终版全图」节。

## 五、本阶段提交一览

720a50c/6ca82bf（判定链）→ 305f412/6dc205b（Anim 键图）→ 3e1e69e（combat.ts）→
1888681（shell 落定）→ c58e787/b4e6ed1（bullet.ts+全图）→ 517d939（散布）→
6356bbf/be869e3（参数化）→ 087cab8/a8ef451（瞄准角+非积分定案）。

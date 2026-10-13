/**
 * 最小规则夹具：只包含演示与测试需要的字段，**不是**原版数据文件。
 *
 * 目的：浏览器拿不到玩家本机的游戏文件，用这份夹具证明"单位数值来自 INI"这条链路是通的。
 * 真实数值走 `npm run vanilla:scene`（从玩家自备的 RA2.MIX 里读 rules.ini）。
 */
export const FIXTURE_RULES_INI = `
; 武器与弹头（**合成数值**，与文件头"固定值非原版"同口径；字段名与解析口径照原版）
[120mm]
Damage=90
ROF=60
Range=5.75
Projectile=Cannon
Warhead=AP

[AP]
Verses=100%,100%,100%,100%,75%,50%,100%,100%,50%,25%,100%
CellSpread=0.5

[HTNK]
UIName=Name:HTNK
Name=Rhino Heavy Tank
Image=HTNK
Category=AFV
Strength=400
Armor=heavy
Speed=6
ROT=5
Sight=8
Cost=900
TechLevel=2
Primary=120mm
Turret=yes
Owner=Russians,Confederation,Africans,Arabs
Prerequisite=NAWEAP

[SMCV]
UIName=Name:SMCV
Name=Soviet MCV
Category=Support
Strength=1000
Armor=heavy
Speed=4
Sight=6
Cost=2500
TechLevel=1
Turret=no
Owner=Russians
`

"""基地车（SMCV）的参数化形状。共用件在 `unit_build.py`，契约在 `docs/ENGINE-UNIT3D.md`。

用法：
    blender.exe -b -P tools/blender/build-unit-mcv.py -- <参考模型.glb> <输出.glb>

形体照原版体素的高度分带定（参考 75×35×23.7）：

- 0..7.4：底盘 + 六对车轮（车头前轮、车尾后轮），轮子外缘顶到全宽；
- 7.4..13.4：车头驾驶舱（前脸斜切、挡风玻璃、顶灯）＋ 中段机身；
- 13.4..21.2：**折叠起来的基地结构**：下段、上段两层带收分，外侧压红板、顶上压红甲板；
- 21.2..23.7：回转底座（圆）+ 桅杆，这是全车最高点。
"""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from unit_build import (  # noqa: E402
    add_box,
    add_cylinder,
    finish_and_export,
    make_material,
    parse_args,
    reference_size,
)

reference_glb, out_glb = parse_args(
    "[建车] 用法：blender.exe -b -P tools/blender/build-unit-mcv.py -- <参考.glb> <输出.glb>"
)
reference_low, reference_high = reference_size(reference_glb)

armor = make_material("Armor", (0.30, 0.33, 0.28), 0.90, 0.44)
armor_light = make_material("ArmorLight", (0.40, 0.43, 0.37), 0.85, 0.38)
bare_metal = make_material("BareMetal", (0.56, 0.57, 0.59), 1.00, 0.26)
rubber = make_material("Rubber", (0.09, 0.09, 0.10), 0.20, 0.85)
glass = make_material("Glass", (0.09, 0.12, 0.15), 0.30, 0.10)
optic = make_material("Optic", (0.85, 0.90, 0.72), 0.10, 0.12, emission=1.2)
accent = make_material("Accent", (0.62, 0.09, 0.08), 0.30, 0.55)

"""—— 纵向基准（照原版体素分带）——"""
chassis_bottom, chassis_top = 1.0, 7.4
conyard_base_top, conyard_top = 17.6, 21.2
body_half = 14.4

"""—— 底盘 ——"""
add_box("Chassis", (-1.0, 0.0, (chassis_bottom + chassis_top) / 2), (72.0, body_half * 2 - 1.2, chassis_top - chassis_bottom), armor, bevel=0.5)
add_box("Bumper", (37.0, 0.0, 5.0), (2.0, body_half * 2 - 1.4, 5.6), armor_light, bevel=0.4)
add_box("RearPlate", (-36.4, 0.0, 5.4), (1.6, body_half * 2 - 1.4, 6.4), armor, bevel=0.4)

"""—— 六对车轮（外缘顶到全宽）——"""
for side in (-1, 1):
    tag = "LR"[side > 0]
    for index in range(6):
        wheel_x = -28.0 + index * 11.6
        add_cylinder(f"Wheel{tag}{index}", (wheel_x, side * 15.4, 2.9), 2.9, 3.6, rubber, axis="Y", vertices=24)
        add_cylinder(f"Hub{tag}{index}", (wheel_x, side * 15.4, 2.9), 1.25, 3.9, bare_metal, axis="Y", vertices=16)
        add_box(f"Arch{tag}{index}", (wheel_x, side * (body_half - 0.9), 5.2), (5.4, 1.8, 2.6), armor, bevel=0.2)
        add_box(f"Bogie{tag}{index}", (wheel_x, side * 13.0, 3.4), (2.2, 2.4, 1.6), armor_light, bevel=0.15)

"""—— 车头驾驶舱 ——"""
add_box("Cab", (25.3, 0.0, 10.2), (23.6, 26.4, 5.6), armor, bevel=0.55)
add_box("CabRoof", (24.0, 0.0, 13.4), (20.0, 24.4, 0.9), armor_light, bevel=0.2)
# 挡风板贴在驾驶舱前脸之前 0.1，不做成与舱面共面的薄片（共面会互相遮挡成黑带）
add_box("Windshield", (37.4, 0.0, 10.6), (0.6, 22.0, 3.4), glass, bevel=0.12, rotation=(0, -0.22, 0))
add_box("HoodGrille", (32.0, 0.0, 13.6), (8.0, 22.0, 0.5), bare_metal)
for index in range(4):
    add_box(f"HoodSlat{index}", (29.4 + index * 1.7, 0.0, 13.9), (0.5, 21.0, 0.4), bare_metal)
for side in (-1, 1):
    add_cylinder(f"Headlamp{'LR'[side > 0]}", (36.9, side * 11.6, 8.2), 0.9, 0.8, optic, axis="X")
add_box("LightBar", (24.0, 0.0, 14.2), (3.2, 20.0, 0.7), optic, bevel=0.1)
add_cylinder("ExhaustStackL", (-30.0, -12.4, 10.6), 1.0, 6.4, bare_metal, axis="Z")
add_cylinder("ExhaustStackR", (-30.0, 12.4, 10.6), 1.0, 6.4, bare_metal, axis="Z")

"""—— 中段机身（只在折叠基地与驾驶舱之间那一截，避免与基地结构侧面共面）——"""
add_box("BodyFront", (15.0, 0.0, 10.4), (11.0, body_half * 2 - 0.4, 6.0), armor, bevel=0.45)
for side in (-1, 1):
    tag = "LR"[side > 0]
    add_box(f"ToolBox{tag}", (-14.0, side * (body_half + 0.5), 12.6), (10.0, 0.9, 1.8), bare_metal)
    for index in range(3):
        add_box(f"Step{tag}{index}", (8.0 - index * 3.2, side * (body_half + 0.4), 5.0), (2.4, 0.8, 0.6), bare_metal)

"""—— 折叠的基地结构：下段 + 上段 + 红甲板 + 红侧板 + 加强肋 ——"""
add_box("ConyardBase", (-10.0, 0.0, (chassis_top + conyard_base_top) / 2), (44.0, body_half * 2, conyard_base_top - chassis_top), armor, bevel=0.5)
add_box("ConyardUpper", (-10.0, 0.0, (conyard_base_top + conyard_top) / 2), (40.0, body_half * 2 - 2.4, conyard_top - conyard_base_top), armor_light, bevel=0.45)
add_box("ConyardDeck", (-11.0, 0.0, conyard_top + 0.35), (26.0, body_half * 2 - 5.6, 0.7), accent, bevel=0.15)
for side in (-1, 1):
    tag = "LR"[side > 0]
    add_box(f"ConyardPanel{tag}", (-12.0, side * (body_half + 0.1), 15.5), (24.0, 0.5, 3.0), accent)
    add_box(f"ConyardRail{tag}", (-10.0, side * (body_half - 1.4), conyard_top + 0.9), (36.0, 0.9, 0.5), bare_metal)
for index in range(5):
    add_box(f"Rib{index}", (-28.0 + index * 8.0, 0.0, conyard_top + 0.85), (0.9, body_half * 2 - 2.0, 0.6), bare_metal)

"""—— 回转底座 + 桅杆（全车最高点）——"""
add_cylinder("Turntable", (7.0, 0.0, conyard_top + 1.1), 5.4, 1.6, armor, vertices=24, bevel=0.25)
add_cylinder("TurntableRing", (7.0, 0.0, conyard_top + 2.0), 5.8, 0.5, bare_metal, vertices=24)
add_box("TurntableCab", (7.0, 0.0, conyard_top + 1.8), (6.0, 7.0, 2.0), armor_light, bevel=0.3)
add_box("Mast", (-2.0, 0.0, 22.8), (8.0, 9.2, 1.8), armor, bevel=0.25)
add_box("MastTip", (-2.0, 0.0, 23.6), (5.0, 5.4, 0.6), bare_metal, bevel=0.1)
for index, offset in enumerate((-3.0, 3.0)):
    add_cylinder(f"MastRod{index}", (-2.0, offset, 22.6), 0.2, 2.0, bare_metal, axis="Z", vertices=8)

"""—— 尾部细节：油桶、挂钩、警示灯 ——"""
for index, offset in enumerate((-8.0, 8.0)):
    add_cylinder(f"Drum{index}", (-33.0, offset, 14.2), 2.0, 5.6, bare_metal, axis="X", vertices=16)
add_box("TowHook", (-36.0, 0.0, 3.4), (1.4, 6.0, 2.4), bare_metal, bevel=0.2)
add_box("BeaconL", (-24.0, -13.2, 14.6), (1.2, 1.2, 0.8), optic, bevel=0.1)
add_box("BeaconR", (-24.0, 13.2, 14.6), (1.2, 1.2, 0.8), optic, bevel=0.1)

sys.exit(finish_and_export(out_glb, reference_low, reference_high))

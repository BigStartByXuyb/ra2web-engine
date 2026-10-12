"""基地车（SMCV）的参数化形状。共用件在 `unit_build.py`，契约在 `docs/ENGINE-UNIT3D.md`。

用法：
    blender.exe -b -P tools/blender/build-unit-mcv.py -- <参考模型.glb> <输出.glb>

形体照原版体素实测的剖面定（参考 75×35×29）。原版的平面是"两头收、中间宽"的梭形，
不是长方体：底部最宽 ±18，往上逐层收到 ±13、±11，顶部收到 ±4；纵向从尾部 z=23
拱到中部 z=29、再到车头 z=20；车头收到 ±6、车尾收到 ±12。

等宽的长方体在左前/右后这两个斜角上会多出一整条轮廓，屏幕上的投影宽高就比原版大 9%。
"""

import math
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from unit_build import (  # noqa: E402
    add_box,
    add_cylinder,
    color_of,
    finish_and_export,
    make_material,
    parse_args,
    reference_size,
    texture_dir,
    unit_colors,
)

reference_glb, out_glb = parse_args(
    "[建车] 用法：blender.exe -b -P tools/blender/build-unit-mcv.py -- <参考.glb> <输出.glb>"
)
reference_low, reference_high = reference_size(reference_glb)

textures = texture_dir()
colors = unit_colors(textures)
armor = make_material("Armor", color_of(colors, "Armor", (0.30, 0.33, 0.28)), 0.90, 0.44, texture_path=f"{textures}/Armor.png")
armor_light = make_material(
    "ArmorLight", color_of(colors, "ArmorLight", (0.40, 0.43, 0.37)), 0.85, 0.38, texture_path=f"{textures}/ArmorLight.png"
)
bare_metal = make_material(
    "BareMetal", color_of(colors, "BareMetal", (0.56, 0.57, 0.59)), 1.00, 0.26, texture_path=f"{textures}/BareMetal.png"
)
rubber = make_material("Rubber", color_of(colors, "Rubber", (0.09, 0.09, 0.10)), 0.20, 0.85, texture_path=f"{textures}/Rubber.png")
glass = make_material("Glass", (0.09, 0.12, 0.15), 0.30, 0.10)
optic = make_material("Optic", color_of(colors, "Optic", (0.85, 0.90, 0.72)), 0.10, 0.12, emission=1.2)
accent = make_material("Accent", color_of(colors, "Accent", (0.62, 0.09, 0.08)), 0.30, 0.55)

"""—— 纵向基准 ——"""
hull_bottom, hull_top = 1.0, 7.4
deploy_top, upper_top, crown_top = 21.0, 25.0, 28.0

"""—— 底盘：中后段全宽，尾部收到 ±12，车头一段收到 ±15 ——"""
add_box("Hull", (-12.5, 0.0, (hull_bottom + hull_top) / 2), (49.0, 36.0, hull_top - hull_bottom), armor, bevel=0.9, width_rear=0.667)
add_box("HullNose", (25.0, 0.0, (hull_bottom + hull_top) / 2), (26.0, 30.0, hull_top - hull_bottom), armor, bevel=0.9, width_front=0.267)

"""—— 六对车轮：中后段外缘顶到 ±18，前轮收到 ±15 ——"""
for side in (-1, 1):
    tag = "LR"[side > 0]
    for index in range(6):
        wheel_x = -28.0 + index * 10.4
        outer = 15.0 if index == 5 else 18.0
        add_cylinder(f"Wheel{tag}{index}", (wheel_x, side * (outer - 1.8), 2.9), 2.9, 3.6, rubber, axis="Y", vertices=24)
        add_cylinder(f"Hub{tag}{index}", (wheel_x, side * (outer - 1.8), 2.9), 1.25, 3.9, bare_metal, axis="Y", vertices=16)

"""—— 折叠的基地结构：四层逐层收窄，平面两头收 ——"""
add_box("DeployDeck", (-2.5, 0.0, (hull_top + deploy_top) / 2), (65.0, 34.0, deploy_top - hull_top), armor, bevel=0.9, width_front=0.647, width_rear=0.65)
add_box("DeployUpper", (1.5, 0.0, (deploy_top + upper_top) / 2), (53.0, 26.0, upper_top - deploy_top), armor_light, bevel=0.8, width_front=0.85, width_rear=0.85)
add_box("Crown", (5.0, 0.0, (upper_top + crown_top) / 2), (30.0, 22.0, crown_top - upper_top), armor, bevel=0.7, taper=0.36)
add_box("DeckPanel", (-2.0, 0.0, deploy_top + 0.35), (44.0, 22.0, 0.7), accent, bevel=0.15)
for index in range(5):
    add_box(f"Rib{index}", (-28.0 + index * 12.0, 0.0, deploy_top + 0.85), (0.9, 20.0, 0.6), bare_metal)

"""—— 车头驾驶舱：顶面从 z=27 斜到车头 z=20，正面收到 ±6 ——"""
add_box("Cab", (23.0, 0.0, (hull_top + 27.0) / 2), (18.0, 30.0, 27.0 - hull_top), armor, bevel=1.0, width_front=0.733)
add_box("CabNose", (35.0, 0.0, (hull_top + 20.0) / 2), (6.0, 22.0, 20.0 - hull_top), armor, bevel=0.8, width_front=0.545)
add_box("CabRoof", (21.0, 0.0, 27.4), (14.0, 20.0, 0.8), armor_light, bevel=0.2)
# 挡风板贴在驾驶舱前脸之前 0.1，不做成与舱面共面的薄片（共面会互相遮挡成黑带）
add_box("Windshield", (37.6, 0.0, 15.0), (0.6, 9.6, 5.0), glass, bevel=0.12, rotation=(0, -0.22, 0))
for side in (-1, 1):
    add_cylinder(f"Headlamp{'LR'[side > 0]}", (37.2, side * 4.6, 18.0), 0.9, 0.8, optic, axis="X")
add_box("LightBar", (32.0, 0.0, 19.4), (1.6, 16.0, 0.9), optic, bevel=0.1)

"""—— 顶部：回转底座 + 桅杆 ——"""
add_cylinder("Turntable", (8.0, 0.0, crown_top + 0.5), 4.6, 1.0, armor, vertices=24, bevel=0.2)
add_box("Mast", (8.0, 0.0, crown_top + 1.3), (5.0, 5.0, 1.2), armor_light, bevel=0.25)

"""—— 尾部与侧面细节（都压在外壳里，不动轮廓）——"""
add_cylinder("ExhaustStackL", (-30.0, -11.4, 15.0), 1.0, 7.0, bare_metal, axis="Z")
add_cylinder("ExhaustStackR", (-30.0, 11.4, 15.0), 1.0, 7.0, bare_metal, axis="Z")
for index, offset in enumerate((-7.5, 7.5)):
    add_cylinder(f"Drum{index}", (-34.0, offset, 13.0), 1.9, 5.2, bare_metal, axis="X", vertices=16)
add_box("TowHook", (-36.4, 0.0, 3.4), (1.2, 6.0, 2.2), bare_metal, bevel=0.2)
for side in (-1, 1):
    add_box(f"Step{'LR'[side > 0]}", (8.0, side * 13.4, 18.0), (12.0, 0.8, 1.6), bare_metal)
    add_box(f"Beacon{'LR'[side > 0]}", (-24.0, side * 11.6, upper_top + 0.4), (1.2, 1.2, 0.8), optic, bevel=0.1)

sys.exit(finish_and_export(out_glb, reference_low, reference_high))

"""天启坦克（APOC，Image=MTNK）写实建模 —— 轨道 2 打样 #2。

用法：
    blender.exe -b -P tools/blender/build-unit-apocalypse.py -- <参考.glb> <输出.glb> [贴图目录]

单位契约见 docs/ENGINE-UNIT3D.md：体素单位、+X 车头、底面 z=0、X/Y 居中、
PBR 材质（引擎只读 baseColorTexture，质感烧进颜色：unit_bake.bake_material_colors）。

尺寸锚：work/hd-packs/units3d/mtnk-voxel.glb（APOC Image=MTNK，mtnk.vxl 即天启外观，
实测包围盒 x[-29.5..30.5] / y[-15.5..16.5] / z[0..29]，屏幕轮廓见构建日志）。
三层剖面（2026-10-13 profile-z 实测）：宽车体 0..11.6（|y|90≈14.5）、
上层 11.6..14.5（|y|90≈12.5）、炮塔 14.5..20.3（|y|90≈10.5，x -16.5..5.5）、
塔顶后部结构 20.3..23.2（MammothTusk 导弹巢）、天线到 26。
双 120mm 炮管前伸到 x≈30.5（z 11.6..17.4）。

配色取证：mtnk.vxl 色板聚类 rgb(103,103,79) 44.1%=主装甲、rgb(151,0,0) 14.2%=红色
识别色（MammothTusk 标记）、rgb(31,31,31) 13.5%=履带、rgb(55,55,55) 10.0%=炮管金属、
rgb(139,139,115) 3.9%=浅甲。聚类工具把红色误分给 BareMetal/TrackLink（对红黑主导
单位的已知局限），本脚本按上述聚类手工校正。
"""

import math
import os
import sys

from mathutils import Vector

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from unit_build import (
    add_box,
    add_cylinder,
    add_frustum,
    color_of,
    make_material,
    parse_args,
    reference_size,
    texture_dir,
    unit_colors,
)
from unit_bake import add_loft, finish_and_export_baked

reference_glb, out_glb = parse_args(
    "[build] usage: blender.exe -b -P tools/blender/build-unit-apocalypse.py -- <ref.glb> <out.glb> [texdir]"
)
reference_low, reference_high = reference_size(reference_glb)

textures = texture_dir()
bake_dir = textures + "/baked"
colors = unit_colors(textures)
# 配色聚类已由工具正确处理（build-unit-textures.ts：识别色系不参与灰阶聚类），
# 天启：主甲 olive(103,103,79)、红识别色 (151,0,0)、履带黑 (31,31,31)、炮管灰 (55,55,55)
armor = make_material("Armor", color_of(colors, "Armor", (0.404, 0.404, 0.310)), 0.25, 0.52, texture_path=textures + "/Armor.png")
armor_cast = make_material(
    "ArmorCast", color_of(colors, "ArmorCast", (0.404, 0.404, 0.310)), 0.25, 0.55, texture_path=textures + "/ArmorCast.png"
)
armor_light = make_material(
    "ArmorLight", color_of(colors, "ArmorLight", (139 / 255, 139 / 255, 115 / 255)), 0.20, 0.48, texture_path=textures + "/ArmorLight.png"
)
bare_metal = make_material("BareMetal", color_of(colors, "BareMetal", (0.216, 0.216, 0.216)), 0.45, 0.35, texture_path=textures + "/BareMetal.png")
rubber = make_material("Rubber", color_of(colors, "Rubber", (0.12, 0.12, 0.12)), 0.0, 0.90, texture_path=textures + "/Rubber.png")
track_link = make_material("TrackLink", color_of(colors, "TrackLink", (0.12, 0.12, 0.12)), 0.35, 0.55, texture_path=textures + "/TrackLink.png")
optic = make_material("Optic", color_of(colors, "Optic", (0.55, 0.55, 0.55)), 0.5, 0.12, emission=0.8)
accent = make_material("Accent", color_of(colors, "Accent", (0.59, 0.0, 0.0)), 0.20, 0.50)

# —— 剖面基准（mtnk.vxl 实测）——
track_inner, track_outer = 9.9, 15.8
track_y = (track_inner + track_outer) / 2
track_width = track_outer - track_inner
sponson_inner, sponson_outer = 12.0, 15.5
hull_bottom, hull_top = 3.0, 11.6
deck_top = 14.5
turret_bottom, turret_top = 14.5, 20.3

# ============================ 履带与行走系 ============================
for side in (-1, 1):
    tag = "LR"[side > 0]
    y_center = side * track_y
    top_z, bottom_z = 4.1, 0.4
    front_x, rear_x = 20.0, -22.5
    idler_center, idler_radius = Vector((21.6, 2.2)), 1.7
    sprocket_center, sprocket_radius = Vector((-23.9, 2.2)), 1.7
    points = []
    for step in range(23):
        points.append(Vector((rear_x + (front_x - rear_x) * step / 22, top_z)))
    for step in range(21):
        angle = math.pi / 2 - math.pi * step / 20
        points.append(idler_center + Vector((math.cos(angle), math.sin(angle))) * idler_radius)
    for step in range(23):
        points.append(Vector((front_x + (rear_x - front_x) * step / 22, bottom_z)))
    for step in range(21):
        angle = -math.pi / 2 - math.pi * step / 20
        points.append(sprocket_center + Vector((math.cos(angle), math.sin(angle))) * sprocket_radius)
    links = []
    lengths = [0.0]
    for index in range(1, len(points)):
        lengths.append(lengths[-1] + (points[index] - points[index - 1]).length)
    total = lengths[-1]
    cursor = 1
    for step in range(58):
        want = total * step / 58
        while cursor < len(lengths) - 1 and lengths[cursor] < want:
            cursor += 1
        previous = max(0, cursor - 1)
        span = lengths[cursor] - lengths[previous] or 1.0
        links.append(points[previous] + (points[cursor] - points[previous]) * ((want - lengths[previous]) / span))
    for index, point in enumerate(links):
        ahead = links[(index + 1) % 58]
        behind = links[index - 1]
        angle = -math.atan2((ahead - behind).y, (ahead - behind).x)
        add_box(
            "Link" + tag + format(index, "02d"),
            (point.x, y_center, point.y),
            (1.62, track_width - 0.5, 0.72),
            track_link,
            bevel=0.08,
            rotation=(0.0, angle, 0.0),
        )
        add_box(
            "Horn" + tag + format(index, "02d"),
            (point.x, side * (track_inner + 0.5), point.y),
            (0.62, 0.7, 0.66),
            track_link,
            bevel=0.05,
            rotation=(0.0, angle, 0.0),
        )
    add_cylinder("Sprocket" + tag, (sprocket_center.x, y_center, 2.2), 1.25, track_width - 1.2, track_link, axis="Y")
    add_cylinder("SprocketHub" + tag, (sprocket_center.x, y_center, 2.2), 0.6, track_width - 0.6, bare_metal, axis="Y")
    add_cylinder("Idler" + tag, (idler_center.x, y_center, 2.2), 1.15, track_width - 1.0, track_link, axis="Y")
    add_cylinder("IdlerHub" + tag, (idler_center.x, y_center, 2.2), 0.55, track_width - 0.5, bare_metal, axis="Y")
    for index in range(8):
        wheel_x = -18.0 + index * 5.1
        add_cylinder("Tire" + tag + str(index), (wheel_x, side * 12.7, 2.05), 1.55, 4.3, rubber, axis="Y", vertices=28)
        add_cylinder("Rim" + tag + str(index), (wheel_x, side * 12.7, 2.05), 1.12, 4.7, armor, axis="Y", vertices=28)
        add_cylinder("Hub" + tag + str(index), (wheel_x, side * 12.7, 2.05), 0.55, 5.0, bare_metal, axis="Y", vertices=20)
    add_box(
        "MudFront" + tag, (22.4, side * 12.7, 3.2), (1.5, 1.9, 2.6), rubber, bevel=0.12, rotation=(0, -0.3, 0)
    )
    add_box(
        "MudRear" + tag, (-25.2, side * 12.7, 3.2), (1.5, 1.9, 2.6), rubber, bevel=0.12, rotation=(0, 0.3, 0)
    )
    skirt_centre = side * (sponson_inner + sponson_outer) / 2
    skirt_height = hull_top - 4.3
    for index, centre_x in enumerate((-21.5, -10.5, 0.5, 11.0, 18.8)):
        length = 9.4 if index == 0 else (7.2 if index == 4 else 10.6)
        add_box(
            "Skirt" + tag + str(index),
            (centre_x, skirt_centre, 4.3 + skirt_height / 2),
            (length, sponson_outer - sponson_inner, skirt_height),
            armor,
            bevel=0.5,
            taper=0.98,
        )
    # 红色识别条（mtnk 体素红色簇 14.2%，位于上层侧沿）
    for index, centre_x in enumerate((-16.0, -4.5, 7.0, 16.5)):
        add_box("Stripe" + tag + str(index), (centre_x, side * (sponson_outer - 0.02), 10.6), (6.4, 0.14, 1.7), accent)
    add_box("HullBand" + tag, (-2.5, side * (sponson_outer - 0.02), 11.3), (43.0, 0.14, 0.5), accent)

# ============================ 车体与上层 ============================
add_box("Tub", (-1.0, 0.0, (hull_bottom + hull_top) / 2), (47.0, sponson_inner * 2, hull_top - hull_bottom), armor, bevel=0.9, taper=0.97, taper_bottom=0.985)
add_box("Glacis", (18.5, 0.0, 9.9), (11.5, sponson_inner * 2 - 2.4, 1.8), armor, bevel=0.6, rotation=(0, -0.58, 0))
add_box("NoseJoint", (21.8, 0.0, 7.6), (5.6, sponson_inner * 2 - 2.0, 3.8), armor, bevel=0.6, rotation=(0, -0.28, 0), taper=0.9)
add_box("LowerFront", (23.3, 0.0, 5.6), (3.0, sponson_inner * 2 - 1.7, 4.6), armor, bevel=0.7, taper=0.9, taper_bottom=0.96)
add_box("RearPlate", (-24.6, 0.0, 7.2), (2.6, sponson_inner * 2 - 1.9, 7.0), armor, bevel=0.6, rotation=(0, 0.08, 0), taper=0.95)
# 上层（第二层）：几乎全宽（|y|90≈12.5），天启的上层就是巨型堡垒
add_box("Superstructure", (-2.0, 0.0, (hull_top + deck_top) / 2), (44.0, 25.2, deck_top - hull_top), armor_light, bevel=0.55, taper=0.995)
add_box("FrontDeck", (17.0, 0.0, deck_top + 0.3), (8.0, 22.0, 0.6), armor_light, bevel=0.25)
# 发动机甲板与栅格收在炮塔足迹（x≈-16.5）之后：P2 配合公差——甲板件顶高于
# 炮塔体底-0.3 且伸进足迹下方必穿插（实测 EngineDeck/末位栅格曾 -1.00）
add_box("EngineDeck", (-21.3, 0.0, deck_top + 0.4), (7.0, 21.0, 0.9), armor_light, bevel=0.3)
for index in range(4):
    add_box("Grille" + str(index), (-23.05 + index * 2.0, 0.0, deck_top + 0.85), (1.0, 17.0, 0.3), bare_metal)
# 首上机枪与车灯
add_cylinder("BowMgMount", (23.4, 5.8, 8.2), 1.05, 1.7, armor_light, axis="X", vertices=16, bevel=0.15)
add_cylinder("BowMgBarrel", (25.1, 5.8, 8.2), 0.34, 2.8, bare_metal, axis="X", vertices=12)
for index, offset in enumerate((-8.6, 8.6)):
    add_cylinder("Headlamp" + str(index), (22.0, offset, 10.2), 0.75, 0.75, optic, axis="X", vertices=18)
    add_cylinder("HeadlampRing" + str(index), (22.5, offset, 10.2), 0.86, 0.35, armor_light, axis="X", vertices=18)
# 车尾排气（甲板后沿）
for index, offset in enumerate((-6.6, -2.9, 2.9, 6.6)):
    add_cylinder("Exhaust" + str(index), (-25.3, offset, 12.9), 0.8, 1.8, bare_metal, axis="X", vertices=18, rotation_z=0.1)
    add_cylinder("ExhaustCap" + str(index), (-26.3, offset, 12.9), 0.92, 0.5, rubber, axis="X", vertices=18, rotation_z=0.1)

# ============================ 炮塔（方正重甲堡垒） ============================
add_box("TurretRing", (-5.0, 0.0, turret_bottom - 0.3), (19.0, 17.5, 0.9), armor_light, bevel=0.15)
TURRET_SECTIONS = [
    (-15.5, [(-8.2, 15.1), (-9.6, 16.4), (-9.2, 18.6), (-5.4, 19.8), (0.0, 20.0), (5.4, 19.8), (9.2, 18.6), (9.6, 16.4), (8.2, 15.1)]),
    (-9.0, [(-8.8, 15.0), (-10.2, 16.7), (-9.7, 19.1), (-5.9, 20.1), (0.0, 20.3), (5.9, 20.1), (9.7, 19.1), (10.2, 16.7), (8.8, 15.0)]),
    (-2.0, [(-8.7, 15.0), (-10.1, 16.8), (-9.6, 19.2), (-5.8, 20.2), (0.0, 20.4), (5.8, 20.2), (9.6, 19.2), (10.1, 16.8), (8.7, 15.0)]),
    (3.5, [(-7.8, 15.1), (-9.2, 16.8), (-8.7, 19.0), (-5.1, 19.9), (0.0, 20.1), (5.1, 19.9), (8.7, 19.0 - 0.2), (9.2, 16.8), (7.8, 15.1)]),
    (6.5, [(-6.6, 15.3), (-7.8, 16.6), (-7.4, 18.4), (-4.2, 19.3), (0.0, 19.5), (4.2, 19.3), (7.4, 18.4), (7.8, 16.6), (6.6, 15.3)]),
]
add_loft("Turret", TURRET_SECTIONS, armor_cast, bevel=0.45, subsurf=2)
# 双 120mm：共盾双管，耳轴 z=14.9，前伸到 x≈30
add_box("Mantlet", (8.9, 0.0, 14.9), (4.6, 8.2, 4.6), armor, bevel=0.5)
for index, offset in enumerate((-2.55, 2.55)):
    tag = "AB"[index]
    add_cylinder("RecoilSleeve" + tag, (11.6, offset, 14.9), 2.0, 4.2, bare_metal, axis="X", vertices=22)
    add_cylinder("ThermalSleeve" + tag, (16.9, offset, 14.9), 1.65, 7.4, bare_metal, axis="X", vertices=22)
    add_cylinder("BarrelTube" + tag, (22.4, offset, 14.9), 1.4, 5.4, bare_metal, axis="X", vertices=22)
    add_cylinder("MuzzleBrake" + tag, (27.6, offset, 14.9), 1.95, 2.4, bare_metal, axis="X", vertices=22)
    add_cylinder("MuzzleSlot" + tag, (29.2, offset, 14.9), 1.45, 0.6, rubber, axis="X", vertices=22)
# MammothTusk 导弹巢（塔顶后部两具四联装，z 20.3..23.2 照剖面）
for side in (-1, 1):
    tag = "LR"[side > 0]
    pod_y = side * 8.0
    add_box("TuskPod" + tag, (-9.5, pod_y, 21.6), (10.5, 5.2, 2.6), armor, bevel=0.3)
    add_box("TuskPodRim" + tag, (-4.35, pod_y, 21.7), (0.5, 5.6, 2.9), armor_light, bevel=0.1)
    for row in (-1, 1):
        for column in range(2):
            add_cylinder(
                "TuskTube" + tag + str(row) + str(column),
                (-3.7 + column * 2.1, pod_y + row * 1.05, 21.9),
                0.62,
                2.3,
                bare_metal,
                axis="X",
                vertices=14,
                rotation_y=-0.16,
            )
    # 炮塔正面附加装甲（前视层次）与两侧烟幕弹发射器
    add_box("TurretApplique" + tag, (4.6, side * 5.4, 17.8), (5.5, 0.5, 3.0), armor, bevel=0.2, rotation=(0, -0.14, side * 0.05))
    for tube in range(3):
        add_cylinder(
            "Smoke" + tag + str(tube),
            (-11.6 + tube * 1.1, side * 9.4, 17.2),
            0.4,
            2.4,
            bare_metal,
            axis="X",
            vertices=12,
            rotation_z=side * 0.3,
        )
# 指挥塔与观察器件
add_frustum("Cupola", (2.2, 3.6, 21.0), 2.2, 1.85, 1.4, armor, sides=16, bevel=0.3)
add_cylinder("CupolaHatch", (2.2, 3.6, 21.9), 1.75, 0.4, armor_light, vertices=16, bevel=0.1)
add_box("PeriscopeL", (5.0, 1.8, 19.6), (1.0, 0.9, 0.7), rubber, bevel=0.08)
add_box("PeriscopeR", (5.0, -1.8, 19.6), (1.0, 0.9, 0.7), rubber, bevel=0.08)
add_box("BustleBasket", (-14.5, 0.0, 17.4), (1.4, 15.0, 2.6), bare_metal, bevel=0.12)
add_cylinder("Antenna0", (-13.0, 7.2, 20.6), 0.14, 4.2, bare_metal, axis="Z", vertices=8)
add_cylinder("AntennaBase0", (-13.0, 7.2, 20.3), 0.32, 0.6, armor_light, axis="Z", vertices=10)

# ============================ 收口：烘焙 + 自检 + 导出 ============================
TURRET_PREFIXES = (
    "Turret",
    "Cupola",
    "VisionBlock",
    "LoaderHatch",
    "Periscope",
    "Spotlight",
    "Smoke",
    "BustleBasket",
    "Antenna",
    "Tusk",
)
BARREL_PREFIXES = ("Mantlet", "RecoilSleeve", "ThermalSleeve", "BarrelTube", "MuzzleBrake", "MuzzleSlot")
sys.exit(
    finish_and_export_baked(
        out_glb,
        reference_low,
        reference_high,
        bake_dir,
        buckets={"turret": TURRET_PREFIXES, "barrel": BARREL_PREFIXES},
        pivots={"turret": (-5.0, 0.0, 14.3), "barrel": (8.9, 0.0, 14.9)},
        cube_size_overrides={"turret": 192.0},
        reference_glb=reference_glb,
        deck_z=deck_top,
        bake_size=512,
    )
)

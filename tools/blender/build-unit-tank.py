"""犀牛坦克（HTNK，Rhino Heavy Tank）写实旗舰建模 —— 轨道 2 v2。

用法：
    blender.exe -b -P tools/blender/build-unit-tank.py -- <参考.glb> <输出.glb> [贴图目录]

单位契约见 docs/ENGINE-UNIT3D.md：体素单位、+X 车头、底面 z=0、X/Y 居中、
PBR 材质（引擎只读 baseColorTexture，质感烧进颜色：unit_bake.bake_material_colors）。

造型基准（三件套 + 海报级二创参考 work/soviet-hd/out/ref-rhino-0..2）：
- 体素参考（尺寸锚）：实测包围盒 x[-22.5..23.5]/y[-16.5..17.5]/z[0..21]，屏幕轮廓 75x47；
  三层剖面（2026-10-13 实测）：履带 0..3.5、车体侧壁 2.8..9.4（红带上沿 8.95..9.35）、
  抬高甲板 9.4..12.6（收窄 |y|≈13.5）、炮塔 12.6..19、顶件到 21。
- 红色标识照原版体素数据刷（ENGINE-UNIT3D.md 取证口径）：z 只落在 7..14，
  "车体侧下三块 + 上沿一条长带"，没有星：侧裙三块（z 7.1..8.5）、
  侧沿长带（z 8.95..9.35）、甲板四角块（z 9.35..9.65）、车尾油桶红箍（z 9..12）。
- 形体语言照海报级二创：铸造曲面炮塔（放笼 + Subsurf）、单管长炮 + 制退器、
  7 对负重轮、侧裙板、车尾油桶与排气。

反方块感三件事（上一版被否的根因）：
1. 炮塔是放笼 + Subsurf 的铸造曲面，不是棱台拼盒；
2. 车体板件带收分与大倒角，面与面之间有坡口过渡；
3. 负重轮带橡胶圈与轮毂的两级立体，链节带导齿，不是贴片。
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
    "[build] usage: blender.exe -b -P tools/blender/build-unit-tank.py -- <ref.glb> <out.glb> [texdir]"
)
reference_low, reference_high = reference_size(reference_glb)

textures = texture_dir()
bake_dir = textures + "/baked"
# 颜色一律取 colors.json（原版体素+色板统计），脚本里只是兜底；贴图材质用平铺底图烘焙
colors = unit_colors(textures)
armor = make_material("Armor", color_of(colors, "Armor", (0.545, 0.545, 0.451)), 0.25, 0.50, texture_path=textures + "/Armor.png")
# 铸造光滑面（炮塔大曲面）专用：低频底图，无板缝/铆钉/磨损圆斑——平铺凸点的治本解
armor_cast = make_material(
    "ArmorCast", color_of(colors, "ArmorCast", (0.545, 0.545, 0.451)), 0.25, 0.55, texture_path=textures + "/ArmorCast.png"
)
armor_light = make_material(
    "ArmorLight", color_of(colors, "ArmorLight", (0.627, 0.627, 0.518)), 0.20, 0.45, texture_path=textures + "/ArmorLight.png"
)
bare_metal = make_material(
    "BareMetal", color_of(colors, "BareMetal", (0.31, 0.31, 0.31)), 0.45, 0.35, texture_path=textures + "/BareMetal.png"
)
rubber = make_material("Rubber", color_of(colors, "Rubber", (0.12, 0.12, 0.12)), 0.0, 0.90, texture_path=textures + "/Rubber.png")
track_link = make_material(
    "TrackLink", color_of(colors, "TrackLink", (0.12, 0.12, 0.12)), 0.35, 0.55, texture_path=textures + "/TrackLink.png"
)
optic = make_material("Optic", color_of(colors, "Optic", (0.86, 0.86, 0.86)), 0.5, 0.12, emission=0.8)
accent = make_material("Accent", color_of(colors, "Accent", (0.59, 0.0, 0.0)), 0.20, 0.50)

# —— 横向基准（体素锚）——
track_inner, track_outer = 11.6, 17.0
track_y = (track_inner + track_outer) / 2
track_width = track_outer - track_inner
sponson_inner, sponson_outer = 14.2, 16.9
# —— 纵向高度分带（2026-10-13 剖面实测校准：履带→车体→抬高的甲板→高台上的炮塔）——
hull_bottom, hull_top = 2.8, 9.4
deck_top = 12.3
turret_bottom, turret_top = 12.4, 18.2
# —— 车长方向锚：参考炮口 x≈25.5、车尾 -23 ——
muzzle_x = 25.5

# —— 履带链路径：上直线 → 前导向轮弧 → 下直线 → 后主动轮弧 ——
# 轮弧与链节一起收在前角内（参考前角 x≈18.5；轮心 17.4/半径 1.56 时链节探出 1 体素）
top_z, bottom_z = 3.40, 0.36
front_x, rear_x = 14.6, -14.6
idler_center, idler_radius = Vector((16.7, 1.9)), 1.44
sprocket_center, sprocket_radius = Vector((-16.8, 1.9)), 1.56


def track_paths():
    points = []
    for step in range(21):
        points.append(Vector((rear_x + (front_x - rear_x) * step / 20, top_z)))
    for step in range(21):
        angle = math.pi / 2 - math.pi * step / 20
        points.append(idler_center + Vector((math.cos(angle), math.sin(angle))) * idler_radius)
    for step in range(21):
        points.append(Vector((front_x + (rear_x - front_x) * step / 20, bottom_z)))
    for step in range(21):
        angle = -math.pi / 2 - math.pi * step / 20
        points.append(sprocket_center + Vector((math.cos(angle), math.sin(angle))) * sprocket_radius)
    return points


def resample(points, count):
    lengths = [0.0]
    for index in range(1, len(points)):
        lengths.append(lengths[-1] + (points[index] - points[index - 1]).length)
    total = lengths[-1]
    out = []
    cursor = 1
    for step in range(count):
        want = total * step / count
        while cursor < len(lengths) - 1 and lengths[cursor] < want:
            cursor += 1
        previous = max(0, cursor - 1)
        span = lengths[cursor] - lengths[previous] or 1.0
        ratio = (want - lengths[previous]) / span
        out.append(points[previous] + (points[cursor] - points[previous]) * ratio)
    return out


LINK_COUNT = 46
links = resample(track_paths(), LINK_COUNT)

# ============================ 履带与行走系 ============================
for side in (-1, 1):
    tag = "LR"[side > 0]
    y_center = side * track_y

    # 链节：按切线转向，外侧一面就是别人看到的履带；导齿从链条内侧凸出，卡进轮盘之间
    for index, point in enumerate(links):
        ahead = links[(index + 1) % LINK_COUNT]
        behind = links[index - 1]
        tangent = ahead - behind
        angle = -math.atan2(tangent.y, tangent.x)
        add_box(
            "Link" + tag + format(index, "02d"),
            (point.x, y_center, point.y),
            (1.55, track_width - 0.5, 0.66),
            track_link,
            bevel=0.08,
            rotation=(0.0, angle, 0.0),
        )
        add_box(
            "Horn" + tag + format(index, "02d"),
            (point.x, side * (track_inner + 0.5), point.y),
            (0.6, 0.7, 0.6),
            track_link,
            bevel=0.05,
            rotation=(0.0, angle, 0.0),
        )

    # 主动轮（后，带 12 齿）与导向轮（前）
    add_cylinder("Sprocket" + tag, (-16.8, y_center, 1.9), 1.15, track_width - 1.2, track_link, axis="Y")
    add_cylinder("SprocketHub" + tag, (-16.8, y_center, 1.9), 0.55, track_width - 0.6, bare_metal, axis="Y")
    for tooth in range(12):
        angle = tooth * math.pi / 6
        add_box(
            "Tooth" + tag + format(tooth, "02d"),
            (-16.8 + math.cos(angle) * 1.6, y_center, 1.9 + math.sin(angle) * 1.6),
            (0.62, track_width - 1.4, 0.62),
            track_link,
            rotation=(0.0, -angle, 0.0),
        )
    add_cylinder("Idler" + tag, (16.7, y_center, 1.9), 1.05, track_width - 1.0, track_link, axis="Y")
    add_cylinder("IdlerHub" + tag, (16.7, y_center, 1.9), 0.5, track_width - 0.5, bare_metal, axis="Y")

    # 7 对负重轮：橡胶圈 + 轮盘 + 轮毂的三级立体
    for index in range(7):
        wheel_x = -13.0 + index * 4.33
        add_cylinder("Tire" + tag + str(index), (wheel_x, side * 14.45, 1.78), 1.45, 3.9, rubber, axis="Y", vertices=28)
        add_cylinder("Rim" + tag + str(index), (wheel_x, side * 14.45, 1.78), 1.06, 4.25, armor, axis="Y", vertices=28)
        add_cylinder("Hub" + tag + str(index), (wheel_x, side * 14.45, 1.78), 0.52, 4.55, bare_metal, axis="Y", vertices=20)
        add_box("Susp" + tag + str(index), (wheel_x, side * 13.1, 2.7), (1.5, 2.4, 1.0), armor_light, bevel=0.12)

    # 挡泥板（前后）+ 侧裙装甲（四块；前块收窄，对齐参考"车头履带角 x≈18.5/y≈15.5"）
    add_box(
        "MudFront" + tag, (18.1, side * 14.6, 2.7), (1.4, 1.8, 2.4), rubber, bevel=0.12, rotation=(0, -0.32, 0)
    )
    add_box(
        "MudRear" + tag, (-21.2, side * 14.6, 2.7), (1.4, 1.8, 2.4), rubber, bevel=0.12, rotation=(0, 0.32, 0)
    )
    skirt_centre = side * (sponson_inner + sponson_outer) / 2
    skirt_height = hull_top - 3.9
    # 尾块短一截：裙板尾端与尾板（x -23.6）齐平，不伸出车体
    for index, centre_x in enumerate((-18.9, -8.0, 3.8, 13.4)):
        narrow = index == 3
        length = 9.4 if index == 0 else 10.4
        plate_outer = 15.5 if narrow else sponson_outer
        plate_center_y = side * (sponson_inner + plate_outer) / 2
        add_box(
            "Skirt" + tag + str(index),
            (centre_x, plate_center_y, 3.9 + skirt_height / 2),
            (length, plate_outer - sponson_inner, skirt_height),
            armor_light,
            bevel=0.55,
            taper=0.97,
        )
    # 红色标识（体素数据锚）：侧裙三块 z 7.1..8.5 + 侧沿长带 z 8.95..9.35（带不伸出尾板）
    for index, centre_x in enumerate((-14.5, -2.0, 9.5)):
        add_box("Stripe" + tag + str(index), (centre_x, side * (sponson_outer - 0.02), 7.8), (5.2, 0.14, 1.4), accent)
    add_box("HullBand" + tag, (-3.5, side * (sponson_outer - 0.02), 9.15), (39.0, 0.14, 0.4), accent)
    # 甲板四角红块（顶视体素的四角）
    for index, centre_x in enumerate((16.4, -20.5)):
        add_box("DeckRed" + tag + str(index), (centre_x, side * 15.2, 9.55), (3.4, 2.4, 0.3), accent)

# ============================ 车体 ============================
# 首上斜甲（约 34 度）、下前板、尾板、甲板。板件带收分（下宽上略窄）与大倒角，
# 面与面的坡口过渡是"板件感"的来源；等宽直角盒就是"方块感"。
add_box("Tub", (-1.5, 0.0, (hull_bottom + hull_top) / 2), (43.0, sponson_inner * 2, hull_top - hull_bottom), armor, bevel=0.9, taper=0.965, taper_bottom=0.985)
add_box("Glacis", (16.6, 0.0, 8.0), (10.6, sponson_inner * 2 - 2.2, 1.7), armor, bevel=0.6, rotation=(0, -0.60, 0))
add_box("NoseJoint", (19.0, 0.0, 6.3), (4.8, sponson_inner * 2 - 1.9, 3.4), armor, bevel=0.6, rotation=(0, -0.30, 0), taper=0.9)
add_box("LowerFront", (20.9, 0.0, 4.7), (2.8, sponson_inner * 2 - 1.6, 4.2), armor, bevel=0.7, taper=0.9, taper_bottom=0.96)
add_box("RearPlate", (-21.8, 0.0, 6.1), (2.4, sponson_inner * 2 - 1.8, 6.4), armor, bevel=0.6, rotation=(0, 0.09, 0), taper=0.95)
# 第二层甲板（剖面实测：参考在 z 9.4..12.6 有一层收窄到 |y|≈13.5 的抬高甲板，
# 炮塔坐在它上面——之前塌成与裙板同面就是"炮塔压甲板"的真根因）
add_box("Superstructure", (-4.0, 0.0, (hull_top + deck_top) / 2), (35.0, 26.0, deck_top - hull_top), armor_light, bevel=0.5, taper=0.99)
# 首上甲板与发动机甲板（甲板顶面）
add_box("FrontDeck", (13.6, 0.0, deck_top + 0.25), (7.6, sponson_inner * 2 - 3.4, 0.5), armor_light, bevel=0.22)
add_box("EngineDeck", (-17.5, 0.0, deck_top + 0.25), (10.6, sponson_inner * 2 - 3.6, 0.9), armor_light, bevel=0.3)
# 发动机甲板栅格（5 条板缝 + 两根压条）
for index in range(5):
    add_box("Grille" + str(index), (-21.2 + index * 1.9, 0.0, deck_top + 0.75), (1.05, 18.4, 0.3), bare_metal)
add_box("GrilleRailF", (-12.6, 0.0, deck_top + 0.7), (0.9, 19.0, 0.4), bare_metal)
add_box("GrilleRailR", (-22.1, 0.0, deck_top + 0.7), (0.9, 19.0, 0.4), bare_metal)
# 尾部排气：两只圆头排气口（斜出，装在甲板后沿）
for index, offset in enumerate((-6.0, -2.6)):
    add_cylinder("Exhaust" + str(index), (-21.7, offset, 11.4), 0.8, 1.8, bare_metal, axis="X", vertices=18, rotation_z=0.12)
    add_cylinder("ExhaustCap" + str(index), (-22.7, offset, 11.4), 0.9, 0.5, rubber, axis="X", vertices=18, rotation_z=0.12)
# 首上驾驶员舱盖（微凸圆角盖板）与车首机枪
add_box("DriverHatch", (14.6, -4.8, deck_top + 0.55), (3.2, 4.4, 0.55), armor_light, bevel=0.25)
add_cylinder("BowMgMount", (20.6, 5.4, 6.5), 1.05, 1.6, armor_light, axis="X", vertices=16, bevel=0.15)
add_cylinder("BowMgBarrel", (22.2, 5.4, 6.5), 0.32, 2.6, bare_metal, axis="X", vertices=12)
# 车灯（首上甲板两角）+ 前后拖钩
for index, offset in enumerate((-12.6, 12.6)):
    add_cylinder("Headlamp" + str(index), (19.4, offset, 8.55), 0.72, 0.7, optic, axis="X", vertices=18)
    add_cylinder("HeadlampRing" + str(index), (19.9, offset, 8.55), 0.82, 0.35, armor_light, axis="X", vertices=18)
for index, offset in enumerate((-6.8, 6.8)):
    add_box("TowHookF" + str(index), (21.9, offset, 3.4), (1.3, 1.0, 1.1), bare_metal, bevel=0.15)
    add_box("TowHookR" + str(index), (-23.2, offset, 3.4), (1.3, 1.0, 1.1), bare_metal, bevel=0.15)
# 首上备用履带板（4 块，横向一排，甲板前部）
for index in range(4):
    add_box("SpareLink" + str(index), (14.9 + index * 1.15, 4.6, deck_top + 0.65), (0.95, 4.6, 0.75), track_link, bevel=0.06)
# 侧裙前后的随车工具（撬棍/千斤顶，细长件贴裙板顶）
for side in (-1, 1):
    tag = "LR"[side > 0]
    add_box("ToolBar" + tag, (-2.5, side * 15.6, 9.6), (14.0, 0.55, 0.45), bare_metal, bevel=0.1)
    add_box("ToolEnd" + tag, (4.8, side * 15.6, 9.6), (0.8, 0.7, 0.7), bare_metal, bevel=0.1)
    add_box("JackBlock" + tag, (-9.5, side * 15.6, 9.55), (2.6, 1.1, 0.6), armor_light, bevel=0.15)

# ============================ 炮塔（铸造曲面，坐抬高甲板上） ============================
# 放笼 + Subsurf：沿车长给 5 个截面环，蒙面后细分平滑 —— 圆润的铸造感。
# 塔体 12.4..18.2 照参考三层剖面（甲板 12.3 之上）；平面轮廓是长条塔（前窄后宽，尾舱向后收）。
turret_mid_z = (turret_bottom + turret_top) / 2
add_cylinder("TurretRing", (-2.0, 0.0, turret_bottom - 0.25), 8.6, 0.9, armor_light, vertices=28, bevel=0.12)
TURRET_SECTIONS = [
    (-12.5, [(-6.2, 12.7), (-7.6, 14.0), (-7.2, 16.4), (-4.4, 17.7), (0.0, 17.9), (4.4, 17.7), (7.2, 16.4), (7.6, 14.0), (6.2, 12.7)]),
    (-7.0, [(-7.0, 12.6), (-8.5, 14.3), (-8.0, 16.9), (-4.8, 18.1), (0.0, 18.3), (4.8, 18.1), (8.0, 16.9), (8.5, 14.3), (7.0, 12.6)]),
    (0.0, [(-6.9, 12.6), (-8.4, 14.4), (-7.9, 17.0), (-4.7, 18.2), (0.0, 18.4), (4.7, 18.2), (7.9, 17.0), (8.4, 14.4), (6.9, 12.6)]),
    (5.0, [(-6.0, 12.7), (-7.4, 14.4), (-6.9, 16.8), (-4.1, 17.9), (0.0, 18.1), (4.1, 17.9), (6.9, 16.8), (7.4, 14.4), (6.0, 12.7)]),
    (8.5, [(-4.6, 12.9), (-5.6, 14.3), (-5.2, 16.1), (-3.0, 17.1), (0.0, 17.3), (3.0, 17.1), (5.2, 16.1), (5.6, 14.3), (4.6, 12.9)]),
]
add_loft("Turret", TURRET_SECTIONS, armor_cast, bevel=0.4, subsurf=2)
# 防盾与炮管：炮尾套管 → 热护套 → 裸管 → 双室制退器，耳轴 z=13.4（2026-10-12 加粗一档 + 随甲板抬高）
add_cylinder("Mantlet", (9.6, 0.0, 13.4), 2.9, 3.4, armor, axis="X", vertices=22, bevel=0.4)
add_cylinder("RecoilSleeve", (12.6, 0.0, 13.4), 2.6, 4.4, bare_metal, axis="X", vertices=22)
add_cylinder("ThermalSleeve", (17.7, 0.0, 13.4), 2.25, 8.4, bare_metal, axis="X", vertices=22)
add_cylinder("BarrelTube", (22.3, 0.0, 13.4), 1.95, 2.6, bare_metal, axis="X", vertices=22)
add_cylinder("MuzzleBrake", (24.5, 0.0, 13.4), 2.5, 2.0, bare_metal, axis="X", vertices=22)
add_cylinder("MuzzleSlotF", (25.4, 0.0, 13.4), 1.9, 0.5, rubber, axis="X", vertices=22)
add_cylinder("MuzzleRing", (23.9, 0.0, 13.4), 2.55, 0.35, bare_metal, axis="X", vertices=22)
# 指挥塔：锥台 + 顶盖 + 一圈观察窗（深色玻璃）+ 舱盖
add_frustum("Cupola", (-5.2, 0.0, 18.7), 2.65, 2.2, 1.6, armor, sides=16, bevel=0.3)
add_cylinder("CupolaHatch", (-5.2, 0.0, 19.75), 2.1, 0.4, armor_light, vertices=16, bevel=0.1)
add_cylinder("CupolaHatchGrip", (-5.2, 0.0, 20.05), 0.3, 0.9, bare_metal, axis="X", vertices=10)
for index in range(6):
    angle = index * math.pi / 3
    add_box(
        "VisionBlock" + str(index),
        (-5.2 + math.cos(angle) * 2.5, math.sin(angle) * 2.5, 18.85),
        (0.75, 0.75, 0.5),
        rubber,
        bevel=0.06,
    )
# 装填手舱盖 + 周视镜 + 探照灯
add_frustum("LoaderHatch", (3.4, -4.4, 18.55), 1.55, 1.25, 0.7, armor, sides=12, bevel=0.2)
add_box("PeriscopeL", (6.4, 1.5, 17.7), (1.0, 0.9, 0.7), rubber, bevel=0.08)
add_box("PeriscopeR", (6.4, -1.5, 17.7), (1.0, 0.9, 0.7), rubber, bevel=0.08)
add_cylinder("SpotlightBody", (6.2, 4.9, 18.0), 1.05, 1.3, armor, axis="X", vertices=18, bevel=0.15)
add_cylinder("SpotlightLens", (6.95, 4.9, 18.0), 0.88, 0.3, optic, axis="X", vertices=18)
# 炮塔两侧烟幕弹发射器（各 3 管，斜向前外）
for side in (-1, 1):
    tag = "LR"[side > 0]
    for tube in range(3):
        add_cylinder(
            "Smoke" + tag + str(tube),
            (-1.8 + tube * 1.15, side * 8.35, 16.55),
            0.42,
            2.7,
            bare_metal,
            axis="X",
            vertices=12,
            rotation_z=side * 0.32,
        )
# 塔尾储物筐（细框，贴塔体）与双天线
add_box("BustleBasket", (-12.2, 0.0, 15.6), (1.3, 12.0, 2.4), bare_metal, bevel=0.12)
for index, offset in enumerate((-6.6, 6.6)):
    add_cylinder("Antenna" + str(index), (-8.8, offset, 18.3), 0.14, 3.0, bare_metal, axis="Z", vertices=8)
    add_cylinder("AntennaBase" + str(index), (-8.8, offset, 18.05), 0.32, 0.6, armor_light, axis="Z", vertices=10)

# ============================ 车尾储物 ============================
# 车尾两只油桶（裸金属 + 中段红箍，红箍在体素红区带 z 9..12 内；抬高到甲板层）
for index, offset in enumerate((-8.9, -4.3, 4.3, 8.9)):
    add_cylinder("FuelDrum" + str(index), (-20.6, offset, 13.6), 1.42, 3.4, bare_metal, axis="X", vertices=20, bevel=0.15)
for index, offset in enumerate((-8.9, -4.3, 4.3, 8.9)):
    add_cylinder("FuelBand" + str(index), (-20.6, offset, 13.6), 1.48, 0.5, accent, axis="X", vertices=20)
add_box("RearRack", (-20.6, 0.0, 13.5), (3.6, 24.0, 0.4), bare_metal, bevel=0.1)

# ============================ 收口：分件 + 烘焙 + 自检 + 导出 ============================
# 分件（总工 P0，用户拍板）：炮塔绕炮塔环独立转向、炮管绕耳轴俯仰，引擎按节点名变换。
# 前缀命中 turret/barrel 的归各自桶，其余一律归 hull。
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
)
BARREL_PREFIXES = ("Mantlet", "RecoilSleeve", "ThermalSleeve", "BarrelTube", "MuzzleBrake", "MuzzleSlotF", "MuzzleRing")
sys.exit(
    finish_and_export_baked(
        out_glb,
        reference_low,
        reference_high,
        bake_dir,
        buckets={"turret": TURRET_PREFIXES, "barrel": BARREL_PREFIXES},
        # 枢轴：炮塔=炮塔环中心（甲板顶上）；炮管=耳轴（防盾/炮尾套管中心，随甲板抬高）
        pivots={"turret": (-2.0, 0.0, 12.15), "barrel": (9.6, 0.0, 13.4)},
        # 炮塔是大块光滑铸造面：立方投影密度 64→192，平铺底图的板缝/磨损频率降到 1/3
        cube_size_overrides={"turret": 192.0},
        reference_glb=reference_glb,
        bake_size=512,
    )
)

"""重型坦克（HTNK）的参数化形状。共用件在 `unit_build.py`，契约在 `docs/ENGINE-UNIT3D.md`。

用法：
    blender.exe -b -P tools/blender/build-unit-tank.py -- <参考模型.glb> <输出.glb>

形体定数：

- **车体侧面必须与履带相接**：车体半宽 14.2、履带内侧面 11.6，重叠 2.6 保证融合；
  车体窄了会在正视图里露出两条贯穿的空缝。
- **侧裙盖住履带上半段**（|y| 14.2..16.9，z 3.5..9.4），外侧压一条红色识别带 ——
  原版体素侧面就是这条红带。
- **履带是链**：沿"上直线 → 前导向轮圆弧 → 下直线 → 后主动轮圆弧"等弧长摆 44 节链节，
  每节按切线转；6 对负重轮夹在上下链之间，从侧面看得见。
- **纵向分带照原版体素**：履带 0..3.5、车体 2.8..9.4、炮塔 9.4..15.2、舱盖 15.2..17.2。
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
    finish_and_export,
    make_material,
    parse_args,
    reference_size,
    texture_dir,
    unit_colors,
)

reference_glb, out_glb = parse_args(
    "[建车] 用法：blender.exe -b -P tools/blender/build-unit-tank.py -- <参考.glb> <输出.glb>"
)
reference_low, reference_high = reference_size(reference_glb)

textures = texture_dir()
# 颜色一律取 `colors.json`（由原版 `<单位>.vxl` + 单位色板统计出来），脚本里的值只是兜底；
# 有贴图的那几种用贴图（颜色已烧进图里），其余用同一份颜色表的纯色
colors = unit_colors(textures)
armor = make_material("Armor", color_of(colors, "Armor", (0.30, 0.33, 0.28)), 0.90, 0.42, texture_path=f"{textures}/Armor.png")
armor_light = make_material(
    "ArmorLight", color_of(colors, "ArmorLight", (0.39, 0.42, 0.36)), 0.85, 0.36, texture_path=f"{textures}/ArmorLight.png"
)
bare_metal = make_material(
    "BareMetal", color_of(colors, "BareMetal", (0.56, 0.57, 0.59)), 1.00, 0.26, texture_path=f"{textures}/BareMetal.png"
)
rubber = make_material("Rubber", color_of(colors, "Rubber", (0.09, 0.09, 0.10)), 0.20, 0.85, texture_path=f"{textures}/Rubber.png")
track_link = make_material(
    "TrackLink", color_of(colors, "TrackLink", (0.33, 0.33, 0.35)), 1.00, 0.34, texture_path=f"{textures}/TrackLink.png"
)
optic = make_material("Optic", color_of(colors, "Optic", (0.85, 0.90, 0.72)), 0.10, 0.12, emission=1.2)
accent = make_material("Accent", color_of(colors, "Accent", (0.62, 0.09, 0.08)), 0.30, 0.55)

"""—— 横向基准 ——"""
track_inner, track_outer = 11.6, 17.0
track_y = (track_inner + track_outer) / 2
track_width = track_outer - track_inner
"""纵向基准照原版体素的高度分带。"""
hull_bottom, hull_top = 2.8, 9.4
turret_bottom, turret_top = 9.4, 15.2
sponson_inner, sponson_outer = 14.2, 16.9

"""—— 履带链：上直线 → 前导向轮圆弧 → 下直线 → 后主动轮圆弧 ——"""
top_z, bottom_z = 3.46, 0.34
front_x, rear_x = 14.6, -14.6
idler_center, idler_radius = Vector((17.4, 1.9)), 1.56
sprocket_center, sprocket_radius = Vector((-16.8, 1.9)), 1.56


def track_paths() -> list[Vector]:
    points: list[Vector] = []
    for step in range(0, 21):
        points.append(Vector((rear_x + (front_x - rear_x) * step / 20, top_z)))
    for step in range(0, 21):
        angle = math.pi / 2 - math.pi * step / 20
        points.append(idler_center + Vector((math.cos(angle), math.sin(angle))) * idler_radius)
    for step in range(0, 21):
        points.append(Vector((front_x + (rear_x - front_x) * step / 20, bottom_z)))
    for step in range(0, 21):
        angle = -math.pi / 2 - math.pi * step / 20
        points.append(sprocket_center + Vector((math.cos(angle), math.sin(angle))) * sprocket_radius)
    return points


def resample(points: list[Vector], count: int) -> list[Vector]:
    lengths = [0.0]
    for index in range(1, len(points)):
        lengths.append(lengths[-1] + (points[index] - points[index - 1]).length)
    total = lengths[-1]
    out: list[Vector] = []
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


LINK_COUNT = 44
links = resample(track_paths(), LINK_COUNT)

for side in (-1, 1):
    tag = "LR"[side > 0]
    y_center = side * track_y

    # 链节：按切线转向，外侧一面就是别人看到的履带
    for index, point in enumerate(links):
        ahead = links[(index + 1) % LINK_COUNT]
        behind = links[index - 1]
        tangent = ahead - behind
        angle = -math.atan2(tangent.y, tangent.x)
        add_box(
            f"Link{tag}{index:02d}",
            (point.x, y_center, point.y),
            (1.55, track_width - 0.5, 0.66),
            track_link,
            bevel=0.06,
            rotation=(0.0, angle, 0.0),
        )

    # 主动轮（后，带 12 齿）与导向轮（前）
    add_cylinder(f"Sprocket{tag}", (-16.8, y_center, 1.9), 1.15, track_width - 1.2, track_link, axis="Y")
    add_cylinder(f"SprocketHub{tag}", (-16.8, y_center, 1.9), 0.55, track_width - 0.6, bare_metal, axis="Y")
    for tooth in range(12):
        angle = tooth * math.pi / 6
        add_box(
            f"Tooth{tag}{tooth:02d}",
            (-16.8 + math.cos(angle) * 1.6, y_center, 1.9 + math.sin(angle) * 1.6),
            (0.62, track_width - 1.4, 0.62),
            track_link,
            rotation=(0.0, -angle, 0.0),
        )
    add_cylinder(f"Idler{tag}", (17.4, y_center, 1.9), 1.05, track_width - 1.0, track_link, axis="Y")
    add_cylinder(f"IdlerHub{tag}", (17.4, y_center, 1.9), 0.5, track_width - 0.5, bare_metal, axis="Y")

    # 负重轮 6 对 + 悬挂臂：轮子夹在上下链之间，侧面看得见
    for index in range(6):
        wheel_x = -13.0 + index * 5.2
        add_cylinder(f"Wheel{tag}{index}", (wheel_x, side * 14.4, 1.75), 1.4, 4.2, armor, axis="Y")
        add_cylinder(f"WheelHub{tag}{index}", (wheel_x, side * 14.4, 1.75), 0.55, 4.4, bare_metal, axis="Y")
        add_box(f"Susp{tag}{index}", (wheel_x, side * 13.2, 2.6), (1.4, 2.6, 0.9), armor_light, bevel=0.1)

    # 挡泥板（前后）+ 侧裙装甲（分三块，留缝；外侧压红带）
    add_box(
        f"MudFront{tag}", (20.0, side * 14.3, 2.6), (1.3, track_width - 0.8, 2.2), rubber, bevel=0.1, rotation=(0, -0.3, 0)
    )
    add_box(f"MudRear{tag}", (-20.0, side * 14.3, 2.6), (1.3, track_width - 0.8, 2.2), rubber, bevel=0.1, rotation=(0, 0.3, 0))
    skirt_centre = side * (sponson_inner + sponson_outer) / 2
    skirt_height = hull_top - hull_bottom - 1.4
    for index, centre_x in enumerate((-12.4, 0.0, 12.4)):
        add_box(
            f"Skirt{tag}{index}",
            (centre_x, skirt_centre, hull_bottom + 0.7 + skirt_height / 2),
            (11.4, sponson_outer - sponson_inner, skirt_height),
            armor_light,
            bevel=0.6,
            taper=0.9,
        )
    # 红色标识按原版体素的位置刷：下侧三块红块 + 上沿一条长红带
    # （原版 813/6317 个红色体素，z 只落在 7..14 这一带）
    for index, centre_x in enumerate((-13.0, -1.5, 11.5)):
        add_box(f"Stripe{tag}{index}", (centre_x, side * (sponson_outer - 0.02), 4.6), (5.4, 0.14, 1.1), accent)
    add_box(f"HullBand{tag}", (-2.0, side * (sponson_inner - 0.02), 8.8), (34.0, 0.14, 1.0), accent)

"""—— 车体 ——"""
# 车体侧面往里收（下窄上更窄）：等宽的长方体在这个尺度上是一大片纯色，收分才有"面在转"的观感
add_box(
    "Tub",
    (0.0, 0.0, (hull_bottom + hull_top) / 2),
    (39.0, sponson_inner * 2, hull_top - hull_bottom),
    armor,
    bevel=1.1,
    taper=0.86,
    taper_bottom=0.95,
)
add_box("Glacis", (17.4, 0.0, 6.6), (9.0, sponson_inner * 2 - 2.4, 1.6), armor, bevel=0.7, rotation=(0, -0.62, 0))
add_box("LowerFront", (20.6, 0.0, 5.4), (2.4, sponson_inner * 2 - 1.8, 5.2), armor, bevel=0.8, taper=0.82, taper_bottom=0.94)
add_box("EngineDeck", (-21.5, 0.0, 7.2), (3.0, sponson_inner * 2 - 2.2, 4.4), armor_light, bevel=0.8, taper=0.84, taper_bottom=0.96)
for index in range(4):
    add_box(f"Grille{index}", (-22.4 + index * 0.85, 0.0, 9.55), (0.4, 19.0, 0.35), bare_metal)
add_cylinder("Exhaust", (-22.4, -9.4, 8.0), 0.95, 1.6, bare_metal, axis="X")
add_cylinder("ExhaustPipe", (-21.9, -9.4, 9.4), 0.5, 2.4, bare_metal, axis="Z")
for side in (-1, 1):
    tag = "LR"[side > 0]
    add_cylinder(f"Headlamp{tag}", (21.4, side * 14.6, 8.6), 0.8, 0.7, optic, axis="X")
    add_box(f"Tool{tag}", (-6.0, side * 13.4, 9.6), (7.0, 0.8, 0.5), bare_metal)
    for index in range(3):
        add_box(f"SpareLink{tag}{index}", (17.4 - index * 0.75, side * 6.4, 8.1), (0.55, 4.4, 0.75), track_link, bevel=0.06)

"""—— 炮塔 ——"""
turret_mid = (turret_bottom + turret_top) / 2
add_cylinder("TurretRing", (-1.2, 0.0, turret_bottom - 0.3), 9.0, 1.0, armor_light, vertices=24, bevel=0.15)
# 炮塔做成"下大上小"的锥台（12 棱）：等径八角柱看着就是一块板，铸造感要收分 + 大倒角
add_frustum(
    "Turret",
    (-1.8, 0.0, turret_mid),
    9.3,
    7.6,
    turret_top - turret_bottom - 0.6,
    armor,
    sides=12,
    bevel=1.2,
    rotation_z=math.pi / 12,
)
add_box("TurretFront", (7.0, 0.0, turret_mid + 0.4), (7.4, 16.2, 4.6), armor, bevel=1.3, rotation=(0, -0.40, 0), taper=0.86)
add_box("TurretBustle", (-11.0, 0.0, turret_mid - 0.9), (5.2, 15.0, 3.0), armor, bevel=0.9, taper=0.86, taper_bottom=0.95)
add_box("Basket", (-13.8, 0.0, turret_mid - 0.5), (1.4, 13.2, 2.4), bare_metal, bevel=0.12)
add_cylinder("Mantlet", (10.2, 0.0, turret_mid + 0.2), 3.2, 2.6, armor, axis="X", bevel=0.5)

barrel_length, barrel_radius = 11.8, 0.85
add_cylinder(
    "Barrel", (11.2 + barrel_length / 2, 0.0, turret_mid + 0.2), barrel_radius, barrel_length, bare_metal, axis="X", vertices=20
)
for index in range(4):
    add_cylinder(f"Thermal{index}", (13.8 + index * 1.85, 0.0, turret_mid + 0.2), 1.2, 0.8, bare_metal, axis="X", vertices=20)
add_cylinder("Muzzle", (21.7, 0.0, turret_mid + 0.2), 1.45, 2.6, bare_metal, axis="X", vertices=20)
for index in (-1, 1):
    add_box(f"MuzzleSlot{index}", (21.7, index * 1.4, turret_mid + 0.2), (1.6, 0.5, 0.7), rubber, bevel=0.05)

add_frustum("Cupola", (-4.6, 0.0, turret_top + 0.7), 2.7, 2.2, 1.4, armor, sides=12, bevel=0.4)
add_cylinder("Hatch", (-4.6, 0.0, turret_top + 1.5), 2.2, 0.4, armor_light, bevel=0.1)
for index, offset in enumerate((-1.6, 0.0, 1.6)):
    add_box(f"Periscope{index}", (5.6 + abs(offset) * 0.2, offset, turret_mid + 2.6), (1.0, 1.0, 0.8), optic, bevel=0.1)
add_box("Rws", (2.6, 5.4, turret_mid + 3.8), (3.0, 3.0, 1.8), armor, bevel=0.2)
add_cylinder("RwsBarrel", (5.0, 5.4, turret_mid + 4.2), 0.3, 3.6, bare_metal, axis="X", vertices=12)
for index, offset in enumerate((-5.4, 5.4)):
    add_cylinder(f"Antenna{index}", (-7.0, offset, turret_mid + 2.8), 0.16, 4.1, bare_metal, axis="Z", vertices=8)
for side in (-1, 1):
    tag = "LR"[side > 0]
    for tube in range(3):
        add_cylinder(
            f"Smoke{tag}{tube}",
            (-3.4 + tube * 1.1, side * 9.2, turret_mid + 1.8),
            0.45,
            2.8,
            bare_metal,
            axis="X",
            vertices=12,
            rotation_z=side * 0.35,
        )

"""—— 装饰件：官方原画上那些挂件与工具（都按 2 体素以上做，屏幕上才读得出来）——"""
for side in (-1, 1):
    tag = "LR"[side > 0]
    # 挡泥板储物箱
    add_box(f"StowBox{tag}", (12.0, side * 15.3, 6.6), (4.4, 2.0, 1.8), armor_light, bevel=0.3)
    add_box(f"StowBoxB{tag}", (-15.6, side * 15.3, 6.6), (3.6, 2.0, 1.6), armor_light, bevel=0.3)
    # 拖车缆绳：细而长，屏幕上就是一条线
    add_box(f"Cable{tag}", (-5.0, side * (sponson_outer - 0.05), 9.7), (20.0, 0.4, 0.4), bare_metal)
    # 抓握把手（三个一组，等距）
    for index in range(3):
        add_box(f"Handle{tag}{index}", (-13.0 + index * 9.0, side * (sponson_outer - 0.05), 7.7), (2.4, 0.4, 0.4), bare_metal)
# 炮塔顶：装填手舱盖 + 探照灯
add_frustum("LoaderHatch", (2.6, -4.4, turret_top + 0.3), 1.6, 1.25, 0.7, armor, sides=10, bevel=0.2)
add_cylinder("Spotlight", (6.6, -5.0, turret_mid + 2.5), 1.2, 1.2, armor, bevel=0.2)
add_cylinder("SpotlightLens", (6.6, -5.0, turret_mid + 3.15), 1.0, 0.3, optic)
# 尾部：备用负重轮 + 两只油桶（原画上常见的那种外挂）
add_cylinder("SpareWheel", (-19.4, 7.0, 10.0), 1.8, 1.4, armor)
for index, offset in enumerate((-9.8, -5.4)):
    add_cylinder(f"FuelDrum{index}", (-20.2, offset, 9.8), 1.5, 3.8, bare_metal, axis="X", vertices=16)

sys.exit(finish_and_export(out_glb, reference_low, reference_high))

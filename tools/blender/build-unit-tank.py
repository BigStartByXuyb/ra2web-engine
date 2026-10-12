"""参数化造一辆重型坦克（现代工业风），导出 GLB。单个脚本就是这辆车的唯一来源。

用法：
    blender.exe -b -P tools/blender/build-unit-tank.py -- <参考模型.glb> <输出.glb>

参考模型给的是**尺寸与贴地枢轴**：引擎直接把 GLB 顶点当体素坐标用（`webgl-unit3d` 只做轴交换，
不做缩放），所以新车的包围盒必须与参考一致 —— 长度取 X、宽度取 Y、高度取 Z，最低点 z=0，
在 X/Y 上居中。参考取原版体素翻模（`htnk-voxel.glb`）就等价于"和游戏里的车一样大"。

形体要点（都是踩过坑之后的定数）：

- **车体侧面必须与履带相接**：车体半宽 11.8、履带内侧面 11.6，重叠 0.2 保证融合；
  车体窄了会在正视图里露出两条贯穿的空缝（旧版就是 10.8 / 12.9，缝宽 2.4）。
- **外侧有裙板**（|y| 16.4..17.0，z 4.4..9.1）把履带上半段与车体上方那条缝也封住，
  裙板上压一条红色识别带 —— 原版体素侧面就是这条红带。
- **履带是链**：沿"上直线 → 前导向轮圆弧 → 下直线 → 后主动轮圆弧"等弧长摆 44 节链节，
  每节按切线转；负重轮 6 对夹在上下链之间，从侧面看得见。
- 自检不通过**不导出**：包围盒对不上参考、横向还有整段空白、最低点离地，任一条挂了就直接失败。
"""

import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from unit_audit import measure, see_through_bands  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if len(argv) < 2:
    print("[建车] 用法：blender.exe -b -P tools/blender/build-unit-tank.py -- <参考.glb> <输出.glb>")
    sys.exit(0)
reference_glb, out_glb = argv[0], argv[1]

"""参考尺寸：长度 46 / 宽度 34 / 高度 17.15（原版体素翻模实测值，取不到就退回这套数）。"""
REFERENCE = Vector((46.0, 34.0, 17.15))


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_material(name: str, color: tuple[float, float, float], metallic: float, roughness: float, emission: float = 0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes["Principled BSDF"]
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    if emission > 0:
        principled.inputs["Emission Color"].default_value = (*color, 1.0)
        principled.inputs["Emission Strength"].default_value = emission
    return material


def finish(obj, material, bevel: float, segments: int = 2):
    if bevel > 0:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = segments
        modifier.limit_method = "ANGLE"
    obj.data.materials.append(material)
    return obj


def add_box(name, center, size, material, bevel=0.0, rotation=(0.0, 0.0, 0.0)):
    # 边长直接给 2，再乘 size/2 才等于 size：`size=1` 时乘 size/2 会把盒子砍成一半
    bpy.ops.mesh.primitive_cube_add(size=2, location=center, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, material, bevel)


def add_cylinder(name, center, radius, depth, material, axis="Z", vertices=24, bevel=0.0, rotation_z=0.0):
    rotation = {"Z": (0, 0, 0), "X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=center, rotation=rotation
    )
    obj = bpy.context.active_object
    obj.name = name
    if rotation_z:
        obj.rotation_euler.rotate_axis("Z", rotation_z)
    return finish(obj, material, bevel)


clear_scene()
bpy.ops.import_scene.gltf(filepath=reference_glb)
low, high = measure()
reference = high - low
if abs(reference.x - REFERENCE.x) > 2 or abs(reference.y - REFERENCE.y) > 2:
    print(f"[建车] 参考模型尺寸可疑，改用内置值：实测 {tuple(round(v, 2) for v in reference)}")
    reference = REFERENCE.copy()
print(f"[建车] 参考尺寸 {tuple(round(v, 2) for v in reference)}")

clear_scene()

armor = make_material("Armor", (0.30, 0.33, 0.28), 0.90, 0.42)
armor_light = make_material("ArmorLight", (0.39, 0.42, 0.36), 0.85, 0.36)
bare_metal = make_material("BareMetal", (0.56, 0.57, 0.59), 1.00, 0.26)
rubber = make_material("Rubber", (0.09, 0.09, 0.10), 0.20, 0.85)
track_link = make_material("TrackLink", (0.33, 0.33, 0.35), 1.00, 0.34)
optic = make_material("Optic", (0.85, 0.90, 0.72), 0.10, 0.12, emission=1.2)
accent = make_material("Accent", (0.62, 0.09, 0.08), 0.30, 0.55)

"""—— 横向基准 ——"""
track_inner, track_outer = 11.6, 17.0
track_y = (track_inner + track_outer) / 2
track_width = track_outer - track_inner
"""纵向基准照原版体素的高度分带：履带 0..4.9、车体连侧裙全宽 4.9..9.0、炮塔 9.0..14.2、舱盖 14.2..16.2。"""
track_top = 3.5
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
    add_box(f"MudFront{tag}", (20.0, side * 14.3, 2.6), (1.3, track_width - 0.8, 2.2), rubber, bevel=0.1, rotation=(0, -0.3, 0))
    add_box(f"MudRear{tag}", (-20.0, side * 14.3, 2.6), (1.3, track_width - 0.8, 2.2), rubber, bevel=0.1, rotation=(0, 0.3, 0))
    skirt_centre = side * (sponson_inner + sponson_outer) / 2
    skirt_height = hull_top - hull_bottom - 1.4
    for index, centre_x in enumerate((-12.4, 0.0, 12.4)):
        add_box(
            f"Skirt{tag}{index}",
            (centre_x, skirt_centre, hull_bottom + 0.7 + skirt_height / 2),
            (11.4, sponson_outer - sponson_inner, skirt_height),
            armor_light,
            bevel=0.3,
        )
    add_box(f"Stripe{tag}", (-4.0, side * (sponson_outer - 0.02), 4.0), (14.0, 0.14, 0.9), accent)
    add_box(f"Star{tag}", (-12.4, side * (sponson_outer + 0.04), 5.6), (2.2, 0.16, 2.1), accent)

"""—— 车体 ——"""
add_box("Tub", (0.0, 0.0, (hull_bottom + hull_top) / 2), (39.0, sponson_inner * 2, hull_top - hull_bottom), armor, bevel=0.45)
add_box("Glacis", (17.8, 0.0, 6.6), (7.6, sponson_inner * 2 - 0.6, 1.5), armor, bevel=0.3, rotation=(0, -0.5, 0))
add_box("LowerFront", (20.6, 0.0, 5.4), (2.4, sponson_inner * 2 - 0.6, 5.2), armor, bevel=0.35)
add_box("EngineDeck", (-21.5, 0.0, 7.2), (3.0, sponson_inner * 2 - 0.8, 4.4), armor_light, bevel=0.35)
for index in range(4):
    add_box(f"Grille{index}", (-22.4 + index * 0.85, 0.0, 9.55), (0.4, 19.0, 0.35), bare_metal)
add_cylinder("Exhaust", (-22.4, -9.4, 8.0), 0.95, 1.6, bare_metal, axis="X")
add_cylinder("ExhaustPipe", (-21.9, -9.4, 9.4), 0.5, 2.4, bare_metal, axis="Z")
for side in (-1, 1):
    tag = "LR"[side > 0]
    add_cylinder(f"Headlamp{tag}", (21.4, side * 14.6, 8.6), 0.8, 0.7, optic, axis="X")
    add_box(f"Tool{tag}", (-6.0, side * 13.4, 9.6), (7.0, 0.8, 0.5), bare_metal)
    # 首上备用履带块
    for index in range(3):
        add_box(f"SpareLink{tag}{index}", (17.4 - index * 0.75, side * 6.4, 8.1), (0.55, 4.4, 0.75), track_link, bevel=0.06)

"""—— 炮塔 ——"""
turret_mid = (turret_bottom + turret_top) / 2
add_cylinder("TurretRing", (-1.2, 0.0, turret_bottom - 0.3), 9.0, 1.0, armor_light, vertices=24, bevel=0.15)
add_cylinder("Turret", (-1.8, 0.0, turret_mid), 9.3, turret_top - turret_bottom - 0.8, armor, vertices=8, bevel=0.75, rotation_z=math.pi / 8)
add_box("TurretFront", (7.0, 0.0, turret_mid + 0.4), (7.4, 16.2, 4.6), armor, bevel=0.6, rotation=(0, -0.40, 0))
add_box("TurretBustle", (-11.0, 0.0, turret_mid - 0.9), (5.2, 15.0, 3.0), armor, bevel=0.4)
add_box("Basket", (-13.8, 0.0, turret_mid - 0.5), (1.4, 13.2, 2.4), bare_metal, bevel=0.12)
add_cylinder("Mantlet", (10.2, 0.0, turret_mid + 0.2), 3.2, 2.6, armor, axis="X", bevel=0.3)

barrel_length, barrel_radius = 11.8, 0.85
add_cylinder("Barrel", (11.2 + barrel_length / 2, 0.0, turret_mid + 0.2), barrel_radius, barrel_length, bare_metal, axis="X", vertices=20)
for index in range(4):
    add_cylinder(f"Thermal{index}", (13.8 + index * 1.85, 0.0, turret_mid + 0.2), 1.2, 0.8, bare_metal, axis="X", vertices=20)
add_cylinder("Muzzle", (21.7, 0.0, turret_mid + 0.2), 1.45, 2.6, bare_metal, axis="X", vertices=20)
for index in (-1, 1):
    add_box(f"MuzzleSlot{index}", (21.7, index * 1.4, turret_mid + 0.2), (1.6, 0.5, 0.7), rubber, bevel=0.05)

add_cylinder("Cupola", (-4.6, 0.0, turret_top + 0.7), 2.7, 1.4, armor, bevel=0.25)
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

"""—— 合并成一个网格、平滑着色 ——"""
if "--parts" in sys.argv:
    for want in ("Tub", "Glacis", "SponsonL", "LinkL00", "WheelL0", "SuspL0", "Turret", "SkirtL"):
        for obj in bpy.context.scene.objects:
            if obj.name != want or obj.type != "MESH":
                continue
            part_low = Vector((float("inf"),) * 3)
            part_high = Vector((float("-inf"),) * 3)
            for vertex in obj.data.vertices:
                world = obj.matrix_world @ vertex.co
                part_low = Vector((min(part_low[i], world[i]) for i in range(3)))
                part_high = Vector((max(part_high[i], world[i]) for i in range(3)))
            print(
                f"[部件] {want:10s} x {part_low.x:+7.2f}..{part_high.x:+7.2f}"
                f"  y {part_low.y:+7.2f}..{part_high.y:+7.2f}"
                f"  z {part_low.z:+6.2f}..{part_high.z:+6.2f}"
            )

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
for obj in meshes:
    bpy.context.view_layer.objects.active = obj
    while obj.modifiers:
        bpy.ops.object.modifier_apply(modifier=obj.modifiers[0].name)
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
tank = bpy.context.active_object
tank.name = "HTNK"
bpy.ops.object.shade_auto_smooth(angle=math.radians(32))

"""—— 自检：不达标就不导出 ——"""
low, high = measure()
# 整体落到地面：纯平移，不改形状
tank.location.z -= low.z
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
low, high = measure()
size = high - low
bands = see_through_bands(low, high)
band = max((end - start for start, end in bands), default=0.0)
problems: list[str] = []
for axis, target in (("x", reference.x), ("y", reference.y), ("z", reference.z)):
    actual = getattr(size, axis)
    if abs(actual - target) > 0.6:
        problems.append(f"{axis} 尺寸 {actual:.2f} 偏离参考 {target:.2f}")
if abs(low.z) > 0.06:
    problems.append(f"最低点 z={low.z:.2f} 不贴地")
if abs(low.y + high.y) > 0.3:
    problems.append(f"横向没居中（{low.y:.2f}..{high.y:.2f}）")
if band > 0.8:
    problems.append(f"横向最长空缝 {band:.2f} 过宽，零件没接上")

triangles = 0
tank.data.calc_loop_triangles()
triangles = len(tank.data.loop_triangles)
print(
    f"[建车] 尺寸 {size.x:.2f}×{size.y:.2f}×{size.z:.2f}，最低点 {low.z:.2f}，"
    f"横向空缝 {band:.2f}，三角面 {triangles}，材质 {len(tank.data.materials)}"
)
if problems:
    print("[建车] 自检不通过，未导出：")
    for problem in problems:
        print(f"  - {problem}")
    for start, end in bands:
        print(f"  - 横向空缝 y {start:+.2f}..{end:+.2f}")
    sys.exit(0)

bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", export_apply=True, use_selection=False)
print(f"[建车] 已导出 {out_glb}")

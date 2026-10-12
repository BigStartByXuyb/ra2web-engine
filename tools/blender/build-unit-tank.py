"""程序化重建一辆坦克（平滑几何，不是体素翻模），导出 GLB。

用法：
    blender.exe -b -P tools/blender/build-unit-tank.py -- <旧模型.glb> <输出.glb>

要点：

1. **尺寸与朝向以旧模型为准**：先导入旧 GLB、量出包围盒，再用同样的包围盒造新车，
   这样接进引擎不会跳位（引擎按模型原点的贴地枢轴对齐格子中心）。
2. 几何是**新的**：车体带倒角、炮塔是圆柱、炮管是细圆柱、履带是圆角长条、另有舱盖与探照灯；
   不再是一格格方块，所以不会再有"体素方块感"。
3. 材质是 PBR（Principled BSDF）：装甲金属、履带橡胶、红色识别带。
"""

import sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
old_glb, out_glb = argv[0], argv[1]


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def bounding_box() -> tuple[Vector, Vector]:
    """旧模型的包围盒（世界坐标），用来对齐尺寸与朝向。"""
    points: list[Vector] = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            points.append(obj.matrix_world @ Vector(corner))
    if not points:
        raise SystemExit("旧模型里没有网格，无法量包围盒")
    return (
        Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points))),
        Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points))),
    )


def make_material(name: str, color: tuple[float, float, float], metallic: float, roughness: float):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes["Principled BSDF"]
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    return material


def add_box(name, center, size, material, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
    obj.data.materials.append(material)
    return obj


def add_cylinder(name, center, radius, depth, material, axis="Z", vertices=32, bevel=0.0):
    rotation = {"Z": (0, 0, 0), "X": (0, 1.5708, 0), "Y": (1.5708, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=center, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    if bevel > 0:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    obj.data.materials.append(material)
    return obj


clear_scene()
bpy.ops.import_scene.gltf(filepath=old_glb)
low, high = bounding_box()
span = high - low
center = (low + high) / 2
# 旧模型的原点就在贴地枢轴（底边中点），因此造新车时以"底 z=0、中心在原点"为基准
print(f"[bbox] span={tuple(round(v, 3) for v in span)} min={tuple(round(v, 3) for v in low)}")

clear_scene()

length = span.x
width = span.y
height = span.z

armor = make_material("Armor", (0.42, 0.44, 0.40), 0.85, 0.38)
armor_dark = make_material("ArmorDark", (0.26, 0.28, 0.26), 0.85, 0.45)
rubber = make_material("Track", (0.10, 0.10, 0.11), 0.35, 0.75)
accent = make_material("Accent", (0.62, 0.09, 0.08), 0.35, 0.5)
glass = make_material("Lamp", (0.9, 0.9, 0.7), 0.1, 0.15)

# 车体：低矮的倒角盒（履带占两侧，所以车体窄一些）
hull_length = length * 0.86
hull_width = width * 0.62
hull_height = height * 0.42
add_box("Hull", (0, 0, hull_height / 2), (hull_length, hull_width, hull_height), armor, bevel=hull_height * 0.12)
# 首上装甲：斜置的薄板，做出"倾斜装甲"的形体感
add_box(
    "Glacis",
    (hull_length * 0.34, 0, hull_height * 0.78),
    (hull_length * 0.34, hull_width * 0.98, hull_height * 0.34),
    armor,
    bevel=hull_height * 0.06,
)

# 履带：两侧长条，圆角、包住车体侧面
track_width = (width - hull_width) / 2
for side in (-1, 1):
    add_box(
        f"Track{'LR'[side > 0]}",
        (0, side * (hull_width + track_width) / 2, height * 0.17),
        (length * 0.98, track_width, height * 0.34),
        rubber,
        bevel=track_width * 0.22,
    )
    # 负重轮：几个圆柱从履带里透出一点，避免履带看起来是一块橡皮
    for index in range(5):
        offset = (index - 2) * (length * 0.17)
        add_cylinder(
            f"Wheel{'LR'[side > 0]}{index}",
            (offset, side * (hull_width / 2 + track_width * 0.55), height * 0.17),
            height * 0.11,
            track_width * 0.5,
            armor_dark,
            axis="Y",
            vertices=20,
        )

# 炮塔：圆柱 + 顶部倒角，做出"铸造炮塔"的圆润感
turret_radius = min(hull_width * 0.44, hull_height * 0.6)
turret_height = height * 0.30
add_cylinder(
    "Turret",
    (-hull_length * 0.04, 0, hull_height + turret_height / 2),
    turret_radius,
    turret_height,
    armor,
    vertices=32,
    bevel=turret_height * 0.12,
)
# 炮盾 + 炮管
add_cylinder(
    "Mantlet",
    (hull_length * 0.08, 0, hull_height + turret_height * 0.42),
    turret_radius * 0.62,
    turret_radius * 0.5,
    armor_dark,
    axis="X",
    vertices=24,
)
barrel_length = length * 0.52
add_cylinder(
    "Barrel",
    (hull_length * 0.08 + barrel_length / 2, 0, hull_height + turret_height * 0.42),
    height * 0.045,
    barrel_length,
    armor_dark,
    axis="X",
    vertices=20,
)
# 舱盖与探照灯：小细节，但正是它们让形体"像个真车"
add_cylinder("Hatch", (-hull_length * 0.14, 0, hull_height + turret_height), turret_radius * 0.34, height * 0.05, armor_dark)
add_cylinder(
    "Lamp",
    (hull_length * 0.30, 0, hull_height + turret_height * 0.55),
    height * 0.05,
    height * 0.06,
    glass,
    axis="X",
)
# 车体侧面的红色识别带
add_box(
    "Stripe",
    (-hull_length * 0.18, 0, hull_height * 0.72),
    (hull_length * 0.16, hull_width * 1.02, hull_height * 0.16),
    accent,
    bevel=0.01,
)

# 全部平滑着色，并按包围盒把新车整体缩到与旧模型一致
for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    bpy.ops.object.modifier_apply(modifier=obj.modifiers[0].name) if obj.modifiers else None

new_low, new_high = bounding_box()
new_span = new_high - new_low
scale = min(
    span.x / new_span.x if new_span.x else 1,
    span.y / new_span.y if new_span.y else 1,
    span.z / new_span.z if new_span.z else 1,
)
for obj in bpy.context.scene.objects:
    if obj.type == "MESH":
        obj.scale = (obj.scale.x * scale, obj.scale.y * scale, obj.scale.z * scale)
        obj.location = obj.location * scale

bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", export_apply=True, use_selection=False)
print(f"[done] {out_glb} 尺寸对齐：旧 {tuple(round(v, 2) for v in span)} / 缩放 {scale:.3f}")

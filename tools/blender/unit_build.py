"""单位模型建模的共用件：材质、基础体、合并贴地、自检、导出。

每个单位的形状写在自己的 `build-unit-<单位>.py` 里，只 import 这一份；
尺寸与坐标契约见 `docs/ENGINE-UNIT3D.md`。
"""

import os
import sys

import bpy
from mathutils import Vector

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from unit_audit import measure, see_through_bands  # noqa: E402

"""取不到参考模型时的兜底尺寸（HTNK 量出来的那套，仅用于明显不合理的输入）。"""
FALLBACK_REFERENCE = Vector((46.0, 34.0, 17.15))

"""横向看穿缝的自检阈值：>0.8 体素说明车体与行走部分之间断了。"""
MAX_SEE_THROUGH = 0.8
"""包围盒与参考的允许偏差（体素）。"""
SIZE_TOLERANCE = 0.6
"""材质贴图目录的兜底位置：名字等于材质名（`Armor.png` 一类），没有就退回纯色。"""
DEFAULT_TEXTURE_DIR = "D:/AI_GAME/work/hd-packs/unit-textures"
"""立方投影的密度：一张贴图铺几个体素。"""
CUBE_SIZE = 3.0

"""本次建车用到了贴图的材质；有它才需要给网格展 UV。"""
TEXTURED: list[str] = []


def parse_args(usage: str) -> tuple[str, str]:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) < 2:
        print(usage)
        sys.exit(0)
    return argv[0], argv[1]


def texture_dir() -> str:
    """第三个位置参数就是贴图目录，缺省用 `DEFAULT_TEXTURE_DIR`。"""
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return argv[2] if len(argv) > 2 else DEFAULT_TEXTURE_DIR


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def reference_size(reference_glb: str) -> tuple[Vector, Vector]:
    """参考模型给尺寸与贴地枢轴：导入量一遍，再清空场景准备造车。"""
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=reference_glb)
    low, high = measure()
    size = high - low
    if abs(size.x - FALLBACK_REFERENCE.x) > 40 or abs(size.y - FALLBACK_REFERENCE.y) > 40:
        print(f"[建车] 参考模型尺寸可疑，改用兜底值：实测 {tuple(round(v, 2) for v in size)}")
        low, high = Vector((0, 0, 0)), FALLBACK_REFERENCE.copy()
    print(f"[建车] 参考尺寸 {tuple(round(v, 2) for v in (high - low))}，min={tuple(round(v, 2) for v in low)}")
    clear_scene()
    return low, high


def make_material(
    name: str,
    color: tuple[float, float, float],
    metallic: float,
    roughness: float,
    emission: float = 0.0,
    texture_path: str | None = None,
):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes["Principled BSDF"]
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    if emission > 0:
        principled.inputs["Emission Color"].default_value = (*color, 1.0)
        principled.inputs["Emission Strength"].default_value = emission
    if texture_path and os.path.exists(texture_path):
        # 颜色已经烧进贴图（`tools/build-unit-textures.ts`），所以 Base Color 只连贴图、
        # 不再叠 factor：导出后 baseColorFactor = 1，引擎乘一次就是想要的颜色
        image = bpy.data.images.load(texture_path)
        image.colorspace_settings.name = "sRGB"
        nodes = material.node_tree.nodes
        texture_node = nodes.new("ShaderNodeTexImage")
        texture_node.image = image
        texture_node.location = (-400, 200)
        material.node_tree.links.new(texture_node.outputs["Color"], principled.inputs["Base Color"])
        TEXTURED.append(name)
    elif texture_path:
        print(f"[建车] 贴图缺失，{name} 用纯色：{texture_path}")
    return material


def add_box(name, center, size, material, bevel=0.0, rotation=(0.0, 0.0, 0.0)):
    """边长给 2 再乘 size/2 才等于 size：`size=1` 乘 size/2 会把每个盒子砍成一半。"""
    bpy.ops.mesh.primitive_cube_add(size=2, location=center, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(obj, material, bevel)


def add_cylinder(name, center, radius, depth, material, axis="Z", vertices=24, bevel=0.0, rotation_z=0.0):
    import math

    rotation = {"Z": (0, 0, 0), "X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=center, rotation=rotation
    )
    obj = bpy.context.active_object
    obj.name = name
    if rotation_z:
        obj.rotation_euler.rotate_axis("Z", rotation_z)
    return _finish(obj, material, bevel)


def _finish(obj, material, bevel: float, segments: int = 2):
    if bevel > 0:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = segments
        modifier.limit_method = "ANGLE"
    obj.data.materials.append(material)
    return obj


def join_and_smooth(name: str = "UNIT") -> "bpy.types.Object":
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        while obj.modifiers:
            bpy.ops.object.modifier_apply(modifier=obj.modifiers[0].name)
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    unit = bpy.context.active_object
    unit.name = name
    import math

    bpy.ops.object.shade_auto_smooth(angle=math.radians(32))
    return unit


def unwrap(unit: "bpy.types.Object") -> None:
    """给合体后的网格展 UV：立方投影，按世界轴摊开，密度由 `CUBE_SIZE` 定。

    贴图是可平铺的材质板，用立方投影比 smart 展包的密度均匀（零件多、位置又散，
    展包会把某些面挤成一条线）。
    """
    bpy.context.view_layer.objects.active = unit
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cube_project(cube_size=CUBE_SIZE)
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"[建车] 已展 UV（立方投影，密度 {CUBE_SIZE} 体素/贴图），贴图材质 {len(TEXTURED)} 种")


def finish_and_export(out_glb: str, reference_low: Vector, reference_high: Vector) -> int:
    """合并 → 与参考对齐（贴地、X/Y 居中同参考）→ 自检 → 合规才导出。

    对齐只做整体平移，不改形状：参考模型自己可能不是完美居中（体素翻模常见偏半格），
    所以按参考的包围盒中心摆正，而不是硬把中心压到 0。
    """
    unit = join_and_smooth()
    if TEXTURED:
        unwrap(unit)
    low, high = measure()
    unit.location.x += (reference_low.x + reference_high.x) / 2 - (low.x + high.x) / 2
    unit.location.y += (reference_low.y + reference_high.y) / 2 - (low.y + high.y) / 2
    unit.location.z += reference_low.z - low.z
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    low, high = measure()
    size = high - low

    problems: list[str] = []
    reference_size = reference_high - reference_low
    for axis, index in (("x", 0), ("y", 1), ("z", 2)):
        if abs(size[index] - reference_size[index]) > SIZE_TOLERANCE:
            problems.append(f"{axis} 尺寸 {size[index]:.2f} 偏离参考 {reference_size[index]:.2f}")
    bands = see_through_bands(low, high)
    band = max((end - start for start, end in bands), default=0.0)
    if band > MAX_SEE_THROUGH:
        problems.append(f"横向最长看穿缝 {band:.2f} 过宽，车体与行走部分没接上")

    unit.data.calc_loop_triangles()
    print(
        f"[建车] 尺寸 {size.x:.2f}×{size.y:.2f}×{size.z:.2f}，最低点 {low.z:.2f}，"
        f"横向看穿缝 {band:.2f}，三角面 {len(unit.data.loop_triangles)}，材质 {len(unit.data.materials)}，"
        f"包围盒 x {low.x:+.2f}..{high.x:+.2f} y {low.y:+.2f}..{high.y:+.2f}"
    )
    if problems:
        print("[建车] 自检不通过，未导出：")
        for problem in problems:
            print(f"  - {problem}")
        for start, end in bands:
            print(f"  - 横向看穿 y {start:+.2f}..{end:+.2f}")
        return 1
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", export_apply=True, use_selection=False)
    print(f"[建车] 已导出 {out_glb}")
    return 0

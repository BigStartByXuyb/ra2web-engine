"""单位模型建模的共用件：材质、基础体、合并贴地、自检、导出。

每个单位的形状写在自己的 `build-unit-<单位>.py` 里，只 import 这一份；
尺寸与坐标契约见 `docs/ENGINE-UNIT3D.md`。
"""

import os
import sys
import json

import bpy
from mathutils import Vector

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from unit_audit import measure, see_through_bands, silhouette  # noqa: E402

"""取不到参考模型时的兜底尺寸（HTNK 量出来的那套，仅用于明显不合理的输入）。"""
FALLBACK_REFERENCE = Vector((46.0, 34.0, 17.15))

"""横向看穿缝的自检阈值：>0.8 体素说明车体与行走部分之间断了。"""
MAX_SEE_THROUGH = 0.8
"""
车长与参考的允许偏差（体素），比另外两轴宽。

参考模型的炮管是按"独立 VXL 的原始坐标"拼进去的，**没有按 `<单位>barl.hva` 校正位置**，
所以参考的炮管比精灵里短一截；而精灵才是玩家看到的东西。手作模型按精灵的长度做，
车长因此比参考长 5~9 体素，这是已知且有意为之的差。
"""
LENGTH_TOLERANCE = 9.0
"""屏幕轮廓与参考的允许偏差（像素）。"""
SILHOUETTE_TOLERANCE = 1.5
"""参考模型的屏幕轮廓宽高；`reference_size` 导入参考时记下，`finish_and_export` 用。"""
REFERENCE_SILHOUETTE: tuple[float, float] | None = None
"""材质贴图目录的兜底位置：名字等于材质名（`Armor.png` 一类），没有就退回纯色。"""
DEFAULT_TEXTURE_DIR = "D:/AI_GAME/work/hd-packs/unit-textures"
"""
立方投影的密度：一张贴图铺几个体素。

单位在屏幕上就是 40~75 像素，1 体素 ≈ 1 像素，而贴图是 256×256：
按 8 体素铺一张，等于每体素 32 texel、被缩小 32 倍，mipmap 一选就把纹理抹成纯色
（实测游戏里模型"发平"就是这个）。按 64 体素铺，密度降到 4 texel/体素，
缩一次就够，纹理特征能活到屏幕上。
"""
CUBE_SIZE = 64.0

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


def unit_colors(directory: str) -> dict[str, list[float]]:
    """读 `colors.json`：颜色表由 `tools/build-unit-textures.ts` 从原版体素统计出来。

    没有这份表就返回空字典，各材质退回脚本里的兜底色 —— 两条路都能出模型。
    """
    path = os.path.join(directory, "colors.json")
    if not os.path.exists(path):
        print(f"[建车] 没有颜色表（{path}），用脚本里的兜底色")
        return {}
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def color_of(colors: dict[str, list[float]], material: str, fallback: tuple[float, float, float]):
    """取该材质的原版配色；表里没有就用兜底值。"""
    value = colors.get(material)
    return (value[0], value[1], value[2]) if value else fallback


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def reference_size(reference_glb: str) -> tuple[Vector, Vector]:
    """参考模型给车长、屏幕轮廓与贴地枢轴：导入量一遍，再清空场景准备造车。"""
    global REFERENCE_SILHOUETTE
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=reference_glb)
    REFERENCE_SILHOUETTE = silhouette()
    low, high = measure()
    size = high - low
    if size.x <= 1.0:
        print(f"[建车] 参考模型尺寸可疑，改用兜底值：实测 {tuple(round(v, 2) for v in size)}")
        low, high = Vector((0, 0, 0)), FALLBACK_REFERENCE.copy()
        REFERENCE_SILHOUETTE = None
    shape = "无" if REFERENCE_SILHOUETTE is None else tuple(round(v, 2) for v in REFERENCE_SILHOUETTE)
    print(f"[建车] 参考尺寸 {tuple(round(v, 2) for v in (high - low))}，min={tuple(round(v, 2) for v in low)}，屏幕轮廓 {shape}")
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


def add_box(
    name,
    center,
    size,
    material,
    bevel=0.0,
    rotation=(0.0, 0.0, 0.0),
    taper=1.0,
    taper_bottom=1.0,
    width_front=1.0,
    width_rear=1.0,
):
    """边长给 2 再乘 size/2 才等于 size：`size=1` 乘 size/2 会把每个盒子砍成一半。

    `taper` / `taper_bottom` 是顶面、底面的收分系数（1 = 不收）。车体侧面往里收一点，
    在这个尺度上才有"面在转"的观感；两个盒子侧面完全平行 = 一大片纯色。

    `width_front` / `width_rear` 是平面上的收分：+x 端、−x 端各自的宽度系数。
    盒子只有八个角，所以按 x 的符号取系数就是准确的梯形——基地车那种"两头收、中间宽"
    的梭形平面只能这样表达，等宽长方体在斜角上会多出一整条轮廓。
    """
    bpy.ops.mesh.primitive_cube_add(size=2, location=center, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if taper != 1.0 or taper_bottom != 1.0 or width_front != 1.0 or width_rear != 1.0:
        for vertex in obj.data.vertices:
            factor = taper if vertex.co.z > 0 else taper_bottom
            vertex.co.x *= factor
            vertex.co.y *= factor
            if vertex.co.x > 0:
                vertex.co.y *= width_front
            elif vertex.co.x < 0:
                vertex.co.y *= width_rear
        obj.data.update()
    return _finish(obj, material, bevel)


def add_frustum(
    name,
    center,
    radius_bottom,
    radius_top,
    depth,
    material,
    sides=12,
    bevel=0.0,
    rotation_z=0.0,
    axis="Z",
    scale=None,
):
    """锥台：上下半径不同的多棱体。炮塔做成"下大上小"才像铸造件，等径棱柱看着就是一块板。

    `scale` 用来把圆形锥台拉成椭圆（炮塔在原版里是 28 长 × 19 宽的**长条**塔，
    用正圆做出来俯视就是一个圆盘）。
    """
    import math

    rotation = {"Z": (0, 0, 0), "X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cone_add(
        vertices=sides,
        radius1=radius_bottom,
        radius2=radius_top,
        depth=depth,
        location=center,
        rotation=rotation,
    )
    obj = bpy.context.active_object
    obj.name = name
    if scale is not None:
        obj.scale = scale
    if rotation_z:
        obj.rotation_euler.rotate_axis("Z", rotation_z)
    return _finish(obj, material, bevel)


def add_cylinder(name, center, radius, depth, material, axis="Z", vertices=24, bevel=0.0, rotation_z=0.0, rotation_y=0.0):
    import math

    rotation = {"Z": (0, 0, 0), "X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=center, rotation=rotation
    )
    obj = bpy.context.active_object
    obj.name = name
    if rotation_z:
        obj.rotation_euler.rotate_axis("Z", rotation_z)
    if rotation_y:
        obj.rotation_euler.rotate_axis("Y", rotation_y)
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

    # shade_auto_smooth 依赖自带 "Smooth by Angle" 资产，便携版缺失会直接抛错；
    # 平滑面 + 32° EdgeSplit 是同一观感的确定性做法（finish_and_export 的
    # transform_apply 之后、导出 export_apply 时应用）
    for polygon in unit.data.polygons:
        polygon.use_smooth = True
    split = unit.modifiers.new("edge_split", "EDGE_SPLIT")
    split.split_angle = math.radians(32)
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
    # 旋转也要烘进顶点（理由同 unit_bake.finish_and_export_baked）：引擎不认节点变换
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    low, high = measure()
    size = high - low

    problems: list[str] = []
    reference_size = reference_high - reference_low
    if abs(size.x - reference_size.x) > LENGTH_TOLERANCE:
        problems.append(f"车长 {size.x:.2f} 偏离参考 {reference_size.x:.2f}（上限 {LENGTH_TOLERANCE}）")
    width, height = silhouette()
    if REFERENCE_SILHOUETTE is not None:
        for label, got, want in (
            ("屏幕轮廓宽", width, REFERENCE_SILHOUETTE[0]),
            ("屏幕轮廓高", height, REFERENCE_SILHOUETTE[1]),
        ):
            if abs(got - want) > SILHOUETTE_TOLERANCE:
                problems.append(f"{label} {got:.2f} 偏离参考 {want:.2f}")
    bands = see_through_bands(low, high)
    band = max((end - start for start, end in bands), default=0.0)
    if band > MAX_SEE_THROUGH:
        problems.append(f"横向最长看穿缝 {band:.2f} 过宽，车体与行走部分没接上")

    unit.data.calc_loop_triangles()
    print(
        f"[建车] 尺寸 {size.x:.2f}×{size.y:.2f}×{size.z:.2f}，屏幕轮廓 {width:.2f}×{height:.2f}，最低点 {low.z:.2f}，"
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

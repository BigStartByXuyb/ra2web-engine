"""单位模型三视图（Blender headless）：正前 / 正侧 / 正上 正交图 + 一张 3/4 参考图，并拼成一张版面。

用法：
    blender.exe -b -P tools/blender/render-unit-views.py -- <model.glb> <outDir> [边长px] [采样数]

要点：

1. **正交投影**：三视图不带透视收缩，量比例、看结构靠它；3/4 那张只用来对照观感。
2. **逐视图按模型自身范围定画幅**（含 5% 余量），所以不同模型出图后大小可比。
3. **模型先居中**：视图相机摆在原点四周，居中后四张图共用一套相机参数。
4. 尺寸/面数/材质数直接打印出来，作为"模型是什么样"的文本证据。
"""

import os
import sys

import bpy
import numpy
from mathutils import Vector

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from unit_audit import measure, see_through_bands  # noqa: E402


def fail(message: str) -> None:
    print(f"[三视图] 失败：{message}")


argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if len(argv) < 2:
    fail("用法：blender.exe -b -P tools/blender/render-unit-views.py -- <model.glb> <outDir> [边长px] [采样数]")
    sys.exit(0)

model_path, out_dir = argv[0], argv[1]
side = int(argv[2]) if len(argv) > 2 else 720
samples = int(argv[3]) if len(argv) > 3 else 48
"""`--clay`：所有材质换成一盏浅灰，用来单独看形体（有没有洞、有没有断）。"""
clay = "--clay" in sys.argv
os.makedirs(out_dir, exist_ok=True)


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def report() -> None:
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    materials = {material.name for obj in meshes for material in obj.data.materials if material}
    low, high = measure()
    size = high - low
    print(
        f"[三视图] 网格 {len(meshes)} 个、三角面 {triangles}、材质 {len(materials)} 种"
        f"（{', '.join(sorted(materials))}）"
    )
    print(f"[三视图] 尺寸 X={size.x:.2f} Y={size.y:.2f} Z={size.z:.2f}，最低点 z={low.z:.2f}")
    bands = see_through_bands(low, high)
    widest = max((end - start for start, end in bands), default=0.0)
    print(f"[三视图] 横向看穿缝 {len(bands)} 段，最宽 {widest:.2f}（0 = 侧面连续）")


clear_scene()
bpy.ops.import_scene.gltf(filepath=model_path)
if clay:
    clay_material = bpy.data.materials.new("Clay")
    clay_material.use_nodes = True
    principled = clay_material.node_tree.nodes["Principled BSDF"]
    principled.inputs["Base Color"].default_value = (0.62, 0.62, 0.64, 1.0)
    principled.inputs["Metallic"].default_value = 0.0
    principled.inputs["Roughness"].default_value = 0.55
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        obj.data.materials.clear()
        obj.data.materials.append(clay_material)
report()

low, high = measure()
center = (low + high) / 2
extent = high - low
for obj in list(bpy.context.scene.objects):
    if obj.parent is None:
        obj.location -= center

span = max(extent.x, extent.y, extent.z)

# 光照：主光 + 反向补光 + 中性环境。只用一盏侧光会把朝相机那一面整个压黑，
# 三视图是拿来读形体与颜色的，要两面都看得清。
# 能量按 Standard 视图变换标定（贴着 albedo 看）：AgX 时代的老参数在线性直出下会过曝。
world = bpy.data.worlds.new("审阅环境")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.25, 0.27, 0.30, 1.0)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0

sun_data = bpy.data.lights.new("主光", type="SUN")
sun_data.energy = 1.2
sun_data.angle = 0.15
sun = bpy.data.objects.new("主光", sun_data)
bpy.context.scene.collection.objects.link(sun)
sun.rotation_euler = (0.75, 0.25, 0.55)

fill_data = bpy.data.lights.new("补光", type="SUN")
fill_data.energy = 0.6
fill_data.angle = 0.6
fill = bpy.data.objects.new("补光", fill_data)
bpy.context.scene.collection.objects.link(fill)
fill.rotation_euler = (-0.65, -0.3, -0.6)

camera_data = bpy.data.cameras.new("审阅相机")
camera_data.type = "ORTHO"
camera = bpy.data.objects.new("审阅相机", camera_data)
bpy.context.scene.collection.objects.link(camera)
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = samples
scene.cycles.use_denoising = True
# 审图要贴着贴图值看：AgX 会把中间调整体压黑，换成 Standard（线性直出）
try:
    scene.view_settings.view_transform = "Standard"
except TypeError:
    print(f"[三视图] Standard 不可用，可选：{[i.identifier for i in scene.view_settings.bl_rna.properties['view_transform'].enum_items]}")
scene.render.resolution_x = side
scene.render.resolution_y = side
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"

"""视图：方向向量（相机位置）+ 正交范围。"""
VIEWS = [
    ("front", Vector((0.0, -1.0, 0.0)), extent.x, extent.z),
    ("side", Vector((-1.0, 0.0, 0.0)), extent.y, extent.z),
    ("top", Vector((0.0, 0.0, 1.0)), extent.x, extent.y),
    ("iso", Vector((-0.8, -1.0, 0.62)).normalized(), span, span),
]

rendered: list[str] = []
for name, direction, width, height in VIEWS:
    distance = span * 3
    camera.location = direction * distance
    look = -direction
    camera.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    camera_data.ortho_scale = max(width, height) * 1.05
    path = os.path.join(out_dir, f"{name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    rendered.append(path)
    print(f"[三视图] {name} → {path}")

"""拼成 2×2 版面：Blender 自带 numpy，直接按像素搬。"""
sheet = numpy.zeros((side * 2, side * 2, 4), dtype=numpy.float32)
for index, path in enumerate(rendered):
    image = bpy.data.images.load(path)
    pixels = numpy.array(image.pixels[:], dtype=numpy.float32).reshape(side, side, 4)
    image.user_clear()
    row, column = divmod(index, 2)
    # Blender 图像行序自下而上：第 0 行放上面那排
    sheet[(1 - row) * side : (2 - row) * side, column * side : (column + 1) * side] = pixels

sheet_image = bpy.data.images.new("三视图", width=side * 2, height=side * 2, alpha=True)
sheet_image.pixels = sheet.reshape(-1)
sheet_image.filepath_raw = os.path.join(out_dir, "sheet.png")
sheet_image.file_format = "PNG"
sheet_image.save()
print(f"[三视图] 版面 → {sheet_image.filepath_raw}")

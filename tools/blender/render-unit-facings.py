"""原版单位 → 8 朝向贴图（Blender headless）。

用法：
  blender.exe -b -P tools/blender/render-unit-facings.py -- <model.obj> <outDir> <ppv> <framePx> <samples>

相机与光照都按引擎那一套来，这样渲出来的朝向、体型能和引擎自己的体素精灵对上：
  - 2:1 等距：俯角 30°、偏航 45°（`packages/render` 的 RA2_ISO_VIEW 同一个投影）；
  - 正交相机，`ppv` = 每个体素几个像素（1 就是原版像素尺度，3 是高清档）；
  - 贴地枢轴固定落在画幅**底边中点**：与引擎精灵的锚点口径一致
    （`sliceUnitSheet` 取的锚点是 (frame/2, frame)）；
  - 光照方向 = 引擎的 DEFAULT_LIGHT（-0.35, 0.55, 0.75），环境光补一点暗部。

朝向按引擎的约定：第 i 朝向把模型绕贴地枢轴转 i × 45°（`rotateVoxels` 同一个式子）。
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if len(argv) < 5:
    print("usage: blender -b -P render-unit-facings.py -- <model.obj> <outDir> <ppv> <framePx> <samples>")
    sys.exit(1)
obj_path, out_dir, pixels_per_voxel, frame_px, samples = (
    argv[0],
    argv[1],
    float(argv[2]),
    int(argv[3]),
    int(argv[4]),
)
# 可选：--bevel=0.12 控制倒角宽度（0 = 不倒角，保留方块硬边）
bevel_width = 0.12
for argument in argv[5:]:
    if argument.startswith("--bevel="):
        bevel_width = float(argument[len("--bevel=") :])
os.makedirs(out_dir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=obj_path, up_axis="Z")

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = samples
scene.render.resolution_x = frame_px
scene.render.resolution_y = frame_px
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
# 不做电影级色调映射：材质的基色就是调色板里的颜色
scene.view_settings.view_transform = "Standard"
scene.cycles.use_denoising = True

camera_data = bpy.data.cameras.new("camera")
camera_data.type = "ORTHO"
camera_data.ortho_scale = frame_px / pixels_per_voxel
camera = bpy.data.objects.new("camera", camera_data)
scene.collection.objects.link(camera)

# 相机基向量直接取自引擎的投影式子（`voxel-sprite.ts` 的 project）：
#   screenX = (x − y) · ppv        → 屏幕右 = (1, −1, 0)/√2
#   screenY = ((x + y)/2 − z) · ppv → 屏幕上 = (−sinθ/√2, −sinθ/√2, cosθ)，取 2:1 的 θ = 30°
theta = math.radians(30.0)
right = Vector((-1 / math.sqrt(2), 1 / math.sqrt(2), 0.0))
up = Vector((-math.sin(theta) / math.sqrt(2), -math.sin(theta) / math.sqrt(2), math.cos(theta)))
back = right.cross(up)
# 高度按引擎的比例缩放：screenY 里"地面项 : 高度项 = 0.5 : 1"（引擎的体素高度不是几何高度）
model_height_scale = math.sin(theta) / math.sqrt(2) / (0.5 * math.cos(theta))

# 贴地枢轴落在底边中点：目标点沿屏幕上方向抬高半个画幅
target = up * (frame_px / (2 * pixels_per_voxel))
# 距离只要够远（正交投影不看远近），但必须落在裁剪范围内：默认 clip_end = 1000
camera_data.clip_start = 1.0
camera_data.clip_end = 1000.0
# 相机沿 back 方向后退：Blender 的相机沿自身 −Z 看，所以它必须站在 back 那一侧
location = target + back * 200.0
rotation = Matrix((right, up, back)).transposed().to_4x4()
camera.matrix_world = Matrix.Translation(location) @ rotation
scene.camera = camera

light_direction = Vector((-0.35, 0.55, 0.75)).normalized()
sun_data = bpy.data.lights.new("sun", type="SUN")
sun_data.energy = 1.2
sun_data.angle = math.radians(6.0)
sun = bpy.data.objects.new("sun", sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (-light_direction).to_track_quat("-Z", "Y").to_euler()

# 环境用天空纹理而不是纯色：金属材质要靠环境反射才立得住（这一步是"质感"的关键之一）
world = bpy.data.worlds.new("world")
world.use_nodes = True
nodes, links = world.node_tree.nodes, world.node_tree.links
background = nodes["Background"]
sky = nodes.new("ShaderNodeTexSky")
sky.sky_type = "NISHITA"
sky.sun_elevation = math.radians(35.0)
sky.sun_rotation = math.radians(200.0)
links.new(sky.outputs["Color"], background.inputs["Color"])
background.inputs["Strength"].default_value = 0.15
scene.world = world

meshes = [item for item in scene.objects if item.type == "MESH"]
if not meshes:
    print(f"没有导入到网格：{obj_path}")
    sys.exit(1)
model = meshes[0]
model.scale = (1.0, 1.0, model_height_scale)

# 体素方块的硬边先倒角再平滑着色：不然"超清"只会把方块渲得更清楚
if bevel_width > 0.0:
    bevel = model.modifiers.new("bevel", "BEVEL")
    bevel.width = bevel_width
    bevel.segments = 2
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = math.radians(30.0)
    bpy.context.view_layer.objects.active = model
    bpy.ops.object.modifier_apply(modifier="bevel")
    bpy.ops.object.shade_smooth()

# 材质：调色板基色 → PBR（金属度/粗糙度按亮度分档）。这一步才是"材质"而不是"色块"。
for material in bpy.data.materials:
    if not material.use_nodes:
        continue
    principled = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if principled is None:
        continue
    base = principled.inputs["Base Color"].default_value
    luminance = 0.3 * base[0] + 0.59 * base[1] + 0.11 * base[2]
    principled.inputs["Metallic"].default_value = 0.25
    principled.inputs["Roughness"].default_value = 0.35 + 0.3 * (1.0 - luminance)

for facing in range(8):
    model.rotation_euler = (0.0, 0.0, math.radians(45.0 * facing))
    scene.render.filepath = os.path.join(out_dir, f"facing-{facing}.png")
    bpy.ops.render.render(write_still=True)
    print(f"facing-{facing}.png")

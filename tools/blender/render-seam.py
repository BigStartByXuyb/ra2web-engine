"""接缝特写（P2 配合公差核查用）：炮塔-甲板交界区域放大出图。

用法：
    blender.exe -b -P tools/blender/render-seam.py -- <model.glb> <outDir> [边长px]

出 side.png（正侧）与 iso.png（3/4），画幅锁定炮塔尾-甲板接缝区，另有 sheet.png 两拼。
"""

import os
import sys

import bpy
import numpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
model_path, out_dir = argv[0], argv[1]
side = int(argv[2]) if len(argv) > 2 else 520
os.makedirs(out_dir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=model_path)

# 光照与审阅三视图同口径（主光 + 反向补光 + 中性环境，Standard 视图）
world = bpy.data.worlds.new("接缝环境")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.25, 0.27, 0.30, 1.0)
sun_data = bpy.data.lights.new("主光", type="SUN")
sun_data.energy = 1.2
sun = bpy.data.objects.new("主光", sun_data)
bpy.context.scene.collection.objects.link(sun)
sun.rotation_euler = (0.75, 0.25, 0.55)
fill_data = bpy.data.lights.new("补光", type="SUN")
fill_data.energy = 0.6
fill = bpy.data.objects.new("补光", fill_data)
bpy.context.scene.collection.objects.link(fill)
fill.rotation_euler = (-0.65, -0.3, -0.6)

camera_data = bpy.data.cameras.new("接缝相机")
camera_data.type = "ORTHO"
camera = bpy.data.objects.new("接缝相机", camera_data)
bpy.context.scene.collection.objects.link(camera)
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 48
scene.cycles.use_denoising = True
try:
    scene.view_settings.view_transform = "Standard"
except TypeError:
    pass
scene.render.resolution_x = side
scene.render.resolution_y = int(side * 0.62)
scene.render.image_settings.file_format = "PNG"

# 画幅：炮塔尾-甲板接缝区（x -16..-8，z 10..15），两台车通用
target = Vector((-12.3, 0.0, 12.4))
ortho = 8.0
VIEWS = [("side", Vector((-1.0, 0.0, 0.02))), ("iso", Vector((-0.8, -1.0, 0.55)).normalized())]
rendered = []
for name, direction in VIEWS:
    camera.location = target + direction * 120.0
    camera.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    camera_data.ortho_scale = ortho
    path = os.path.join(out_dir, f"{name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    rendered.append(path)
    print(f"[接缝] {name} → {path}")

height = scene.render.resolution_y
sheet = numpy.zeros((height, side * 2, 4), dtype=numpy.float32)
for index, path in enumerate(rendered):
    image = bpy.data.images.load(path)
    pixels = numpy.array(image.pixels[:], dtype=numpy.float32).reshape(height, side, 4)
    image.user_clear()
    sheet[:, index * side : (index + 1) * side] = pixels
sheet_image = bpy.data.images.new("接缝", width=side * 2, height=height, alpha=True)
sheet_image.pixels = sheet.reshape(-1)
sheet_image.filepath_raw = os.path.join(out_dir, "sheet.png")
sheet_image.file_format = "PNG"
sheet_image.save()
print(f"[接缝] 版面 → {sheet_image.filepath_raw}")

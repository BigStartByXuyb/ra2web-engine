"""采样诊断 v2：直接用导入 glb 内嵌的贴图逐面采样，报暗面占比与暗面 UV 落点。

用法：
    blender.exe -b -P tools/blender/debug-uv-sample.py -- <model.glb>
"""

import sys

import bpy
import numpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])

for material in bpy.data.materials:
    if not material.use_nodes:
        continue
    principled = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if principled is None:
        continue
    base = principled.inputs["Base Color"]
    image = None
    for link in material.node_tree.links:
        if link.to_socket.name == "Base Color" and link.from_node.type == "TEX_IMAGE":
            image = link.from_node.image
    if image is None:
        print(f"[采样] {material.name}: 无贴图，跳过")
        continue
    width, height = image.size
    if width == 0:
        print(f"[采样] {material.name}: 贴图无像素！")
        continue
    buffer = numpy.array(image.pixels[:], dtype=numpy.float32).reshape(height, width, 4)
    bright, dark, dark_uv = [], [], []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or material.name not in obj.data.materials:
            continue
        slot = obj.data.materials[:].index(material)
        mesh = obj.data
        mesh.calc_loop_triangles()
        uv_layer = mesh.uv_layers.active.data
        for triangle in mesh.loop_triangles:
            if triangle.material_index != slot:
                continue
            for loop_index in triangle.loops:
                u, v = uv_layer[loop_index].uv
                px = min(max(int(u * (width - 1)), 0), width - 1)
                py = min(max(int(v * (height - 1)), 0), height - 1)
                value = float(buffer[py, px, :3].mean())
                (dark if value < 0.1 else bright).append(value)
                if value < 0.1:
                    dark_uv.append((u, v))
    if not bright and not dark:
        print(f"[采样] {material.name}: 找不到带此材质的面")
        continue
    total = len(bright) + len(dark)
    line = f"[采样] {material.name}: 均值 {numpy.mean(bright + dark):.3f} 暗面 {len(dark)}/{total}"
    if dark_uv:
        us = [uv[0] for uv in dark_uv]
        vs = [uv[1] for uv in dark_uv]
        line += f"  暗面UV u[{min(us):.2f}..{max(us):.2f}] v[{min(vs):.2f}..{max(vs):.2f}]"
    print(line)

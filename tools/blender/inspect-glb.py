"""解剖单位 glb 的材质链（调试工具）：每个材质的 Base Color 接了什么、图里平均色多少。

用法：
    blender.exe -b -P tools/blender/inspect-glb.py -- <model.glb>
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
    print(f"MAT {material.name}")
    for node in material.node_tree.nodes:
        if node.type != "BSDF_PRINCIPLED":
            continue
        base = node.inputs["Base Color"]
        print(f"  baseColor linked={base.is_linked} value={[round(v, 2) for v in base.default_value]}")
        for link in material.node_tree.links:
            if link.to_socket == base:
                image = getattr(link.from_node, "image", None)
                if image is None:
                    print(f"  ← 非贴图节点 {link.from_node.type}")
                    continue
                print(f"  ← 图 {image.name} {tuple(image.size)}")
                if image.size[0] > 0:
                    pixels = numpy.array(image.pixels[:], dtype=numpy.float32).reshape(-1, 4)
                    print(f"    平均 rgb {pixels[:, :3].mean(axis=0).round(3)}，像素 {len(pixels)}")
        print(f"  metallic={node.inputs['Metallic'].default_value:.2f} roughness={node.inputs['Roughness'].default_value:.2f}")

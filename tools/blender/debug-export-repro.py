"""最小复现：glTF 导出器是否丢弃 source=GENERATED 的图，载回 FILE 后是否恢复。"""

import os

import bpy
import numpy

out_dir = r"D:\AI_GAME\work\tmp-shots"

# 情形 A：生成图（source=GENERATED），落盘后直接导
img = bpy.data.images.new("gen", 8, 8, alpha=False)
img.colorspace_settings.name = "sRGB"
pixels = numpy.zeros(8 * 8 * 4, dtype=numpy.float32)
pixels[0::4] = 1.0  # 全红
img.pixels = pixels.tolist()
img.filepath_raw = os.path.join(out_dir, "gen-test.png")
img.file_format = "PNG"
img.save()
print(f"A source={img.source}")

material = bpy.data.materials.new("M")
material.use_nodes = True
principled = material.node_tree.nodes["Principled BSDF"]
node = material.node_tree.nodes.new("ShaderNodeTexImage")
node.image = img
material.node_tree.links.new(node.outputs["Color"], principled.inputs["Base Color"])
bpy.ops.mesh.primitive_cube_add()
bpy.context.active_object.data.materials.append(material)
bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, "gen-test.glb"), export_format="GLB", export_apply=True)

# 情形 B：同一张图从盘上重载（source=FILE）再导
img2 = bpy.data.images.load(os.path.join(out_dir, "gen-test.png"))
print(f"B source={img2.source}")
node.image = img2
bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, "file-test.glb"), export_format="GLB", export_apply=True)
print("done")

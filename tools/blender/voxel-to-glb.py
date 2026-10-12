"""原版体素翻模的 OBJ → GLB，做成参考模型（`<单位>-voxel.glb`）。

用法：
    blender.exe -b -P tools/blender/voxel-to-glb.py -- <输入.obj> <输出.glb>

上游是 `tsx tools/vxl-to-obj.ts <RA2.MIX> <out.obj> <单位ID>`。参考模型只当
"这个单位多大、朝哪边、枢轴在哪"的口径用（`docs/ENGINE-UNIT3D.md`），
所以这里原样搬过去：不合并、不减面、不动材质。
"""

import os
import sys

import bpy

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from unit_build import parse_args

source_obj, out_glb = parse_args(
    "[翻模] 用法：blender.exe -b -P tools/blender/voxel-to-glb.py -- <输入.obj> <输出.glb>"
)

bpy.ops.wm.read_factory_settings(use_empty=True)
# OBJ 已经是体素空间（z 向上、贴地、居中），所以按 Blender 自身的轴约定导入，
# 不让导入器再旋一次：默认的 Y 向上会把模型的 z 转到 y 上，参考的朝向就错了。
bpy.ops.wm.obj_import(filepath=source_obj, forward_axis="Y", up_axis="Z")

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if not meshes:
    raise SystemExit(f"[翻模] {source_obj} 里没有网格")

bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", export_apply=True, use_selection=False)
print(f"[翻模] 已导出 {out_glb}（网格 {len(meshes)} 个）")

"""剖面测量（调试工具）：按 z 分格报告每层的 x/y 占宽，用于分件模型的"层结构"对照。

用法：
    blender.exe -b -P tools/blender/profile-z.py -- <model.glb> [层数]

每层打印：z 带宽、该层内顶点的 x 范围与 y 半宽（含 90 分位，抗离群）。
voxel 参考和打样模型各跑一次，并排看层结构差在哪。
"""

import sys

import bpy
import numpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
layers = int(argv[1]) if len(argv) > 1 else 10

points = []
for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    for vertex in obj.data.vertices:
        points.append(obj.matrix_world @ vertex.co)
low = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
high = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
print(f"[剖面] 包围盒 x[{low.x:.1f}..{high.x:.1f}] y[{low.y:.1f}..{high.y:.1f}] z[{low.z:.1f}..{high.z:.1f}]")

zs = numpy.array([p.z for p in points])
ys = numpy.array([p.y for p in points])
xs = numpy.array([p.x for p in points])
step = (high.z - low.z) / layers
for index in range(layers):
    z0, z1 = low.z + index * step, low.z + (index + 1) * step
    mask = (zs >= z0) & (zs < z1)
    count = int(mask.sum())
    if count == 0:
        print(f"[剖面] z {z0:5.2f}..{z1:5.2f}  空")
        continue
    layer_x, layer_y = xs[mask], ys[mask]
    y90 = float(numpy.percentile(numpy.abs(layer_y), 90))
    print(
        f"[剖面] z {z0:5.2f}..{z1:5.2f}  顶点 {count:6d}  x[{layer_x.min():6.1f}..{layer_x.max():6.1f}]"
        f"  |y|90={y90:5.1f}"
    )

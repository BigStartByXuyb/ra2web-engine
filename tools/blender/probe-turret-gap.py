"""炮塔-甲板接缝间隙探针：量炮塔体底与「炮塔足迹下的甲板件顶」的最小间隙。

用法：
    blender.exe -b -P tools/blender/probe-turret-gap.py -- <model.glb> [甲板面z=12.3]

正值 = 间隙，负值 = 穿插。口径：
- 面片采样（顶点采样会被"大平面只有角点"骗到）；
- 炮塔侧只取"甲板面以上"的顶点——炮塔环嵌进甲板是设计接口，不算穿插；
- 车体侧只取"甲板面以上"的面片质心（炮塔足迹内）——甲板平面本身不算。
量产有炮塔的单位都跑这一条（模型标准公差 ≥0.30）。
"""

import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
deck_z = float(argv[1]) if len(argv) > 1 else 12.3
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])

turret = next((obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name == "turret"), None)
hull = next((obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name == "hull"), None)
if turret is None or hull is None:
    print("[间隙] 找不到 turret/hull 节点")
    sys.exit(1)

turret_points = [turret.matrix_world @ vertex.co for vertex in turret.data.vertices]
body = [point for point in turret_points if point.z >= deck_z]
if not body:
    print("[间隙] 甲板面以上没有炮塔体顶点")
    sys.exit(1)
turret_low = min(point.z for point in body)
low_point = min(body, key=lambda point: point.z)
turret_x = (min(point.x for point in turret_points), max(point.x for point in turret_points))
turret_y = (min(point.y for point in turret_points), max(point.y for point in turret_points))
print(
    f"[间隙] 炮塔足迹 x[{turret_x[0]:.1f}..{turret_x[1]:.1f}] y[{turret_y[0]:.1f}..{turret_y[1]:.1f}]；"
    f"炮塔体底 z={turret_low:.2f} @ ({low_point.x:.1f}, {low_point.y:.1f})"
)

samples: list[tuple[float, float, float]] = []
for polygon in hull.data.polygons:
    center = hull.matrix_world @ polygon.center
    if not (turret_x[0] <= center.x <= turret_x[1] and turret_y[0] <= center.y <= turret_y[1]):
        continue
    top = max((hull.matrix_world @ hull.data.vertices[index].co).z for index in polygon.vertices)
    if top <= deck_z:
        continue
    samples.append((top, center.x, center.y))
if not samples:
    print("[间隙] 足迹内甲板面以上没有车体件")
    sys.exit(0)
samples.sort(reverse=True)
print(f"[间隙] 足迹内最高甲板件取样（共 {len(samples)} 片）：")
for top, x, y in samples[:5]:
    print(f"        z={top:.2f} @ ({x:.1f}, {y:.1f})")
print(f"[间隙] 最小间隙 = {turret_low - samples[0][0]:+.2f} 体素（负值=穿插；标准 ≥0.30）")

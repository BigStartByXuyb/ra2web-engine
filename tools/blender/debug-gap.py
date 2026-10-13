"""接缝间隙定位（调试工具）：跑完整形状脚本但跳过烘焙，按部件名报炮塔足迹内的甲板件。

用法（与 build-unit-*.py 同参）：
    blender.exe -b -P tools/blender/debug-gap.py -- <ref.glb> <out.glb> [texdir] [甲板面z]
"""

import os
import runpy
import sys

import bpy
from mathutils import Vector

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

deck_z = float(sys.argv[-1]) if sys.argv[-1].replace(".", "", 1).isdigit() else 12.3

TURRET_PREFIXES = (
    "Turret", "Cupola", "VisionBlock", "LoaderHatch", "Periscope",
    "Spotlight", "Smoke", "BustleBasket", "Antenna", "Tusk",
)


def report(out_glb, reference_low, reference_high, bake_dir, **kwargs):
    del out_glb, reference_low, reference_high, bake_dir, kwargs
    turret_parts = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name.startswith(TURRET_PREFIXES)]
    turret_points = [obj.matrix_world @ vertex.co for obj in turret_parts for vertex in obj.data.vertices]
    body = [point for point in turret_points if point.z >= deck_z]
    turret_low = min(point.z for point in body)
    low_point = min(body, key=lambda point: point.z)
    turret_x = (min(point.x for point in turret_points), max(point.x for point in turret_points))
    turret_y = (min(point.y for point in turret_points), max(point.y for point in turret_points))
    print(f"[间隙] 甲板面 z={deck_z}；炮塔足迹 x[{turret_x[0]:.1f}..{turret_x[1]:.1f}] y[{turret_y[0]:.1f}..{turret_y[1]:.1f}]")
    print(f"[间隙] 炮塔体底 z={turret_low:.2f} @ ({low_point.x:.1f}, {low_point.y:.1f})")
    rows: list[tuple[float, str, float, float]] = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.startswith(TURRET_PREFIXES):
            continue
        top = max((obj.matrix_world @ vertex.co).z for vertex in obj.data.vertices)
        center = obj.matrix_world @ (
            sum((vertex.co for vertex in obj.data.vertices), Vector()) / len(obj.data.vertices)
        )
        if top <= deck_z:
            continue
        if not (turret_x[0] <= center.x <= turret_x[1] and turret_y[0] <= center.y <= turret_y[1]):
            continue
        rows.append((top, obj.name, center.x, center.y))
    rows.sort(reverse=True)
    print(f"[间隙] 足迹内甲板面以上部件 {len(rows)} 个（按顶高排）：")
    for top, name, x, y in rows[:10]:
        print(f"        z={top:.2f}  {name:<16} @ ({x:.1f}, {y:.1f})  间隙 {turret_low - top:+.2f}")
    return 0


import unit_bake

unit_bake.finish_and_export_baked = report
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "build-unit-tank.py"), run_name="__main__")

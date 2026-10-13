"""轮廓极值定位（调试工具）：跑完整形状脚本但跳过烘焙，按对象报 screenX 两端的极值。

用法：
    blender.exe -b -P tools/blender/debug-extremes.py -- <ref.glb> <out.glb> [texdir]

参数与 build-unit-tank.py 完全一致；只是把收口函数换成"逐对象 screenX 排行"。
"""

import os
import runpy
import sys

import bpy

sys.path.append(os.path.dirname(os.path.abspath(__file__)))


def report(out_glb, reference_low, reference_high, bake_dir, **kwargs):
    del out_glb, reference_low, reference_high, bake_dir, kwargs
    rows = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        low_x = high_x = float("inf") * -1
        low_x = float("inf")
        high_x = float("-inf")
        for vertex in obj.data.vertices:
            world = obj.matrix_world @ vertex.co
            screen_x = world.x - world.y
            low_x = min(low_x, screen_x)
            high_x = max(high_x, screen_x)
        rows.append((high_x, low_x, obj.name))
    rows.sort(reverse=True)
    print("[诊断] screenX max 端前 8：")
    for high_x, low_x, name in rows[:8]:
        print(f"  +{high_x:7.2f} (min {low_x:7.2f})  {name}")
    print("[诊断] screenX min 端前 8：")
    for high_x, low_x, name in sorted(rows, key=lambda row: row[1])[:8]:
        print(f"  {low_x:7.2f} (max {high_x:7.2f})  {name}")
    return 0


import unit_bake

unit_bake.finish_and_export_baked = report
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "build-unit-tank.py"), run_name="__main__")

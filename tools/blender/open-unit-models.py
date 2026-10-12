"""把单位模型成对导进 Blender 的图形界面：左边"我们做的"，右边"原版体素参考"，一眼比出差别。

用法：
    blender.exe --python tools/blender/open-unit-models.py -- [模型目录] [单位名...]

不给单位名就开 htnk / mtnk / smcv。三个单位分别摆在 x = 0 / 90 / 180，
每对里参考再往 +x 挪 45 体素，所以不会叠在一起。
"""

import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
directory = argv[0] if argv else "D:/AI_GAME/work/hd-packs/units3d"
names = argv[1:] or ["htnk", "mtnk", "smcv"]

bpy.ops.wm.read_factory_settings(use_empty=True)
column = 0
for name in names:
    for suffix, label, shift in (("", "ours", 0.0), ("-voxel", "ref", 45.0)):
        path = os.path.join(directory, f"{name}{suffix}.glb")
        if not os.path.exists(path):
            print(f"[打开] 没有 {path}")
            continue
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        for obj in set(bpy.context.scene.objects) - before:
            obj.name = f"{name.upper()}_{label}_{obj.name}"
            obj.location.x += column * 90.0 + shift
        print(f"[打开] {name}{suffix}.glb → x 偏移 {column * 90 + shift:.0f}（{label}）")
    column += 1
print(f"[打开] 场景里现在有 {len(bpy.context.scene.objects)} 个对象")

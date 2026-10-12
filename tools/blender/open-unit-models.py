"""把 `units3d` 里的单位模型一次导进 Blender 的图形界面，方便逐个看形体。

用法：
    blender.exe --python tools/blender/open-unit-models.py -- [模型目录] [单位名...]

不给单位名就开 htnk / mtnk / smcv 三个（我们手作与已接入的三种）。
"""

import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
directory = argv[0] if argv else "D:/AI_GAME/work/hd-packs/units3d"
names = argv[1:] or ["htnk", "mtnk", "smcv"]

bpy.ops.wm.read_factory_settings(use_empty=True)
for name in names:
    path = os.path.join(directory, f"{name}.glb")
    if not os.path.exists(path):
        print(f"[打开] 没有 {path}")
        continue
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    for obj in set(bpy.context.scene.objects) - before:
        obj.name = f"{name.upper()}_{obj.name}"
    print(f"[打开] 已导入 {path}")
print(f"[打开] 场景里现在有 {len(bpy.context.scene.objects)} 个对象")

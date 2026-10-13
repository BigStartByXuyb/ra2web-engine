"""单位模型的共同量法：包围盒、屏幕轮廓、横向能不能看穿。建模、出图、审阅三个脚本共用这一份。

放进 `tools/blender/` 由各脚本 `sys.path` 加同行后 import，不要各脚本再抄一遍。
"""

import bpy
import numpy
from mathutils import Vector

"""横向分格数：96 格覆盖整个车宽，约 0.35 体素一格，够抓一条缝。"""
RESOLUTION = 96


def measure() -> tuple[Vector, Vector]:
    """按顶点算整体包围盒（`bound_box` 是缓存，改过顶点就不准）。"""
    low = Vector((float("inf"),) * 3)
    high = Vector((float("-inf"),) * 3)
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for vertex in obj.data.vertices:
            world = obj.matrix_world @ vertex.co
            low = Vector((min(low[i], world[i]) for i in range(3)))
            high = Vector((max(high[i], world[i]) for i in range(3)))
    return low, high


def silhouette() -> tuple[float, float]:
    """屏幕轮廓的宽与高（像素，1 体素 = 1 像素）。

    与 `packages/render/src/voxel-sprite.ts` 的 2:1 等距投影同一口径：
    `screenX = x − y`、`screenY = (x + y) / 2 − z`。精灵与 3D 两条路都用这个投影，
    所以"和原版看起来一样大"这件事只能用它来判，包围盒各轴尺寸判不了。
    """
    low_x = low_y = float("inf")
    high_x = high_y = float("-inf")
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for vertex in obj.data.vertices:
            world = obj.matrix_world @ vertex.co
            screen_x = world.x - world.y
            screen_y = (world.x + world.y) * 0.5 - world.z
            low_x = min(low_x, screen_x)
            high_x = max(high_x, screen_x)
            low_y = min(low_y, screen_y)
            high_y = max(high_y, screen_y)
    return high_x - low_x, high_y - low_y


def screen_extremes(count: int = 5) -> dict[str, list[tuple[float, tuple[float, float, float]]]]:
    """screenX 两端的极值顶点（值 + 世界坐标），供轮廓宽超标时定位是哪个部件撑的。"""
    points: list[tuple[float, tuple[float, float, float]]] = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for vertex in obj.data.vertices:
            world = obj.matrix_world @ vertex.co
            points.append((world.x - world.y, (world.x, world.y, world.z)))
    points.sort(key=lambda item: item[0])
    return {"min": points[:count], "max": points[-count:][::-1]}


def see_through_bands(low: Vector, high: Vector) -> list[tuple[float, float]]:
    """沿车长方向看，哪些 y 区间没有任何面盖住 —— 那就是侧面能看穿的一条缝。

    按**有符号 y** 打格、按**三角面**的 y 跨度覆盖：面是连续的，顶点的 y 值只在角上，
    只按顶点（更别说先取绝对值）会把整片平面判成空的。
    """
    if high.y <= low.y:
        return []
    step = (high.y - low.y) / RESOLUTION
    bins = numpy.zeros(RESOLUTION, dtype=numpy.int64)
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        mesh.calc_loop_triangles()
        for triangle in mesh.loop_triangles:
            spans = [(obj.matrix_world @ mesh.vertices[index].co).y for index in triangle.vertices]
            first = int((min(spans) - low.y) / (step + 1e-9))
            last = int((max(spans) - low.y) / (step + 1e-9))
            for value in range(max(0, first), min(RESOLUTION - 1, last) + 1):
                bins[value] += 1
    bands: list[tuple[float, float]] = []
    run = 0
    for index in range(RESOLUTION):
        if bins[index] == 0:
            run += 1
            continue
        if run > 0:
            bands.append((low.y + (index - run) * step, low.y + index * step))
            run = 0
    if run > 0:
        bands.append((low.y + (RESOLUTION - run) * step, high.y))
    return bands

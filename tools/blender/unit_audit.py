"""单位模型的共同量法：包围盒、横向能不能看穿。建模、出图、审阅三个脚本共用这一份。

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

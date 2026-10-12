"""按材质分组量单位模型的部件范围，用来审阅"零件在哪、中间留了多宽的缝"。

用法：
    blender.exe -b -P tools/blender/audit-unit-parts.py -- <model.glb> [横向分格数]

输出：整体包围盒、每个材质的包围盒与三角面数、横向（y）的整段空白带。
顶点到材质按"第一个用到它的三角面所在的槽位"归属。
另印两张 ASCII 剪影（正视 y–z、俯视 x–y），用来直接看形体与缝隙。
"""

import sys

import bpy
import numpy

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if not argv:
    print("[审阅] 用法：blender.exe -b -P tools/blender/audit-unit-parts.py -- <model.glb>")
    sys.exit(0)

model_path = argv[0]
bins_count = int(argv[1]) if len(argv) > 1 else 64

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=model_path)


def new_extent() -> list[float]:
    return [float("inf"), float("inf"), float("inf"), float("-inf"), float("-inf"), float("-inf")]


def extend(extent: list[float], point) -> None:
    for axis in range(3):
        extent[axis] = min(extent[axis], point[axis])
        extent[axis + 3] = max(extent[axis + 3], point[axis])


whole = new_extent()
per_material: dict[str, list[float]] = {}
triangles_by_material: dict[str, int] = {}
bins = numpy.zeros(bins_count, dtype=numpy.int64)

for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    mesh = obj.data
    mesh.calc_loop_triangles()
    slot_of_vertex: dict[int, int] = {}
    for triangle in mesh.loop_triangles:
        material = mesh.materials[triangle.material_index] if triangle.material_index < len(mesh.materials) else None
        name = material.name if material else "(无材质)"
        triangles_by_material[name] = triangles_by_material.get(name, 0) + 1
        for vertex_index in triangle.vertices:
            slot_of_vertex.setdefault(vertex_index, triangle.material_index)
    for vertex in mesh.vertices:
        world = obj.matrix_world @ vertex.co
        extend(whole, world)
        slot = slot_of_vertex.get(vertex.index, 0)
        material = mesh.materials[slot] if slot < len(mesh.materials) else None
        name = material.name if material else "(无材质)"
        extend(per_material.setdefault(name, new_extent()), world)

width = whole[4] - whole[1]
half_width = width / 2
for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    for vertex in obj.data.vertices:
        world = obj.matrix_world @ vertex.co
        bins[min(bins_count - 1, int(abs(world[1]) / (half_width + 1e-6) * (bins_count - 1)))] += 1

print(
    f"[审阅] 整体：X={whole[3] - whole[0]:.2f} Y={width:.2f} Z={whole[5] - whole[2]:.2f}，"
    f"min=({whole[0]:.2f},{whole[1]:.2f},{whole[2]:.2f})"
)
print("[审阅] 部件：")
for name in sorted(per_material):
    extent = per_material[name]
    print(
        f"  {name:12s} y {extent[1]:+7.2f}..{extent[4]:+7.2f}"
        f"  z {extent[2]:+6.2f}..{extent[5]:+6.2f}"
        f"  x {extent[0]:+7.2f}..{extent[3]:+7.2f}"
        f"  三角 {triangles_by_material.get(name, 0)}"
    )

step = half_width / (bins_count - 1)
runs: list[tuple[int, int]] = []
for index in [index for index, count in enumerate(bins[1:-1], start=1) if count == 0]:
    if runs and runs[-1][1] == index - 1:
        runs[-1] = (runs[-1][0], index)
    else:
        runs.append((index, index))
if runs:
    widest = max(runs, key=lambda run: run[1] - run[0])
    print(
        f"[审阅] 横向空带 {len(runs)} 段，最大 |y| = {widest[0] * step:.2f}..{widest[1] * step:.2f}"
        f"（宽 {(widest[1] - widest[0] + 1) * step:.2f}）"
    )
else:
    print("[审阅] 横向没有整段空白")


def silhouette(title: str, horizontal: int, vertical: int, columns: int, rows: int) -> None:
    """把三角面的包围盒打进一张格子图：`#` = 有实体，`.` = 空。"""
    grid = [["." for _ in range(columns)] for _ in range(rows)]
    span_h = whole[horizontal + 3] - whole[horizontal]
    span_v = whole[vertical + 3] - whole[vertical]
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        for triangle in mesh.loop_triangles:
            points = [obj.matrix_world @ mesh.vertices[index].co for index in triangle.vertices]
            low_h = min(point[horizontal] for point in points)
            high_h = max(point[horizontal] for point in points)
            low_v = min(point[vertical] for point in points)
            high_v = max(point[vertical] for point in points)
            first_column = int((low_h - whole[horizontal]) / (span_h + 1e-6) * (columns - 1))
            last_column = int((high_h - whole[horizontal]) / (span_h + 1e-6) * (columns - 1))
            first_row = int((low_v - whole[vertical]) / (span_v + 1e-6) * (rows - 1))
            last_row = int((high_v - whole[vertical]) / (span_v + 1e-6) * (rows - 1))
            for row in range(first_row, last_row + 1):
                for column in range(first_column, last_column + 1):
                    grid[rows - 1 - row][column] = "#"
    print(f"[审阅] {title}（{columns}×{rows}）")
    for line in grid:
        print("    " + "".join(line))


silhouette("正视剪影 y–z（口径：宽=Y）", 1, 2, 64, 20)
silhouette("俯视剪影 x–y（口径：左=车头）", 0, 1, 64, 24)


def height_profile(bands: int = 17) -> None:
    """按高度分带报"这一带有多宽、占多满"，用来对齐各段的体量比例。"""
    step = (whole[5] - whole[2]) / bands
    profile = [[float("inf"), float("-inf"), 0] for _ in range(bands)]
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        mesh.calc_loop_triangles()
        for triangle in mesh.loop_triangles:
            points = [obj.matrix_world @ mesh.vertices[index].co for index in triangle.vertices]
            band_low = max(0, int((min(point[2] for point in points) - whole[2]) / (step + 1e-6)))
            band_high = min(bands - 1, int((max(point[2] for point in points) - whole[2]) / (step + 1e-6)))
            for band in range(band_low, band_high + 1):
                profile[band][0] = min(profile[band][0], min(point[1] for point in points))
                profile[band][1] = max(profile[band][1], max(point[1] for point in points))
                profile[band][2] += 1
    print("[审阅] 高度分带（z 段：y 范围 / 三角面数）")
    for band in range(bands - 1, -1, -1):
        low_z = whole[2] + band * step
        entry = profile[band]
        print(
            f"    z {low_z:5.1f}..{low_z + step:5.1f}  y {entry[0]:+6.2f}..{entry[1]:+6.2f}"
            f"  三角 {entry[2]}"
        )


height_profile()


def face_probe(axis: int = 0, columns: int = 56, rows: int = 20) -> None:
    """沿 +axis 反方向打射线，印出"从这一侧看到的第一层是什么材质"。

    用来分辨"这块黑是黑材质"还是"这其实看到的是内部/凹槽"。
    """
    mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    across = (axis + 1) % 3
    up = (axis + 2) % 3
    names = sorted({mat.name for obj in mesh_objects for mat in obj.data.materials if mat})
    letter_of = {name: "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[index] for index, name in enumerate(names)}
    start = whole[axis + 3] + 1.0
    print(f"[审阅] 沿 {'XYZ'[axis]} 反向看第一层（每个字母一个材质）")
    for row in range(rows - 1, -1, -1):
        line = []
        for column in range(columns):
            origin = Vector((0.0, 0.0, 0.0))
            origin[across] = whole[across] + (column + 0.5) / columns * (whole[across + 3] - whole[across])
            origin[up] = whole[up] + (row + 0.5) / rows * (whole[up + 3] - whole[up])
            origin[axis] = start
            direction = Vector((0.0, 0.0, 0.0))
            direction[axis] = -1.0
            nearest: tuple[float, str] | None = None
            for obj in mesh_objects:
                inverse = obj.matrix_world.inverted()
                hit, location, _normal, index = obj.ray_cast(inverse @ origin, (inverse.to_3x3() @ direction).normalized())
                if not hit:
                    continue
                world_distance = (obj.matrix_world @ location - origin).length
                slot = obj.data.polygons[index].material_index
                material = obj.data.materials[slot] if slot < len(obj.data.materials) else None
                if nearest is None or world_distance < nearest[0]:
                    nearest = (world_distance, letter_of.get(material.name if material else "", "?"))
            line.append(nearest[1] if nearest else ".")
        print("    " + "".join(line))
    print("    " + " ".join(f"{letter_of[name]}={name}" for name in names))


face_probe()

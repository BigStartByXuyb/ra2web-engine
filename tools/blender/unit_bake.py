"""写实打样线（轨道 2 v2）的烘焙共用件：放笼成型 + 跨件 UV 打包 + 烘焙上色 + 分件导出。

引擎只读 baseColorTexture（docs/ENGINE-UNIT3D.md 材质通道口径），所以 normal/AO
的质感全部烧进颜色里：平铺底图 × 几何 AO × 棱边磨损裸金属 → Cycles EMIT 烘焙。
形状脚本只 import 这一份，与 unit_build.py（基础体/自检/导出）配套。

分件（2026-10-12 总工 P0）：模型必须 root/hull/turret/barrel 四节点，炮塔绕炮塔环
独立转向、炮管绕耳轴俯仰。桶按部件名前缀分，没命中前缀的一律归 hull。
"""

import os

import bpy
from mathutils import Matrix, Vector


def add_loft(name, sections, material, bevel=0.0, subsurf=2):
    """放笼成型：沿 X 给一串截面环 `(x, [(y, z), ...])`，蒙面 + 两端 ngon 封口。

    这是"铸造感"的来源：粗笼上 Subsurf（默认 2 级）+ 平滑着色。炮塔那种圆润
    过渡的曲面用锥台/棱柱拼不出来 —— 拼出来永远是方块感。
    """
    import bmesh

    ring_size = len(sections[0][1])
    if any(len(ring) != ring_size for _, ring in sections):
        raise ValueError(f"{name}: 各截面环点数不一致")
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = [[bm.verts.new((x, y, z)) for y, z in ring] for x, ring in sections]
    for first, second in zip(rings, rings[1:]):
        for index in range(ring_size):
            bm.faces.new(
                (
                    first[index],
                    first[(index + 1) % ring_size],
                    second[(index + 1) % ring_size],
                    second[index],
                )
            )
    bm.faces.new(tuple(rings[0]))
    bm.faces.new(tuple(reversed(rings[-1])))
    bm.to_mesh(mesh)
    bm.free()
    # 与 primitive 建的部件一致地挂一层 UV：没有这层的话，join 之后放笼面的 UV
    # 会停在默认角 (0,1)，烘焙和引擎采样全落在黑区
    mesh.uv_layers.new(name="UVMap")
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(material)
    # 修改器顺序不能反：先倒角粗模（只软化截面棱角）、再 Subsurf 抹圆——
    # 反过来的话 Bevel 会落在细分后的密格上，把整个曲面缝成"绗缝"凸点
    if bevel > 0:
        modifier = obj.modifiers.new("bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
    if subsurf > 0:
        modifier = obj.modifiers.new("subsurf", "SUBSURF")
        modifier.levels = subsurf
        modifier.render_levels = subsurf
    return obj


def join_buckets(buckets: dict[str, tuple[str, ...]]) -> dict[str, "bpy.types.Object"]:
    """按名字前缀把场景部件分桶，各自应用修改器并合并成单件，桶名即导出节点名。

    buckets: {桶名: (前缀, ...)}；没命中任何桶前缀的部件归入 "hull"。
    """
    import math

    groups: dict[str, list] = {name: [] for name in buckets}
    groups.setdefault("hull", [])
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for name, prefixes in buckets.items():
            if obj.name.startswith(prefixes):
                groups[name].append(obj)
                break
        else:
            groups["hull"].append(obj)
    built: dict[str, "bpy.types.Object"] = {}
    for name, members in groups.items():
        if not members:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in members:
            bpy.context.view_layer.objects.active = obj
            while obj.modifiers:
                bpy.ops.object.modifier_apply(modifier=obj.modifiers[0].name)
            obj.select_set(True)
        bpy.context.view_layer.objects.active = members[0]
        bpy.ops.object.join()
        unit = bpy.context.active_object
        unit.name = name
        unit.data.name = name
        # shade_auto_smooth 依赖自带 "Smooth by Angle" 资产，便携版缺失会直接抛错；
        # 平滑面 + 32° EdgeSplit 是同一观感的确定性做法，导出时 export_apply 应用
        for polygon in unit.data.polygons:
            polygon.use_smooth = True
        split = unit.modifiers.new("edge_split", "EDGE_SPLIT")
        split.split_angle = math.radians(32)
        built[name] = unit
    return built


def pack_material_uvs(units, cube_size_overrides: dict[str, float] | None = None) -> None:
    """跨件给每个贴图材质分不重叠 UV 格：材质一格，格内按"用到它的件"再切条。

    多件共享同一份材质贴图，同一材质在不同件上的岛必须互不叠。立方投影与
    pack_islands 逐（件×材质）做，最后把各件的 UV 重映射进自己的条带。
    `cube_size_overrides` 按件名给立方投影密度（体素/张）：大块光滑面调大，
    平铺底图的板缝/磨损频率就降低（炮塔顶凸点的解法）。
    """
    import math

    from unit_build import CUBE_SIZE, TEXTURED

    overrides = cube_size_overrides or {}
    members: dict[str, list] = {}
    for unit in units:
        for slot, material in enumerate(unit.data.materials):
            if material is not None and material.name in TEXTURED:
                members.setdefault(material.name, []).append((unit, slot))
    names = sorted(members)
    columns = max(1, math.ceil(math.sqrt(len(names))))
    rows = max(1, math.ceil(len(names) / columns))
    for cell, name in enumerate(names):
        holders = members[name]
        column, row = cell % columns, cell // columns
        cell_x, cell_y = column / columns, row / rows
        cell_w, cell_h = 1.0 / columns, 1.0 / rows
        strip_h = cell_h / len(holders)
        for strip, (unit, slot) in enumerate(holders):
            cube = overrides.get(unit.name, CUBE_SIZE)
            bpy.context.view_layer.objects.active = unit
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="DESELECT")
            for polygon in unit.data.polygons:
                polygon.select = polygon.material_index == slot
            bpy.ops.uv.cube_project(cube_size=cube)
            bpy.ops.uv.select_all(action="SELECT")
            bpy.ops.uv.pack_islands(margin=0.02)
            bpy.ops.object.mode_set(mode="OBJECT")
            uv_layer = unit.data.uv_layers.active.data
            for polygon in unit.data.polygons:
                if polygon.material_index != slot:
                    continue
                for loop_index in polygon.loop_indices:
                    u, v = uv_layer[loop_index].uv
                    uv_layer[loop_index].uv = (cell_x + u * cell_w, cell_y + (v + strip) * strip_h)
    print(f"[烘焙] 跨件打包 UV：{len(names)} 种贴图材质，排成 {columns}x{rows} 格")


def _build_bake_chain(material, tiled, ao_distance: float, with_wear: bool) -> None:
    """给材质接"平铺底图 × AO × 磨损 → Emission"的临时烘焙链（Surface 指向 Emission）。

    with_wear=False（铸造光滑面专用）：跳过 pointiness 磨损/泥垢——细分网格上
    pointiness 会按面片周期起皱，把控制笼"烤"进颜色里（炮塔顶凸点的真根因）。
    """
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    geometry = nodes.new("ShaderNodeNewGeometry")
    ao = nodes.new("ShaderNodeAmbientOcclusion")
    ao.samples = 16
    # inside=False：外表面按真实遮蔽算（夹缝/轮拱暗、开阔面≈1）。inside=True 会把
    # 密堆部件的外表面也当"腔体内"烘成近黑，整张图就废了。
    ao.inside = False
    ao.only_local = True
    ao.inputs["Distance"].default_value = ao_distance

    source = tiled.outputs["Color"]
    if with_wear:
        # Pointiness：平处 ≈0.5、凸棱 →1、凹槽 →0。凸棱掉漆、凹槽积垢。
        # grime 阈值要收得很窄：subsurf 曲面普遍在 0.45~0.5 的"轻微凹"区，
        # 带宽一点整片曲面都会被涂上暗泥。
        wear = nodes.new("ShaderNodeValToRGB")
        wear.color_ramp.elements[0].position = 0.55
        wear.color_ramp.elements[0].color = (0, 0, 0, 1)
        wear.color_ramp.elements[1].position = 0.66
        wear.color_ramp.elements[1].color = (1, 1, 1, 1)
        grime = nodes.new("ShaderNodeValToRGB")
        grime.color_ramp.elements[0].position = 0.33
        grime.color_ramp.elements[0].color = (1, 1, 1, 1)
        grime.color_ramp.elements[1].position = 0.45
        grime.color_ramp.elements[1].color = (0, 0, 0, 1)
        links.new(geometry.outputs["Pointiness"], wear.inputs["Fac"])
        links.new(geometry.outputs["Pointiness"], grime.inputs["Fac"])

        # 掉漆色 = 底图提亮压饱和（裸金属比漆面亮、色相偏灰）
        bare = nodes.new("ShaderNodeMixRGB")
        bare.blend_type = "MULTIPLY"
        bare.inputs["Color2"].default_value = (1.55, 1.5, 1.45, 1.0)
        links.new(tiled.outputs["Color"], bare.inputs["Color1"])
        links.new(wear.outputs["Color"], bare.inputs["Fac"])

        grime_dark = nodes.new("ShaderNodeMixRGB")
        grime_dark.blend_type = "MIX"
        # 泥垢色取浅一些（0.16 会把大片"轻微凹"面吞成近黑）
        grime_dark.inputs["Color1"].default_value = (0.38, 0.36, 0.32, 1.0)
        links.new(bare.outputs["Color"], grime_dark.inputs["Color2"])
        links.new(grime.outputs["Color"], grime_dark.inputs["Fac"])
        source = grime_dark.outputs["Color"]

    shaded = nodes.new("ShaderNodeMixRGB")
    shaded.blend_type = "MULTIPLY"
    shaded.inputs["Fac"].default_value = 1.0
    links.new(source, shaded.inputs["Color1"])
    # AO 提亮 60% 再乘：AO 全量乘会把密堆部件的外表面压得过黑，
    # 提亮后保留梯度（夹缝仍暗、开阔面接近原色）
    lift = nodes.new("ShaderNodeMixRGB")
    lift.blend_type = "MIX"
    lift.inputs["Fac"].default_value = 0.6
    lift.inputs["Color1"].default_value = (1.0, 1.0, 1.0, 1.0)
    links.new(ao.outputs["Color"], lift.inputs["Color2"])
    links.new(lift.outputs["Color"], shaded.inputs["Color2"])

    emission = nodes.new("ShaderNodeEmission")
    links.new(shaded.outputs["Color"], emission.inputs["Color"])
    output = next(node for node in nodes if node.type == "OUTPUT_MATERIAL")
    links.new(emission.outputs["Emission"], output.inputs["Surface"])


def bake_material_colors(units, out_dir: str, size: int = 512, ao_distance: float = 4.5) -> dict[str, str]:
    """跨件把"平铺底图 × AO × 磨损"烘进每张材质图（Cycles EMIT）。

    材质是跨件共享的 datablock，每张图一个目标节点。烘焙逐（材质×件）做：
    use_clear 会清空所有挂图的活动目标、但只烘活动对象的活跃材质 —— 所以其它
    目标必须先摘掉图，烘完全部装回（不装回的话导出器只能看到最后一张）。
    """
    from unit_build import TEXTURED

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    os.makedirs(out_dir, exist_ok=True)
    written: dict[str, str] = {}

    # 建链：每材质一次（datablock 共享）
    prepared: dict[str, tuple] = {}
    for unit in units:
        for material in unit.data.materials:
            if material is None or material.name in prepared or material.name not in TEXTURED:
                continue
            nodes = material.node_tree.nodes
            links = material.node_tree.links
            principled = next(node for node in nodes if node.type == "BSDF_PRINCIPLED")
            tiled = next(
                (
                    link.from_node
                    for link in links
                    if link.to_node.name == principled.name
                    and link.from_socket.name == "Color"
                    and link.from_node.type == "TEX_IMAGE"
                ),
                None,
            )
            if tiled is None:
                print(f"[烘焙] {material.name} 没有平铺底图节点，跳过")
                continue
            image = bpy.data.images.new(f"{material.name}-baked", size, size, alpha=False)
            image.colorspace_settings.name = "sRGB"
            target = nodes.new("ShaderNodeTexImage")
            target.image = image
            target.name = "BAKE_TARGET"
            # 铸造光滑面（*Cast）跳过 pointiness 磨损：细分网格上会按面片周期起皱
            _build_bake_chain(material, tiled, ao_distance, with_wear=not material.name.endswith("Cast"))
            prepared[material.name] = (material, principled, target, image)

    # 烘焙：逐（材质×件）
    for name in sorted(prepared):
        material, principled, target, image = prepared[name]
        for other_name, (_, _, other_target, _) in prepared.items():
            other_target.image = None
        target.image = image
        # bake 只填 nodes.active 指向的目标节点（旧管线靠它工作）；不设的话
        # use_clear 照样清空、但一张图都不会写进去
        material.node_tree.nodes.active = target
        # use_clear 每轮清整张图：同材质的第二个件开始不能再清，否则前面件的成果被抹掉
        first_pass = True
        for unit in units:
            slots = [index for index, m in enumerate(unit.data.materials) if m is not None and m.name == name]
            if not slots:
                continue
            bpy.ops.object.select_all(action="DESELECT")
            unit.select_set(True)
            bpy.context.view_layer.objects.active = unit
            unit.active_material_index = slots[0]
            bpy.ops.object.bake(type="EMIT", margin=6, use_clear=first_pass, use_selected_to_active=False)
            first_pass = False

        # 烘完收链路：Surface 接回 Principled，Base Color 换成烘焙图。
        # bpy 每次访问节点都返回新包装对象，`is` 比较恒为 False —— 必须按名字比。
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        target = nodes["BAKE_TARGET"]
        output = next(node for node in nodes if node.type == "OUTPUT_MATERIAL")
        links.new(principled.outputs["BSDF"], output.inputs["Surface"])
        links.new(target.outputs["Color"], principled.inputs["Base Color"])
        for link in list(links):
            if (
                link.to_node.name == principled.name
                and link.to_socket.name == "Base Color"
                and link.from_node.name != target.name
            ):
                links.remove(link)
        image.filepath_raw = os.path.join(out_dir, f"{name}.png")
        image.file_format = "PNG"
        image.save()
        written[name] = image.filepath_raw
        print(f"[烘焙] {name} → {image.filepath_raw}")

    # 烘焙时摘掉的其它目标图全部装回：不装回的话导出器只能看到最后一个材质的图
    for _, _, target, image in prepared.values():
        target.image = image
    return written


def finish_and_export_baked(
    out_glb: str,
    reference_low: Vector,
    reference_high: Vector,
    bake_dir: str,
    buckets: dict[str, tuple[str, ...]] | None = None,
    pivots: dict[str, tuple[float, float, float]] | None = None,
    cube_size_overrides: dict[str, float] | None = None,
    reference_glb: str | None = None,
    deck_z: float | None = None,
    bake_size: int = 512,
) -> int:
    """写实线的收口：分件合并 → 跨件 UV 打包 → 烘焙 → 对齐 → 自检 → 枢轴 → 导出。

    buckets 给了就按前缀分件（root/hull/turret/barrel 层级，引擎按节点名做炮塔
    转向与炮管俯仰），不给就合为单件 UNIT。deck_z 给了就检查"炮塔体底 ≥ 炮塔足迹
    内甲板件顶 + 0.30"（P2 配合公差：有炮塔的单位量产通用，甲板件伸进足迹下方必穿插）。
    自检三条与 unit_build.finish_and_export 同一口径：车长、屏幕轮廓、横向看穿缝。
    """
    from unit_build import (
        LENGTH_TOLERANCE,
        MAX_SEE_THROUGH,
        REFERENCE_SILHOUETTE,
        SILHOUETTE_TOLERANCE,
        join_and_smooth,
    )
    from unit_audit import measure, screen_extremes, see_through_bands, silhouette

    # 炮塔-甲板配合公差（分件前按部件名查明——join 后名字就没了）
    clearance_problems: list[str] = []
    if buckets and deck_z is not None:
        turret_prefixes = buckets.get("turret", ())
        turret_parts = [
            obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.name.startswith(turret_prefixes)
        ]
        turret_points = [obj.matrix_world @ vertex.co for obj in turret_parts for vertex in obj.data.vertices]
        body = [point for point in turret_points if point.z >= deck_z]
        if body:
            turret_low = min(point.z for point in body)
            fx = (min(p.x for p in turret_points), max(p.x for p in turret_points))
            fy = (min(p.y for p in turret_points), max(p.y for p in turret_points))
            print(f"[建车] 炮塔配合：足迹 x[{fx[0]:.1f}..{fx[1]:.1f}] y[{fy[0]:.1f}..{fy[1]:.1f}]，体底 z={turret_low:.2f}")
            barrel_prefixes = buckets.get("barrel", ())
            for obj in bpy.context.scene.objects:
                if obj.type != "MESH" or obj.name.startswith(turret_prefixes) or obj.name.startswith(barrel_prefixes):
                    continue
                points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
                top = max(point.z for point in points)
                if top <= deck_z:
                    continue
                if max(point.x for point in points) < fx[0] or min(point.x for point in points) > fx[1]:
                    continue
                if max(point.y for point in points) < fy[0] or min(point.y for point in points) > fy[1]:
                    continue
                gap = turret_low - top
                mark = "  ← 低于 0.30" if gap < 0.3 - 1e-6 else ""
                print(f"[建车] 炮塔配合：{obj.name:<16} 顶 z={top:.2f}  间隙 {gap:+.2f}{mark}")
                if gap < 0.3 - 1e-6:
                    clearance_problems.append(f"炮塔配合：{obj.name} 顶 z={top:.2f} 低于炮塔体底 {turret_low:.2f} 不足 0.30")

    if buckets:
        built = join_buckets(buckets)
        units = [built[name] for name in ("hull", "turret", "barrel") if name in built]
    else:
        built = {}
        units = [join_and_smooth()]
    pack_material_uvs(units, cube_size_overrides)
    bake_material_colors(units, bake_dir, size=bake_size)

    # 对齐整体包围盒并把旋转/缩放烘进顶点：join 会继承首个部件的物体旋转，不烘的
    # 话旋转挂在导出节点上，而引擎 readGlb 不认 nodes 变换 —— 实机整车低头 7.8°
    low, high = measure()
    for unit in units:
        unit.location.x += (reference_low.x + reference_high.x) / 2 - (low.x + high.x) / 2
        unit.location.y += (reference_low.y + reference_high.y) / 2 - (low.y + high.y) / 2
        unit.location.z += reference_low.z - low.z
    bpy.ops.object.select_all(action="DESELECT")
    for unit in units:
        unit.select_set(True)
    bpy.context.view_layer.objects.active = units[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    low, high = measure()
    size = high - low

    problems: list[str] = list(clearance_problems)
    reference_size = reference_high - reference_low
    if abs(size.x - reference_size.x) > LENGTH_TOLERANCE:
        problems.append(f"车长 {size.x:.2f} 偏离参考 {reference_size.x:.2f}（上限 {LENGTH_TOLERANCE}）")
    if REFERENCE_SILHOUETTE is not None:
        width, height = silhouette()
        # 炮管比参考长是已知差（车长 ±9）：等距屏高随车长线性涨（两端各 Δx/2），
        # 期望值按长度补偿，不补偿的话加长炮管会被误判"变高了"
        length_delta = max(0.0, size.x - reference_size.x)
        expected_height = REFERENCE_SILHOUETTE[1] + length_delta * 0.5
        for label, got, want in (
            ("屏幕轮廓宽", width, REFERENCE_SILHOUETTE[0]),
            ("屏幕轮廓高", height, expected_height),
        ):
            if abs(got - want) > SILHOUETTE_TOLERANCE:
                problems.append(f"{label} {got:.2f} 偏离参考 {want:.2f}")
                if label.endswith("宽"):
                    for end, extremes in screen_extremes().items():
                        for value, (px, py, pz) in extremes:
                            print(f"[建车] 轮廓{end}端 screenX={value:.2f} @ ({px:.1f}, {py:.1f}, {pz:.1f})")
    bands = see_through_bands(low, high)
    band = max((end - start for start, end in bands), default=0.0)
    if band > MAX_SEE_THROUGH:
        problems.append(f"横向最长看穿缝 {band:.2f} 过宽，车体与行走部分没接上")

    # 分层剖面对照（总工 P1 加码）：与 voxel 参考逐 z 带比 |y|90 半宽——
    # 甲板没抬高、炮塔基座塌了，在这里直接显形，不再靠眼睛
    if reference_glb:
        import numpy

        kept = set(bpy.context.scene.objects)

        def width_profile(objs) -> "list[float]":
            # 按面片质心的 z 落格、面的 |y| 极值计宽：顶点采样会被"盒子侧面只有角点"
            # 的细分密度骗到（大片侧壁的中段一格都采不到）
            zs, ys = [], []
            for obj in objs:
                mesh = obj.data
                matrix = obj.matrix_world
                for polygon in mesh.polygons:
                    world_center = matrix @ polygon.center
                    zs.append(world_center.z)
                    ys.append(max(abs((matrix @ mesh.vertices[vi].co).y) for vi in polygon.vertices))
            zarr, yarr = numpy.array(zs), numpy.array(ys)
            profile = []
            for index in range(12):
                a = low.z + (high.z - low.z) * index / 12
                b = low.z + (high.z - low.z) * (index + 1) / 12
                mask = (zarr >= a) & (zarr < b)
                profile.append(float(numpy.percentile(yarr[mask], 90)) if mask.any() else 0.0)
            return profile

        bpy.ops.import_scene.gltf(filepath=reference_glb)
        ref_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj not in kept]
        ref_profile = width_profile(ref_meshes)
        for obj in ref_meshes:
            bpy.data.objects.remove(obj, do_unlink=True)
        my_profile = width_profile(units)
        deviation = float(numpy.abs(numpy.array(ref_profile) - numpy.array(my_profile)).mean())
        for index in range(12):
            mark = "" if abs(ref_profile[index] - my_profile[index]) <= 2.0 else "  ← 超 2"
            print(
                f"[建车] 剖面 z≈{low.z + (high.z - low.z) * (index + 0.5) / 12:5.1f}"
                f"  参考|y|90={ref_profile[index]:5.1f}  本模={my_profile[index]:5.1f}{mark}"
            )
        print(f"[建车] 分层剖面平均偏差 {deviation:.2f} 体素")
        if deviation > 2.0:
            problems.append(f"分层剖面平均偏差 {deviation:.2f} 体素（>2.0）：层结构和参考对不上")

    triangles = 0
    for unit in units:
        unit.data.calc_loop_triangles()
        triangles += len(unit.data.loop_triangles)
    print(
        f"[建车] 尺寸 {size.x:.2f}x{size.y:.2f}x{size.z:.2f}，最低点 {low.z:.2f}，"
        f"三角面 {triangles}，分件 {len(units)}"
    )
    if problems:
        print("[建车] 自检不通过，未导出：")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    # 分件枢轴：件数据平移到枢轴局部、节点挂枢轴平移；root 空物体当贴地原点。
    # barrel 挂在 turret 下（俯仰随塔走），节点平移相对父级。
    if buckets and pivots:
        for name, pivot in pivots.items():
            unit = built.get(name)
            if unit is None:
                continue
            unit.data.transform(Matrix.Translation(-Vector(pivot)))
            unit.location = pivot
        root = bpy.data.objects.new("root", None)
        bpy.context.scene.collection.objects.link(root)
        for name in ("hull", "turret", "barrel"):
            unit = built.get(name)
            if unit is None:
                continue
            if name == "barrel" and "turret" in built:
                unit.parent = built["turret"]
                unit.location = unit.location - built["turret"].location
            else:
                unit.parent = root
        print(f"[建车] 层级 root → {' / '.join(built)}")

    bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", export_apply=True, use_selection=False)
    print(f"[建车] 已导出 {out_glb}")
    return 0

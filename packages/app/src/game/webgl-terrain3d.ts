import {
  landTypeOfTerrainType,
  loadTheaterPalette,
  openTheater,
  type LandTypeName,
  type TheaterAssets,
} from '@ra2web/assets'
import type { Camera } from './camera.js'
import { viewScale } from './camera.js'
import type { MapPreview } from './map-preview.js'
import type { MapCell } from '@ra2web/formats'
import { buildTerrain3dGeometry, type Terrain3dVertexData } from './terrain3d-geometry.js'
import {
  fallbackMaterial,
  sampleTerrainMaterials,
  waterFrameAlbedos,
  type MaterialSampleInput,
  type WaterFrameInput,
} from './terrain3d-materials.js'
import { TERRAIN_Z_STEP_PX } from './terrain3d-zstep.js'

/**
 * 地貌线任务 1：terrain3d 的 GL 渲染层 —— 程序化 PBR 地形（本项目自定观感）。
 *
 * 场景工厂把"剧场采样 + 几何构建"封在**首次装载**里（WeakMap 按地图缓存，同图复用），
 * 每帧只剩一次 useProgram + drawArrays。投影与 `webgl-unit3d.ts` 同一套仿射
 * （screenX = x − y、screenY = (x + y)/2 − z），三条渲染路不跳位。
 */

export interface Terrain3dScene {
  /** waterFrame = 原版水面动画当前帧（`waterFrameAt` 同一口径；缺省 0 = 静止）。 */
  render(camera: Camera, viewportWidth: number, viewportHeight: number, waterFrame?: number): void
}

/** 同一张地图只构建一次几何与采样；换图换键，自然重建。 */
const sceneCache = new WeakMap<MapPreview, Terrain3dScene>()

export function createTerrain3dScene(
  gl: WebGLRenderingContext,
  preview: MapPreview,
  archiveBytes: Uint8Array | undefined,
  theaterName: string | undefined,
): Terrain3dScene | undefined {
  const cached = sceneCache.get(preview)
  if (cached) return cached
  if (!archiveBytes || !theaterName) return undefined
  const theater = openTheater(archiveBytes, theaterName)
  const palette = loadTheaterPalette(archiveBytes, theaterName, 'iso')
  if (!theater || !palette) return undefined
  const materials = sampleTerrainMaterials(theaterSubTiles(theater), palette)
  const geometry = buildTerrain3dGeometry(
    preview,
    TERRAIN_Z_STEP_PX,
    (x, y) => landTypeAt(preview, theater, x, y),
    materials,
    (x, y) => cliffKindAt(preview, theater, x, y),
    (x, y) => rampTypeAt(preview, theater, x, y),
  )
  // 水面帧色表（任务 3）：WaterSet 逐帧地块真实像素 → 逐帧 albedo；缺集/缺帧走静态 Water 采样色
  const frameInputs: WaterFrameInput[] = []
  if (preview.water) {
    for (let index = 0; index < preview.water.count; index++) {
      frameInputs.push({ pixelIndices: tilePixels(theater.loadTile(preview.water.start + index)) })
    }
  }
  const waterTable = waterFrameAlbedos(frameInputs, palette)
  const waterFallback = materials.get('Water')?.albedo ?? fallbackMaterial().albedo
  const render = createTerrain3dRenderer(gl, geometry, { table: waterTable, fallback: waterFallback })
  if (!render) return undefined
  const scene: Terrain3dScene = { render }
  sceneCache.set(preview, scene)
  return scene
}

/** 剧场全部子块喂给采样器：遍历全局地块表 → 每个非空子块的 terrainType 与像素索引。 */
function* theaterSubTiles(theater: TheaterAssets): Iterable<MaterialSampleInput> {
  for (let index = 0; index < theater.ini.tiles.length; index++) {
    const tile = theater.loadTile(index)
    if (!tile) continue
    for (const sub of tile.subTiles) {
      if (sub.isEmpty) continue
      const cliffSet = theater.isCliffSetTile(index)
      yield { terrainType: sub.terrainType, pixelIndices: sub.pixels, cliffSet }
    }
  }
}

/** 一格的地块类型。缺图（地块集加载失败/子块越界）按 Clear 走 —— 与 2D 路径的 groundCanvas
 * 垫底同一口径（原版客户端对缺图格是硬错误，这里按垫底雪面画，不让画面长出异色补丁；
 * 本项目自定取舍）。art 装上了但 terrainType 未认识才是 'Unknown'（走回退档），不猜。 */
function landTypeAt(
  preview: MapPreview,
  theater: TheaterAssets,
  cellX: number,
  cellY: number,
): LandTypeName | 'Unknown' {
  const cell = preview.cellByIndex.get(cellY * preview.width + cellX)
  if (!cell) return 'Clear'
  const sub = theater.loadTile((cell as MapCell).tileIndex)?.subTiles[(cell as MapCell).subTile]
  if (!sub) return 'Clear'
  return landTypeOfTerrainType(sub.terrainType) ?? 'Unknown'
}

/** 一个地块的全部子块像素拼起来（水面帧采样用；多数是 1×1 单子块）。 */
function tilePixels(tile: { readonly subTiles: readonly { readonly isEmpty: boolean; readonly pixels: Uint8Array }[] } | undefined): Uint8Array {
  if (!tile) return new Uint8Array(0)
  const parts = tile.subTiles.filter((sub) => !sub.isEmpty).map((sub) => sub.pixels)
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const merged = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    merged.set(part, at)
    at += part.length
  }
  return merged
}

/** 一格的坡道类型（任务 2）：TMP 子块 rampType 字节，缺图/越界按 0（非坡道）。 */
function rampTypeAt(preview: MapPreview, theater: TheaterAssets, cellX: number, cellY: number): number {
  const cell = preview.cellByIndex.get(cellY * preview.width + cellX)
  if (!cell) return 0
  const sub = theater.loadTile((cell as MapCell).tileIndex)?.subTiles[(cell as MapCell).subTile]
  return sub?.rampType ?? 0
}

/** 一格的崖集档位（任务 2）：崖壁材质按 CliffSet/WaterCliffs/DestroyableCliffs 分档。 */
function cliffKindAt(
  preview: MapPreview,
  theater: TheaterAssets,
  cellX: number,
  cellY: number,
): ReturnType<TheaterAssets['isCliffSetTile']> {
  const cell = preview.cellByIndex.get(cellY * preview.width + cellX)
  if (!cell) return undefined
  return theater.isCliffSetTile((cell as MapCell).tileIndex)
}

const VERTEX_SHADER = `
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec3 a_albedo;
attribute float a_roughness;
attribute float a_variance;
attribute float a_topZ;
attribute float a_waterFlag;
uniform vec2 u_camera;
uniform float u_scale;
uniform vec2 u_viewport;
varying vec3 v_normal;
varying vec3 v_albedo;
varying float v_roughness;
varying float v_variance;
varying vec2 v_world;
varying float v_z;
varying float v_topZ;
varying float v_water;
void main() {
  // 地形顶点已经是**世界系**（worldX、真实 worldY、抬升 z）—— 与 buildTerrainMesh 的等距
  // 世界坐标同源，直接 (x, y − z) 落屏。不能照抄 webgl-unit3d 的格空间变换 (x−y, (x+y)/2−z)：
  // 那套的输入是"格坐标"，套在世界系顶点上会把整片地形投散（实测除一小块水外全黑）。
  vec2 world = vec2(a_position.x, a_position.y - a_position.z);
  vec2 pixel = (world - u_camera) * u_scale;
  gl_Position = vec4(pixel.x / u_viewport.x * 2.0 - 1.0, 1.0 - pixel.y / u_viewport.y * 2.0, 0.0, 1.0);
  v_normal = a_normal;
  v_albedo = a_albedo;
  v_roughness = a_roughness;
  v_variance = a_variance;
  v_world = a_position.xy;
  v_z = a_position.z;
  v_topZ = a_topZ;
  v_water = a_waterFlag;
}`

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec2 u_noiseSeed;
varying vec3 v_normal;
varying vec3 v_albedo;
varying float v_roughness;
varying float v_variance;
varying vec2 v_world;
varying float v_z;
varying float v_topZ;
varying float v_water;
uniform vec3 u_waterColor;
uniform float u_waterFrame;
float hash(vec2 p) {
  return fract(sin(dot(p + u_noiseSeed, vec2(127.1, 311.7))) * 43758.5453);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 s = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), s.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), s.x), s.y);
}
void main() {
  // 两个倍频的值噪声把整片同色地面打碎成有颗粒的泥泞/雪层质感（本项目自定）
  float noise = valueNoise(v_world * 0.05) * 0.65 + valueNoise(v_world * 0.21) * 0.35;
  vec3 albedo = v_albedo + (noise - 0.5) * 2.0 * v_variance;
  vec3 normal = normalize(v_normal);
  // 墙面岩理（本项目自定，任务 2）：沿墙走向的竖向条纹 + 距崖顶约一级内的接触带压暗
  float wallMask = 1.0 - smoothstep(0.5, 0.9, abs(normal.z));
  float along = dot(v_world, vec2(-normal.y, normal.x));
  float stripe = valueNoise(vec2(along * 0.12, v_z * 0.3));
  albedo *= mix(1.0, 0.8 + 0.3 * stripe, wallMask);
  float dropBelowTop = v_topZ - v_z;
  albedo *= mix(1.0, mix(0.72, 1.0, smoothstep(0.0, 10.0, dropBelowTop)), wallMask);
  // 水面（任务 3，本项目自定）：帧号驱动波纹相位——帧不动画面即静止；
  // 基色取原版该帧地块的真实采样色，菲涅尔边缘提亮，高光由 roughness 0.12 走主光照链
  if (v_water > 0.5) {
    vec2 ripple = vec2(sin(v_world.y * 0.35 + u_waterFrame * 0.9), cos(v_world.x * 0.31 + u_waterFrame * 1.1));
    normal = normalize(vec3(ripple.x * 0.12, ripple.y * 0.12, 1.0));
    albedo = u_waterColor;
    albedo += vec3(pow(1.0 - max(0.0, dot(normal, normalize(vec3(1.0, 1.0, 1.0)))), 2.0) * 0.35);
  }
  vec3 light = normalize(vec3(-0.25, 0.42, 0.87));
  vec3 view = normalize(vec3(1.0, 1.0, 1.0));
  float lambert = max(0.0, dot(normal, light));
  float shine = mix(8.0, 96.0, 1.0 - v_roughness);
  vec3 halfVector = normalize(light + view);
  float specular = pow(max(0.0, dot(normal, halfVector)), shine) * (1.0 - v_roughness);
  vec3 color = albedo * (0.35 + 0.65 * lambert) + vec3(specular * 0.5);
  gl_FragColor = vec4(color, 1.0);
}`

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | undefined {
  const shader = gl.createShader(type)
  if (!shader) return undefined
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[terrain3d]', gl.getShaderInfoLog(shader))
    return undefined
  }
  return shader
}

/** 顶点属性步长 52 字节 = pos(3) + normal(3) + albedo(3) + roughness(1) + variance(1) + topZ(1) + waterFlag(1)。 */
function createTerrain3dRenderer(
  gl: WebGLRenderingContext,
  geometry: Terrain3dVertexData,
  water: { table: readonly (readonly [number, number, number] | undefined)[]; fallback: readonly [number, number, number] },
): ((camera: Camera, viewportWidth: number, viewportHeight: number, waterFrame: number) => void) | undefined {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (!vertex || !fragment) return undefined
  const program = gl.createProgram()
  if (!program) return undefined
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[terrain3d]', gl.getProgramInfoLog(program))
    return undefined
  }
  const buffer = gl.createBuffer()
  if (!buffer) return undefined
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices, gl.STATIC_DRAW)
  const positionLocation = gl.getAttribLocation(program, 'a_position')
  const normalLocation = gl.getAttribLocation(program, 'a_normal')
  const albedoLocation = gl.getAttribLocation(program, 'a_albedo')
  const roughnessLocation = gl.getAttribLocation(program, 'a_roughness')
  const varianceLocation = gl.getAttribLocation(program, 'a_variance')
  const topZLocation = gl.getAttribLocation(program, 'a_topZ')
  const waterFlagLocation = gl.getAttribLocation(program, 'a_waterFlag')
  const waterColorUniform = gl.getUniformLocation(program, 'u_waterColor')
  const waterFrameUniform = gl.getUniformLocation(program, 'u_waterFrame')
  const cameraLocation = gl.getUniformLocation(program, 'u_camera')
  const scaleLocation = gl.getUniformLocation(program, 'u_scale')
  const viewportLocation = gl.getUniformLocation(program, 'u_viewport')
  const noiseSeedLocation = gl.getUniformLocation(program, 'u_noiseSeed')
  return (camera, viewportWidth, viewportHeight, waterFrame) => {
    gl.useProgram(program)
    gl.uniform2f(cameraLocation, camera.x, camera.y)
    gl.uniform1f(scaleLocation, viewScale(camera))
    gl.uniform2f(viewportLocation, viewportWidth, viewportHeight)
    // 固定种子：两次运行必须逐像素一致（UI 用例红线），不许用时间种子
    gl.uniform2f(noiseSeedLocation, 0, 0)
    // 水面当前帧色（任务 3）：帧号只选色表项，不引入时间——帧不动画面即逐像素静止
    let waterColor = water.fallback
    if (water.table.length > 0) {
      let index = ((Math.trunc(waterFrame) % water.table.length) + water.table.length) % water.table.length
      for (let step = 0; step < water.table.length && water.table[index] === undefined; step++) {
        index = (index - 1 + water.table.length) % water.table.length
      }
      waterColor = water.table[index] ?? water.fallback
    }
    gl.uniform3f(waterColorUniform, waterColor[0], waterColor[1], waterColor[2])
    gl.uniform1f(waterFrameUniform, Math.trunc(waterFrame))
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 52, 0)
    gl.enableVertexAttribArray(normalLocation)
    gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 52, 12)
    gl.enableVertexAttribArray(albedoLocation)
    gl.vertexAttribPointer(albedoLocation, 3, gl.FLOAT, false, 52, 24)
    gl.enableVertexAttribArray(roughnessLocation)
    gl.vertexAttribPointer(roughnessLocation, 1, gl.FLOAT, false, 52, 36)
    gl.enableVertexAttribArray(varianceLocation)
    gl.vertexAttribPointer(varianceLocation, 1, gl.FLOAT, false, 52, 40)
    gl.enableVertexAttribArray(topZLocation)
    gl.vertexAttribPointer(topZLocation, 1, gl.FLOAT, false, 52, 44)
    gl.enableVertexAttribArray(waterFlagLocation)
    gl.vertexAttribPointer(waterFlagLocation, 1, gl.FLOAT, false, 52, 48)
    // 地形不透明：关混合整批画；画完恢复 —— 后续倒影/阴影/物体 pass 依赖混合
    gl.disable(gl.BLEND)
    gl.drawArrays(gl.TRIANGLES, 0, geometry.vertexCount)
    gl.enable(gl.BLEND)
  }
}

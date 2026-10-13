import type { Camera } from './camera.js'
import { viewScale } from './camera.js'

/**
 * 真 3D 单位层（B 路）：载入 glTF，用**引擎同一套仿射投影**画出来，材质走简化 PBR。
 *
 * 与 A 路（8 朝向贴条）和原版 VXL 现算共用同一个贴地锚点：模型原点 = 贴地枢轴，
 * 1 单位 = 1 体素 ≈ 1 世界像素；投影式子与精灵完全一致（`screenX = x − y`、
 * `screenY = (x + y)/2 − z`），所以三条路可以逐单位切换而不跳位。
 *
 * 光照取引擎自己的 `DEFAULT_LIGHT` 与 `VIEW_DIRECTION`，金属反射用简化高光近似
 * （真环境反射要等环境层那一档）。
 */

interface Unit3dPrimitive {
  readonly position: WebGLBuffer
  readonly normal: WebGLBuffer
  /** 贴图坐标；模型没有 UV 时 undefined，着色器按"没有贴图"处理 */
  readonly uv: WebGLBuffer | undefined
  readonly index: WebGLBuffer
  readonly texture: WebGLTexture | undefined
  readonly count: number
  /** 索引类型：WebGL1 里 32 位索引要 `OES_element_index_uint`，能用就留 32 位、否则退 16 位 */
  readonly indexType: number
  readonly baseColor: readonly [number, number, number]
  readonly metallic: number
  readonly roughness: number
  /** 分组：0 = 车体（随 hull 旋转），1 = 炮塔（绕炮塔枢轴独立偏转），2 = 炮管（随炮塔 + 俯仰接口） */
  readonly group: 0 | 1 | 2
  /** 本组绕炮塔枢轴的刚体偏移（体素轴）：车体/炮塔 = 0，炮管 = 耳轴相对平移 */
  readonly pivotOffset: readonly [number, number, number]
  /** 本组节点在模型空间里的静止平移（体素轴）：炮塔 = 枢轴，炮管 = 枢轴 + 耳轴偏移 */
  readonly nodeOffset: readonly [number, number, number]
}

export interface Unit3dModel {
  readonly typeId: string
  readonly primitives: readonly Unit3dPrimitive[]
  /** 模型在体素空间里的高度，做视野裁剪用 */
  readonly height: number
}

export interface Unit3dDraw {
  readonly model: Unit3dModel
  /** 贴地锚点的世界坐标（像素） */
  readonly worldX: number
  readonly worldY: number
  /** 车体朝向弧度（与 `rotateVoxels` 同一约定） */
  readonly facing: number
  /** 炮塔朝向弧度（相对车体的偏转，着色器约定与 facing 同向）；缺省 0 = 与车体同向 */
  readonly turretFacing?: number | undefined
  /** 炮管俯仰弧度（绕耳轴，正 = 抬）；缺省 0（接口预留，sim 俯仰口径未落地） */
  readonly barrelPitch?: number | undefined
}

/** 倒影参数：关于贴地线翻转、压扁、抬高，并整体变淡 */
export interface Unit3dMirror {
  readonly groundY: number
  readonly squash: number
  readonly alpha: number
}

export interface Unit3dRenderer {
  readonly ready: boolean
  draw(camera: Camera, draws: readonly Unit3dDraw[], mirror?: Unit3dMirror): void
}

const VERTEX_SHADER = `
attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_uv;
uniform vec2 u_origin;
uniform float u_facing;
uniform vec2 u_camera;
uniform float u_scale;
uniform vec2 u_viewport;
// 倒影：贴地线与压扁比例。压扁比例 0 表示正常画物体（不是倒影）。
uniform vec3 u_mirror;
// 炮塔独立偏转（P0）：组 0 = 车体，1 = 炮塔，2 = 炮管。
// u_pivotOffset = 该组绕炮塔枢轴的刚体偏移（体素轴）；u_turretYaw = 相对车体的偏转弧度；
// u_barrelPitch = 炮管俯仰（绕耳轴，接口预留，sim 俯仰口径未落地前恒 0）。
uniform float u_group;
uniform vec3 u_pivotOffset;
uniform vec3 u_nodeOffset;
uniform float u_turretYaw;
uniform float u_barrelPitch;
varying vec3 v_normal;
varying vec2 v_uv;
varying float v_height;
void main() {
  float c = cos(u_facing);
  float s = sin(u_facing);
  vec3 position = a_position;
  vec3 normal = a_normal;
  if (u_group > 0.5) {
    // 炮塔 yaw：绕枢轴（炮塔环中心）在车体平面内偏转。
    // pivotOffset = 枢轴到本组节点原点的刚体偏移；nodeOffset = 本组节点在模型空间的静止平移。
    float ct = cos(u_turretYaw);
    float st = sin(u_turretYaw);
    position.x += u_pivotOffset.x;
    position.y += u_pivotOffset.y;
    position = vec3(position.x * ct - position.y * st, position.x * st + position.y * ct, position.z);
    position.x += u_nodeOffset.x - u_pivotOffset.x;
    position.y += u_nodeOffset.y - u_pivotOffset.y;
    normal = vec3(normal.x * ct - normal.y * st, normal.x * st + normal.y * ct, normal.z);
    if (u_group > 1.5) {
      // 炮管俯仰：绕耳轴（本组原点）在炮管指向平面内抬/压
      float cp = cos(u_barrelPitch);
      float sp = sin(u_barrelPitch);
      float px = position.x;
      float pz = position.z;
      position.x = px * cp - pz * sp;
      position.z = px * sp + pz * cp;
    }
  }
  position = vec3(position.x * c - position.y * s, position.x * s + position.y * c, position.z);
  normal = vec3(normal.x * c - normal.y * s, normal.x * s + normal.y * c, normal.z);
  v_normal = normal;
  v_uv = a_uv;
  // 离地高度：贴地那一圈要压暗（接触阴影），这是"车压在地上"而不是"浮在地面上"的关键
  v_height = position.z;
  // 引擎的精灵投影：screenX = x − y，screenY = (x + y)/2 − z
  vec2 world = u_origin + vec2(position.x - position.y, (position.x + position.y) * 0.5 - position.z);
  // 倒影：关于贴地线翻转，再按"离贴地线的距离"压扁。
  // **不做整体平移**：整体抬一段会把接触点也抬上去，镜像就整个躲进物体后面看不见了
  // （实测抬 4 像素就已经被车身盖住，抬 40 像素则整层露在物体上方）。
  if (u_mirror.z > 0.0) {
    float mirrorY = u_mirror.x;
    world.y = mirrorY + u_mirror.y * (mirrorY - world.y);
  }
  vec2 pixel = (world - u_camera) * u_scale;
  // 深度用"沿视线方向的距离"近似，够在同一单位内部做前后遮挡
  float depth = (position.x + position.y + position.z) / 1024.0;
  gl_Position = vec4(pixel.x / u_viewport.x * 2.0 - 1.0, 1.0 - pixel.y / u_viewport.y * 2.0, 0.5 - depth, 1.0);
}`

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 u_baseColor;
uniform float u_metallic;
uniform float u_roughness;
uniform sampler2D u_texture;
uniform float u_hasTexture;
uniform float u_alpha;
varying vec3 v_normal;
varying vec2 v_uv;
varying float v_height;
void main() {
  vec4 texel = u_hasTexture > 0.5 ? texture2D(u_texture, v_uv) : vec4(1.0);
  // 贴图带透明通道时按贴图裁形（写实素材里常见的铁丝网、迷彩边缘）
  if (u_hasTexture > 0.5 && texel.a < 0.35) discard;
  vec3 albedo = u_baseColor * texel.rgb;
  // 光更偏上方：顶面与两个可见侧面的明暗差要够大，1:1 的几十像素里才有体积感
  vec3 light = normalize(vec3(-0.25, 0.42, 0.87));
  vec3 view = normalize(vec3(1.0, 1.0, 1.0));
  vec3 normal = normalize(v_normal);
  float lambert = max(0.0, dot(normal, light));
  vec3 halfVector = normalize(light + view);
  float shine = mix(8.0, 96.0, 1.0 - u_roughness);
  float specular = pow(max(0.0, dot(normal, halfVector)), shine) * (0.35 + 0.65 * u_metallic);
  vec3 tint = mix(vec3(1.0), albedo, u_metallic);
  // 半球环境光：朝上偏冷、朝下偏暖，法线一动颜色就变 —— 大平面上才有明暗过渡，不然一大片纯色
  vec3 ambient = mix(vec3(0.11, 0.11, 0.10), vec3(0.30, 0.35, 0.44), normal.z * 0.5 + 0.5);
  // 菲涅尔：掠射角补一点天光，边缘自己就"起来"了，这是圆润感的来源之一
  float fresnel = pow(1.0 - max(0.0, dot(normal, view)), 3.0);
  // 金属的环境镜面项：金属的颜色本质是环境反射，只有方向光+半球漫反射时
  // 高金属度部件整体黑掉（实机"黑炭车"根因）。用同一套天色/地色按反射方向
  // 采一份，乘金属色 tint，掠射角加权。
  vec3 reflectDir = reflect(-view, normal);
  vec3 envSample = mix(vec3(0.10, 0.10, 0.09), vec3(0.36, 0.42, 0.52), clamp(reflectDir.z * 0.5 + 0.5, 0.0, 1.0));
  float grazing = pow(1.0 - max(0.0, dot(normal, view)), 4.0);
  vec3 envSpecular = envSample * tint * u_metallic * (0.35 + 2.2 * grazing);
  vec3 color =
    albedo * (ambient + lambert * 0.82) + tint * specular * 0.9 + vec3(0.34, 0.40, 0.50) * fresnel * 0.28 + envSpecular;
  // 接触阴影：贴地 4 体素内渐暗到 0.72，车体、履带与地面的接缝因此"咬"在一起
  color *= mix(0.72, 1.0, clamp(v_height / 4.0, 0.0, 1.0));
  // 预乘 alpha：倒影按 u_alpha 变淡，本体是 1.0
  gl_FragColor = vec4(color * u_alpha, u_alpha);
}`

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | undefined {
  const shader = gl.createShader(type)
  if (!shader) return undefined
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader))
    return undefined
  }
  return shader
}

interface GltfPrimitive {
  readonly position: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array
  readonly normal: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array
  readonly uv: Float32Array | undefined
  readonly indices: Uint16Array | Uint32Array
  readonly baseColor: readonly [number, number, number]
  readonly metallic: number
  readonly roughness: number
  /** 该 primitive 的 baseColor 贴图在 `GltfTextures.textures` 里的下标 */
  readonly textureIndex: number | undefined
  /** 分组：0 = 车体，1 = 炮塔，2 = 炮管（按节点名归类） */
  readonly group: 0 | 1 | 2
  /** 绕炮塔枢轴的刚体偏移（体素轴）：车体 = 0，炮塔 = 0，炮管 = 耳轴相对平移 */
  readonly pivotOffset: readonly [number, number, number]
}

/** GLB 里的一张图（内嵌 bufferView 或 data URI）与它的采样参数。 */
interface GltfImage {
  readonly bytes: Uint8Array
  readonly mimeType: string
}

interface GltfTexture {
  readonly image: number
  readonly wrapS: number
  readonly wrapT: number
}

/**
 * 只认我们自己导出的 GLB：单 buffer、POSITION/NORMAL/[TEXCOORD_0]/indices、pbrMetallicRoughness。
 * 贴图取 `baseColorTexture`（Blender 导出的内嵌图片），采样器缺省按 REPEAT + LINEAR_MIPMAP_LINEAR。
 */
function readGlb(bytes: ArrayBuffer): {
  readonly primitives: readonly GltfPrimitive[]
  readonly images: readonly GltfImage[]
  readonly textures: readonly GltfTexture[]
} {
  const view = new DataView(bytes)
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('不是 GLB 文件')
  let offset = 12
  let json: {
    nodes?: {
      name?: string
      mesh?: number
      children?: number[]
      translation?: number[]
    }[]
    meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[]
    materials?: {
      pbrMetallicRoughness?: {
        baseColorFactor?: number[]
        metallicFactor?: number
        roughnessFactor?: number
        baseColorTexture?: { index: number }
      }
    }[]
    textures?: { source?: number; sampler?: number }[]
    samplers?: { wrapS?: number; wrapT?: number }[]
    images?: { bufferView?: number; mimeType?: string; uri?: string }[]
    accessors?: { bufferView: number; componentType: number; count: number; type: string; byteOffset?: number }[]
    bufferViews?: { byteOffset?: number; byteLength: number; byteStride?: number }[]
    scenes?: { nodes?: number[] }[]
  } = {}
  let binary: Uint8Array | undefined
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true)
    const type = view.getUint32(offset + 4, true)
    const payload = new Uint8Array(bytes, offset + 8, length)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(payload)) as typeof json
    if (type === 0x004e4942) binary = payload
    offset += 8 + length + ((4 - (length % 4)) % 4)
  }
  if (!binary) throw new Error('GLB 里没有二进制块')

  const componentOf = (
    id: number,
  ):
    | Int8ArrayConstructor
    | Uint8ArrayConstructor
    | Int16ArrayConstructor
    | Uint16ArrayConstructor
    | Uint32ArrayConstructor
    | Float32ArrayConstructor => {
    switch (id) {
      case 5120:
        return Int8Array
      case 5121:
        return Uint8Array
      case 5122:
        return Int16Array
      case 5123:
        return Uint16Array
      case 5125:
        return Uint32Array
      default:
        return Float32Array
    }
  }
  const accessor = (
    id: number,
    components: number,
  ): Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array => {
    const entry = json.accessors![id]!
    const bufferView = json.bufferViews![entry.bufferView]!
    const start = (bufferView.byteOffset ?? 0) + (entry.byteOffset ?? 0)
    const ArrayType = componentOf(entry.componentType)
    const values = entry.count * components
    // 拷一份再建视图：这样拿到的一定是普通 ArrayBuffer（也顺手对齐到元素边界）
    return new ArrayType(binary!.slice(start, start + values * ArrayType.BYTES_PER_ELEMENT).buffer)
  }

  /** TEXCOORD 允许 normalized ubyte/ushort，统一换算成 0..1 的 float。 */
  const uvAccessor = (id: number | undefined): Float32Array | undefined => {
    if (id === undefined) return undefined
    const entry = json.accessors![id]!
    const raw = accessor(id, 2)
    if (entry.componentType === 5126) return raw as Float32Array
    const scale = entry.componentType === 5121 ? 255 : entry.componentType === 5123 ? 65535 : 0
    if (scale === 0) return undefined
    const out = new Float32Array(raw.length)
    for (let index = 0; index < raw.length; index++) out[index] = (raw[index] as number) / scale
    return out
  }

  const primitives: GltfPrimitive[] = []
  // 节点层级：把每个含 mesh 的节点归组（hull/turret/barrel），并算出它在模型空间里的
  // 静止偏移（父链 translation 累加，glTF 轴）。件顶点是**节点局部坐标**，渲染时靠
  // nodeOffset 恢复世界位置——不解析 nodes 的旧读法会把炮塔画偏一个枢轴量。
  const meshGroup = new Map<number, { group: 0 | 1 | 2; nodeOffset: [number, number, number] }>()
  const nodeWorld = new Map<number, [number, number, number]>()
  const visit = (nodeIndex: number, parent: [number, number, number]): void => {
    const node = json.nodes?.[nodeIndex]
    if (!node) return
    const t = node.translation ?? [0, 0, 0]
    const world: [number, number, number] = [parent[0] + t[0]!, parent[1] + t[1]!, parent[2] + t[2]!]
    nodeWorld.set(nodeIndex, world)
    if (node.mesh !== undefined) {
      const name = (node.name ?? '').toLowerCase()
      const group: 0 | 1 | 2 = name.includes('turret') ? 1 : name.includes('barrel') ? 2 : 0
      meshGroup.set(node.mesh, { group, nodeOffset: world })
    }
    for (const child of node.children ?? []) visit(child, world)
  }
  for (const root of json.scenes?.[0]?.nodes ?? []) visit(root, [0, 0, 0])

  // 炮塔枢轴（体素轴）= turret 节点的模型空间偏移；炮管随炮塔绕同一枢轴偏转
  const toVoxel = (t: [number, number, number]): [number, number, number] => [t[0]!, -t[2]!, t[1]!]
  let turretPivot: [number, number, number] = [0, 0, 0]
  for (const info of meshGroup.values()) {
    info.nodeOffset = toVoxel(info.nodeOffset)
    if (info.group === 1) turretPivot = info.nodeOffset
  }

  for (const [meshIndex, mesh] of (json.meshes ?? []).entries()) {
    const info = meshGroup.get(meshIndex) ?? { group: 0 as const, nodeOffset: [0, 0, 0] as [number, number, number] }
    // 炮管顶点是耳轴局部坐标：绕炮塔枢轴的刚体偏移 = 节点偏移 − 枢轴
    const pivotOffset: [number, number, number] =
      info.group === 0
        ? [0, 0, 0]
        : [info.nodeOffset[0] - turretPivot[0], info.nodeOffset[1] - turretPivot[1], info.nodeOffset[2] - turretPivot[2]]
    for (const primitive of mesh.primitives) {
      const material = json.materials?.[primitive.material ?? 0]?.pbrMetallicRoughness ?? {}
      const color = material.baseColorFactor ?? [1, 1, 1, 1]
      primitives.push({
        group: info.group,
        pivotOffset,
        position: accessor(primitive.attributes.POSITION!, 3),
        normal: accessor(primitive.attributes.NORMAL!, 3),
        uv: uvAccessor(primitive.attributes.TEXCOORD_0),
        indices: accessor(primitive.indices!, 1) as Uint16Array | Uint32Array,
        baseColor: [color[0] ?? 1, color[1] ?? 1, color[2] ?? 1],
        metallic: material.metallicFactor ?? 0,
        roughness: material.roughnessFactor ?? 1,
        textureIndex: material.baseColorTexture?.index,
      })
    }
  }

  const images: GltfImage[] = (json.images ?? []).flatMap((image) => {
    const mimeType = image.mimeType ?? 'image/png'
    if (image.bufferView !== undefined) {
      const bufferView = json.bufferViews![image.bufferView]!
      const start = bufferView.byteOffset ?? 0
      return [{ bytes: binary!.slice(start, start + bufferView.byteLength), mimeType }]
    }
    if (image.uri?.startsWith('data:')) {
      const comma = image.uri.indexOf(',')
      const head = image.uri.slice(5, comma)
      const payload = image.uri.slice(comma + 1)
      const binaryPart = head.endsWith(';base64')
        ? Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(payload))
      return [{ bytes: binaryPart, mimeType: mimeType }]
    }
    return []
  })

  const textures: GltfTexture[] = (json.textures ?? []).map((texture) => {
    const sampler = (texture.sampler === undefined ? undefined : json.samplers?.[texture.sampler]) ?? {}
    return {
      image: texture.source ?? 0,
      wrapS: sampler.wrapS ?? 10497,
      wrapT: sampler.wrapT ?? 10497,
    }
  })
  return { primitives, images, textures }
}

/** glTF 是 Y-up，引擎的体素空间是 Z-up：换算一次，后面都按 Z-up 用。 */
function toVoxelSpace(source: Float32Array): Float32Array {
  const out = new Float32Array(source.length)
  for (let index = 0; index < source.length; index += 3) {
    out[index] = source[index]!
    out[index + 1] = -source[index + 2]!
    out[index + 2] = source[index + 1]!
  }
  return out
}

export function createUnit3dRenderer(gl: WebGLRenderingContext): Unit3dRenderer {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = vertex && fragment ? gl.createProgram() : undefined
  if (program && vertex && fragment) {
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
  }
  if (!program) return { ready: false, draw: () => undefined }

  const positionLocation = gl.getAttribLocation(program, 'a_position')
  const normalLocation = gl.getAttribLocation(program, 'a_normal')
  const uvLocation = gl.getAttribLocation(program, 'a_uv')
  const textureLocation = gl.getUniformLocation(program, 'u_texture')
  const hasTextureLocation = gl.getUniformLocation(program, 'u_hasTexture')
  const originLocation = gl.getUniformLocation(program, 'u_origin')
  const facingLocation = gl.getUniformLocation(program, 'u_facing')
  const cameraLocation = gl.getUniformLocation(program, 'u_camera')
  const scaleLocation = gl.getUniformLocation(program, 'u_scale')
  const viewportLocation = gl.getUniformLocation(program, 'u_viewport')
  const mirrorLocation = gl.getUniformLocation(program, 'u_mirror')
  const alphaLocation = gl.getUniformLocation(program, 'u_alpha')
  const baseColorLocation = gl.getUniformLocation(program, 'u_baseColor')
  const metallicLocation = gl.getUniformLocation(program, 'u_metallic')
  const roughnessLocation = gl.getUniformLocation(program, 'u_roughness')
  const groupLocation = gl.getUniformLocation(program, 'u_group')
  const pivotOffsetLocation = gl.getUniformLocation(program, 'u_pivotOffset')
  const turretYawLocation = gl.getUniformLocation(program, 'u_turretYaw')
  const barrelPitchLocation = gl.getUniformLocation(program, 'u_barrelPitch')

  return {
    ready: true,
    /**
     * 画一批 3D 单位。
     *
     * `mirror` 给了就是**倒影**：物体关于贴地线翻转、按 squash 压扁、抬 lift、整体乘 alpha。
     * 倒影必须由模型自己翻，不能拿精灵轮廓去镜像 —— 否则倒影的形状和实体不是一个东西。
     */
    draw(camera, draws, mirror) {
      if (draws.length === 0) return
      gl.useProgram(program)
      gl.uniform2f(cameraLocation, camera.x, camera.y)
      gl.uniform1f(scaleLocation, viewScale(camera))
      gl.uniform2f(viewportLocation, gl.drawingBufferWidth, gl.drawingBufferHeight)
      // 第三项只当"是不是倒影"的开关用（0 = 画本体）
      gl.uniform3f(mirrorLocation, mirror?.groundY ?? 0, mirror?.squash ?? 0, mirror ? 1 : 0)
      gl.uniform1f(alphaLocation, mirror?.alpha ?? 1)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LESS)
      gl.clear(gl.DEPTH_BUFFER_BIT)
      gl.enableVertexAttribArray(positionLocation)
      gl.enableVertexAttribArray(normalLocation)
      for (const item of draws) {
        gl.uniform2f(originLocation, item.worldX, item.worldY)
        gl.uniform1f(facingLocation, item.facing)
        // 炮塔偏转弧度（相对车体）与炮管俯仰——按"次"设，组内 primitive 共享
        gl.uniform1f(turretYawLocation, item.turretFacing ?? 0)
        gl.uniform1f(barrelPitchLocation, item.barrelPitch ?? 0)
        for (const primitive of item.model.primitives) {
          gl.uniform1f(groupLocation, primitive.group)
          gl.uniform3f(
            pivotOffsetLocation,
            primitive.pivotOffset[0],
            primitive.pivotOffset[1],
            primitive.pivotOffset[2],
          )
          gl.uniform3f(baseColorLocation, primitive.baseColor[0], primitive.baseColor[1], primitive.baseColor[2])
          gl.uniform1f(metallicLocation, primitive.metallic)
          gl.uniform1f(roughnessLocation, primitive.roughness)
          gl.bindBuffer(gl.ARRAY_BUFFER, primitive.position)
          gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0)
          gl.bindBuffer(gl.ARRAY_BUFFER, primitive.normal)
          gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0)
          if (uvLocation >= 0 && primitive.uv) {
            gl.enableVertexAttribArray(uvLocation)
            gl.bindBuffer(gl.ARRAY_BUFFER, primitive.uv)
            gl.vertexAttribPointer(uvLocation, 2, gl.FLOAT, false, 0, 0)
          } else if (uvLocation >= 0) {
            gl.disableVertexAttribArray(uvLocation)
          }
          const hasTexture = primitive.texture !== undefined && uvLocation >= 0
          gl.uniform1f(hasTextureLocation, hasTexture ? 1 : 0)
          if (hasTexture) {
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, primitive.texture!)
            gl.uniform1i(textureLocation, 0)
          }
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.index)
          gl.drawElements(gl.TRIANGLES, primitive.count, primitive.indexType, 0)
        }
      }
      gl.disableVertexAttribArray(positionLocation)
      gl.disableVertexAttribArray(normalLocation)
      gl.disable(gl.DEPTH_TEST)
    },
  }
}

/** 把 GLB 内嵌的图片解码成位图（交给浏览器，格式层不碰图片编码）。 */
async function decodeImage(image: GltfImage): Promise<ImageBitmap | undefined> {
  try {
    return await createImageBitmap(new Blob([image.bytes as BlobPart], { type: image.mimeType }))
  } catch (error) {
    console.warn(`[3D] 贴图解不开（${image.mimeType}）：${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

/** 2 的幂是 WebGL1 里用 REPEAT + mipmap 的前提；不是就退回 CLAMP，避免出黑边。 */
function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0
}

function uploadTexture(
  gl: WebGLRenderingContext,
  bitmap: ImageBitmap,
  wrapS: number,
  wrapT: number,
): WebGLTexture | undefined {
  const texture = gl.createTexture()
  if (!texture) return undefined
  const repeatable = isPowerOfTwo(bitmap.width) && isPowerOfTwo(bitmap.height)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeatable ? wrapS : gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, repeatable ? wrapT : gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  if (repeatable) {
    // 单位在屏幕上只有几十像素，没有 mipmap 就会闪：这里必须生成
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  }
  gl.bindTexture(gl.TEXTURE_2D, null)
  return texture
}

/** 模型创建要解码贴图，所以是异步的：调用方（单位模型装载）本来就在异步流程里。 */
export async function createUnit3dModel(
  gl: WebGLRenderingContext,
  typeId: string,
  bytes: ArrayBuffer,
): Promise<Unit3dModel> {
  // WebGL1 的 32 位索引要扩展；没有扩展就把索引收窄到 16 位（顶点数超 65536 才真的需要 32 位）
  const supportsUint32 = gl.getExtension('OES_element_index_uint') !== null
  const primitives: Unit3dPrimitive[] = []
  const { primitives: parsed, images, textures } = readGlb(bytes)
  const uploaded = new Map<number, WebGLTexture | undefined>()
  const loadTexture = async (index: number | undefined): Promise<WebGLTexture | undefined> => {
    if (index === undefined) return undefined
    if (uploaded.has(index)) return uploaded.get(index)
    const texture = textures[index]
    const image = texture === undefined ? undefined : images[texture.image]
    const bitmap = image ? await decodeImage(image) : undefined
    const result = bitmap ? uploadTexture(gl, bitmap, texture!.wrapS, texture!.wrapT) : undefined
    bitmap?.close()
    uploaded.set(index, result)
    return result
  }
  let height = 0
  for (const primitive of parsed) {
    const positions = toVoxelSpace(primitive.position as Float32Array)
    for (let index = 2; index < positions.length; index += 3) height = Math.max(height, positions[index]!)
    let indices: Uint16Array | Uint32Array = primitive.indices
    // 索引类型按实际数组来：Blender 多半导 16 位，硬当 32 位用会 "Insufficient buffer size"
    let indexType: number = indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT
    if (!supportsUint32 && primitive.indices instanceof Uint32Array) {
      let largest = 0
      for (const value of primitive.indices) largest = Math.max(largest, value)
      if (largest >= 65536) throw new Error(`${typeId}：顶点数超过 65536，缺 OES_element_index_uint 扩展`)
      indices = Uint16Array.from(primitive.indices)
      indexType = gl.UNSIGNED_SHORT
    }
    const position = gl.createBuffer()
    const normal = gl.createBuffer()
    const uv = primitive.uv ? gl.createBuffer() : undefined
    const index = gl.createBuffer()
    if (!position || !normal || !index) continue
    gl.bindBuffer(gl.ARRAY_BUFFER, position)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, normal)
    gl.bufferData(gl.ARRAY_BUFFER, toVoxelSpace(primitive.normal as Float32Array), gl.STATIC_DRAW)
    if (uv && primitive.uv) {
      gl.bindBuffer(gl.ARRAY_BUFFER, uv)
      gl.bufferData(gl.ARRAY_BUFFER, primitive.uv, gl.STATIC_DRAW)
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
    primitives.push({
      position,
      normal,
      uv,
      index,
      texture: await loadTexture(primitive.textureIndex),
      count: indices.length,
      indexType,
      baseColor: primitive.baseColor,
      metallic: primitive.metallic,
      roughness: primitive.roughness,
      group: primitive.group,
      pivotOffset: primitive.pivotOffset,
      nodeOffset: primitive.nodeOffset,
    })
  }
  return { typeId, primitives, height }
}

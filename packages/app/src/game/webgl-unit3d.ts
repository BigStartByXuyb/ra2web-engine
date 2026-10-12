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
  readonly index: WebGLBuffer
  readonly count: number
  /** 索引类型：WebGL1 里 32 位索引要 `OES_element_index_uint`，能用就留 32 位、否则退 16 位 */
  readonly indexType: number
  readonly baseColor: readonly [number, number, number]
  readonly metallic: number
  readonly roughness: number
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
  /** 朝向弧度（与 `rotateVoxels` 同一约定） */
  readonly facing: number
}

export interface Unit3dRenderer {
  readonly ready: boolean
  draw(camera: Camera, draws: readonly Unit3dDraw[]): void
}

const VERTEX_SHADER = `
attribute vec3 a_position;
attribute vec3 a_normal;
uniform vec2 u_origin;
uniform float u_facing;
uniform vec2 u_camera;
uniform float u_scale;
uniform vec2 u_viewport;
varying vec3 v_normal;
void main() {
  float c = cos(u_facing);
  float s = sin(u_facing);
  vec3 position = vec3(a_position.x * c - a_position.y * s, a_position.x * s + a_position.y * c, a_position.z);
  v_normal = vec3(a_normal.x * c - a_normal.y * s, a_normal.x * s + a_normal.y * c, a_normal.z);
  // 引擎的精灵投影：screenX = x − y，screenY = (x + y)/2 − z
  vec2 world = u_origin + vec2(position.x - position.y, (position.x + position.y) * 0.5 - position.z);
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
varying vec3 v_normal;
void main() {
  vec3 light = normalize(vec3(-0.35, 0.55, 0.75));
  vec3 view = normalize(vec3(1.0, 1.0, 1.0));
  vec3 normal = normalize(v_normal);
  float lambert = max(0.0, dot(normal, light));
  vec3 halfVector = normalize(light + view);
  float shine = mix(8.0, 96.0, 1.0 - u_roughness);
  float specular = pow(max(0.0, dot(normal, halfVector)), shine) * (0.35 + 0.65 * u_metallic);
  float sky = max(0.0, normal.z);
  vec3 tint = mix(vec3(1.0), u_baseColor, u_metallic);
  vec3 color = u_baseColor * (0.34 + 0.72 * lambert) + tint * specular * 0.9 + vec3(0.09, 0.11, 0.15) * sky;
  gl_FragColor = vec4(color, 1.0);
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
  readonly indices: Uint16Array | Uint32Array
  readonly baseColor: readonly [number, number, number]
  readonly metallic: number
  readonly roughness: number
}

/** 只认我们自己导出的 GLB：单 buffer、POSITION/NORMAL/indices、pbrMetallicRoughness。 */
function readGlb(bytes: ArrayBuffer): readonly GltfPrimitive[] {
  const view = new DataView(bytes)
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('不是 GLB 文件')
  let offset = 12
  let json: {
    meshes?: { primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[]
    materials?: {
      pbrMetallicRoughness?: { baseColorFactor?: number[]; metallicFactor?: number; roughnessFactor?: number }
    }[]
    accessors?: { bufferView: number; componentType: number; count: number; type: string; byteOffset?: number }[]
    bufferViews?: { byteOffset?: number; byteLength: number; byteStride?: number }[]
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
  const accessor = (id: number): Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array => {
    const entry = json.accessors![id]!
    const bufferView = json.bufferViews![entry.bufferView]!
    const start = (bufferView.byteOffset ?? 0) + (entry.byteOffset ?? 0)
    const ArrayType = componentOf(entry.componentType)
    const values = entry.count * (entry.type === 'VEC3' ? 3 : 1)
    // 拷一份再建视图：这样拿到的一定是普通 ArrayBuffer（也顺手对齐到元素边界）
    return new ArrayType(binary!.slice(start, start + values * ArrayType.BYTES_PER_ELEMENT).buffer)
  }

  const primitives: GltfPrimitive[] = []
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const material = json.materials?.[primitive.material ?? 0]?.pbrMetallicRoughness ?? {}
      const color = material.baseColorFactor ?? [1, 1, 1, 1]
      primitives.push({
        position: accessor(primitive.attributes.POSITION!),
        normal: accessor(primitive.attributes.NORMAL!),
        indices: accessor(primitive.indices!) as Uint16Array | Uint32Array,
        baseColor: [color[0] ?? 1, color[1] ?? 1, color[2] ?? 1],
        metallic: material.metallicFactor ?? 0,
        roughness: material.roughnessFactor ?? 1,
      })
    }
  }
  return primitives
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
  const originLocation = gl.getUniformLocation(program, 'u_origin')
  const facingLocation = gl.getUniformLocation(program, 'u_facing')
  const cameraLocation = gl.getUniformLocation(program, 'u_camera')
  const scaleLocation = gl.getUniformLocation(program, 'u_scale')
  const viewportLocation = gl.getUniformLocation(program, 'u_viewport')
  const baseColorLocation = gl.getUniformLocation(program, 'u_baseColor')
  const metallicLocation = gl.getUniformLocation(program, 'u_metallic')
  const roughnessLocation = gl.getUniformLocation(program, 'u_roughness')

  return {
    ready: true,
    draw(camera, draws) {
      if (draws.length === 0) return
      gl.useProgram(program)
      gl.uniform2f(cameraLocation, camera.x, camera.y)
      gl.uniform1f(scaleLocation, viewScale(camera))
      gl.uniform2f(viewportLocation, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LESS)
      gl.clear(gl.DEPTH_BUFFER_BIT)
      gl.enableVertexAttribArray(positionLocation)
      gl.enableVertexAttribArray(normalLocation)
      for (const item of draws) {
        gl.uniform2f(originLocation, item.worldX, item.worldY)
        gl.uniform1f(facingLocation, item.facing)
        for (const primitive of item.model.primitives) {
          gl.uniform3f(baseColorLocation, primitive.baseColor[0], primitive.baseColor[1], primitive.baseColor[2])
          gl.uniform1f(metallicLocation, primitive.metallic)
          gl.uniform1f(roughnessLocation, primitive.roughness)
          gl.bindBuffer(gl.ARRAY_BUFFER, primitive.position)
          gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0)
          gl.bindBuffer(gl.ARRAY_BUFFER, primitive.normal)
          gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0)
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

export function createUnit3dModel(gl: WebGLRenderingContext, typeId: string, bytes: ArrayBuffer): Unit3dModel {
  // WebGL1 的 32 位索引要扩展；没有扩展就把索引收窄到 16 位（顶点数超 65536 才真的需要 32 位）
  const supportsUint32 = gl.getExtension('OES_element_index_uint') !== null
  const primitives: Unit3dPrimitive[] = []
  let height = 0
  for (const primitive of readGlb(bytes)) {
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
    const index = gl.createBuffer()
    if (!position || !normal || !index) continue
    gl.bindBuffer(gl.ARRAY_BUFFER, position)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, normal)
    gl.bufferData(gl.ARRAY_BUFFER, toVoxelSpace(primitive.normal as Float32Array), gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
    primitives.push({
      position,
      normal,
      index,
      count: indices.length,
      indexType,
      baseColor: primitive.baseColor,
      metallic: primitive.metallic,
      roughness: primitive.roughness,
    })
  }
  return { typeId, primitives, height }
}

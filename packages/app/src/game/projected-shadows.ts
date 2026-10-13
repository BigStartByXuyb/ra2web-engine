/**
 * 屏幕空间平行光投影阴影（渲染现代化线任务 4，**本项目自定**）。
 *
 * 取舍：本引擎地表是"高度图 + iso 屏幕投影"而非完整 3D 场景，真 shadowmap 需整套 3D 光空间
 * 改造且建筑尚无 3D 几何——首版用单位模型的**真实几何**（只读复用 unit3d 的 VBO）按平行光
 * 斜率投影到地面，产出方向性影子（取代椭圆 blob）；真 shadowmap + 建筑阴影列后续（建筑 3D 化）。
 *
 * 投影式（GLSL 逐字镜像，改一处两处同改）：顶点 (p, 旋转 facing) →
 *   足迹 flat = (rx − ry, (rx + ry) / 2)；影子 = 锚点 + flat + p.z × slide（每体素高度的屏幕位移）。
 */

export interface ProjectedShadowOptions {
  /** 每体素高度在屏幕上的影子位移（本项目自定：光从左上 → 影子右下） */
  readonly slideX: number
  readonly slideY: number
  /** 整体不透明度（本项目自定） */
  readonly alpha: number
}

export const PROJECTED_SHADOW_DEFAULT: ProjectedShadowOptions = { slideX: 0.5, slideY: 0.35, alpha: 0.32 }

/** 单顶点影子落点（屏幕世界坐标）——GLSL 顶点着色器的 TS 镜像。 */
export function projectedShadowVertex(
  vertex: readonly [number, number, number],
  facing: number,
  anchorX: number,
  anchorY: number,
  options: ProjectedShadowOptions,
): [number, number] {
  const c = Math.cos(facing)
  const s = Math.sin(facing)
  const rx = vertex[0] * c - vertex[1] * s
  const ry = vertex[0] * s + vertex[1] * c
  return [anchorX + (rx - ry) + vertex[2] * options.slideX, anchorY + (rx + ry) * 0.5 + vertex[2] * options.slideY]
}
import type { Camera } from './camera.js'
import { viewScale } from './camera.js'
import type { Unit3dModel } from './webgl-unit3d.js'

/** 一个要投影影子的单位（模型几何只读复用 unit3d 的 VBO）。 */
export interface ProjectedShadowEntry {
  readonly model: Unit3dModel
  /** 贴地锚点的屏幕世界坐标（与主绘制同一套） */
  readonly worldX: number
  readonly worldY: number
  readonly facing: number
}

export interface ProjectedShadowRenderer {
  draw(
    camera: Camera,
    entries: readonly ProjectedShadowEntry[],
    viewportWidth: number,
    viewportHeight: number,
  ): void
}

const VERTEX_SHADER = `
attribute vec3 a_position;
uniform vec2 u_origin;
uniform float u_facing;
uniform vec2 u_slide;
uniform vec2 u_camera;
uniform float u_scale;
uniform vec2 u_viewport;
void main() {
  // 与 projectedShadowVertex 同式：旋转 → 足迹 → 高度 × 光斜率
  float c = cos(u_facing);
  float s = sin(u_facing);
  vec2 rot = vec2(a_position.x * c - a_position.y * s, a_position.x * s + a_position.y * c);
  // 注意：flat 是 GLSL 保留字（ES 3.0 插值限定符），变量名必须避开
  vec2 footprint = vec2(rot.x - rot.y, (rot.x + rot.y) * 0.5);
  vec2 world = u_origin + footprint + a_position.z * u_slide;
  vec2 pixel = (world - u_camera) * u_scale;
  gl_Position = vec4(pixel.x / u_viewport.x * 2.0 - 1.0, 1.0 - pixel.y / u_viewport.y * 2.0, 0.0, 1.0);
}`

const FRAGMENT_SHADER = `
precision mediump float;
uniform float u_alpha;
void main() {
  // 预乘混合（ONE, ONE_MINUS_SRC_ALPHA）：黑色 = (0,0,0,alpha)
  gl_FragColor = vec4(0.0, 0.0, 0.0, u_alpha);
}`

/** 建投影阴影渲染器（模糊软边不做——硬边剪影 + 低 alpha，本项目自定；软化列后续 SSAO/软影）。 */
export function createProjectedShadowRenderer(
  gl: WebGLRenderingContext,
  options: ProjectedShadowOptions = PROJECTED_SHADOW_DEFAULT,
): ProjectedShadowRenderer | undefined {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (!vertex || !fragment) return undefined
  const program = gl.createProgram()
  if (!program) return undefined
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[shadows]', gl.getProgramInfoLog(program))
    return undefined
  }
  const positionLocation = gl.getAttribLocation(program, 'a_position')
  const originLocation = gl.getUniformLocation(program, 'u_origin')
  const facingLocation = gl.getUniformLocation(program, 'u_facing')
  const slideLocation = gl.getUniformLocation(program, 'u_slide')
  const cameraLocation = gl.getUniformLocation(program, 'u_camera')
  const scaleLocation = gl.getUniformLocation(program, 'u_scale')
  const viewportLocation = gl.getUniformLocation(program, 'u_viewport')
  const alphaLocation = gl.getUniformLocation(program, 'u_alpha')
  return {
    draw(camera, entries, viewportWidth, viewportHeight) {
      if (entries.length === 0) return
      gl.useProgram(program)
      gl.uniform2f(cameraLocation, camera.x, camera.y)
      gl.uniform1f(scaleLocation, viewScale(camera))
      gl.uniform2f(viewportLocation, viewportWidth, viewportHeight)
      gl.uniform2f(slideLocation, options.slideX, options.slideY)
      gl.uniform1f(alphaLocation, options.alpha)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      for (const entry of entries) {
        gl.uniform2f(originLocation, entry.worldX, entry.worldY)
        gl.uniform1f(facingLocation, entry.facing)
        for (const primitive of entry.model.primitives) {
          gl.bindBuffer(gl.ARRAY_BUFFER, primitive.position)
          gl.enableVertexAttribArray(positionLocation)
          gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0)
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.index)
          gl.drawElements(gl.TRIANGLES, primitive.count, primitive.indexType, 0)
        }
      }
    },
  }
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | undefined {
  const shader = gl.createShader(type)
  if (!shader) return undefined
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[shadows]', gl.getShaderInfoLog(shader))
    return undefined
  }
  return shader
}

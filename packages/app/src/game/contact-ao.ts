import type { Camera } from './camera.js'
import { viewScale } from './camera.js'

/**
 * 接触暗角（"SSAO-lite"，渲染现代化线任务 5，**本项目自定**）。
 *
 * 架构事实：本引擎无深度 G-buffer，真屏幕空间 AO 不可行。务实形态=接触遮蔽贴片：
 * 每个 3D 单位正下方一枚紧凑的深色椭圆（居中、无光偏），与投影阴影叠加时增强
 * "贴地的重量感"、消除悬浮感——观感目标一致、确定性、成本极低。
 * 真屏幕空间 AO 列后续（随真 3D 场景/深度改造）。
 */

export interface ContactAoOptions {
  /** 椭圆长轴（世界像素；0.55 格 = 33px，本项目自定） */
  readonly footprintWorld: number
  /** 整体不透明度（本项目自定） */
  readonly alpha: number
}

// footprintWorld 64 ≈ 1.07 格：必须大于车身贴图的"不透明核心"（约 75px 宽的贴图里车体约占半数），
// 否则整枚椭圆被后画的单位精灵盖住、只剩零星边缘像素（实测 33px 时 diffImages 判 0 = 白做）。
export const CONTACT_AO_DEFAULT: ContactAoOptions = { footprintWorld: 64, alpha: 0.4 }

export interface ContactAoEntry {
  readonly worldX: number
  readonly worldY: number
}

export interface ContactAoRenderer {
  draw(camera: Camera, entries: readonly ContactAoEntry[], viewportWidth: number, viewportHeight: number): void
}

const VERTEX_SHADER = `
attribute vec2 a_corner;
uniform vec2 u_center;
uniform vec2 u_size;
uniform vec2 u_camera;
uniform float u_scale;
uniform vec2 u_viewport;
varying vec2 v_uv;
void main() {
  vec2 world = u_center + (a_corner - 0.5) * u_size;
  vec2 pixel = (world - u_camera) * u_scale;
  gl_Position = vec4(pixel.x / u_viewport.x * 2.0 - 1.0, 1.0 - pixel.y / u_viewport.y * 2.0, 0.0, 1.0);
  v_uv = a_corner;
}`

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_texture;
uniform float u_alpha;
varying vec2 v_uv;
void main() {
  gl_FragColor = texture2D(u_texture, v_uv) * u_alpha;
}`

/** 紧凑接触暗角贴图（比阴影 blob 更小更实；self-contained 生成，本项目自定）。 */
function createContactTexture(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const context = canvas.getContext('2d')!
  context.save()
  context.translate(64, 32)
  context.scale(1, 0.5)
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 64)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.9)')
  gradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.55)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  context.fillStyle = gradient
  context.beginPath()
  context.arc(0, 0, 64, 0, Math.PI * 2)
  context.fill()
  context.restore()
  return canvas
}

export function createContactAoRenderer(
  gl: WebGLRenderingContext,
  options: ContactAoOptions = CONTACT_AO_DEFAULT,
): ContactAoRenderer | undefined {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (!vertex || !fragment) return undefined
  const program = gl.createProgram()
  if (!program) return undefined
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[contact-ao]', gl.getProgramInfoLog(program))
    return undefined
  }
  const buffer = gl.createBuffer()
  const texture = gl.createTexture()
  if (!buffer || !texture) return undefined
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, createContactTexture())
  const cornerLocation = gl.getAttribLocation(program, 'a_corner')
  const centerLocation = gl.getUniformLocation(program, 'u_center')
  const sizeLocation = gl.getUniformLocation(program, 'u_size')
  const cameraLocation = gl.getUniformLocation(program, 'u_camera')
  const scaleLocation = gl.getUniformLocation(program, 'u_scale')
  const viewportLocation = gl.getUniformLocation(program, 'u_viewport')
  const textureLocation = gl.getUniformLocation(program, 'u_texture')
  const alphaLocation = gl.getUniformLocation(program, 'u_alpha')
  return {
    draw(camera, entries, viewportWidth, viewportHeight) {
      if (entries.length === 0) return
      gl.useProgram(program)
      gl.uniform2f(cameraLocation, camera.x, camera.y)
      gl.uniform1f(scaleLocation, viewScale(camera))
      gl.uniform2f(viewportLocation, viewportWidth, viewportHeight)
      gl.uniform2f(sizeLocation, options.footprintWorld, options.footprintWorld / 2)
      gl.uniform1f(alphaLocation, options.alpha)
      gl.uniform1i(textureLocation, 0)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(cornerLocation)
      gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0)
      for (const entry of entries) {
        gl.uniform2f(centerLocation, entry.worldX, entry.worldY)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
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
    console.error('[contact-ao]', gl.getShaderInfoLog(shader))
    return undefined
  }
  return shader
}

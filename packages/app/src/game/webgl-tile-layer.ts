import type { IsoView } from '@ra2web/render'
import type { Camera, CellRange } from './camera.js'
import { viewScale } from './camera.js'
import type { MapPreview } from './map-preview.js'

/**
 * WebGL 地块层 —— 换渲染后端的第一步 spike。
 *
 * 只把**地块**这一层从 2D canvas 挪到 GPU：每个可见格一个贴图四边形，纹理就是
 * `TileLayer.canvasAt` 生成的那张 TMP 地块图。其余层（覆盖物、建筑、单位、迷雾）仍在 2D 画布上，
 * 所以两边的相机变换必须逐像素一致：
 *
 * - 屏幕位置 = `(世界坐标 − 相机位置) × viewScale`，与 `context.setTransform` 同一套；
 * - 纹理用 `NEAREST`，否则原版的硬像素会被插值糊掉；
 * - 纹理按**预乘 alpha** 上传、混合用 `ONE, ONE_MINUS_SRC_ALPHA`，这样与 `drawImage` 的
 *   source-over 结果一致（地块菱形四角是透明的）。
 *
 * 验收标准：同一机位下与 2D 路径逐像素比对，差异为 0（见 `docs/ENGINE-MAP.md`）。
 */

export interface GlTileLayer {
  /**
   * 画一帧"静态地图层"：地块 → 覆盖物 → 建筑，绘制次序与 2D 路径逐条对应
   * （覆盖物跟在它那一格的地块之后；建筑最后按 (x+y) 升序，近处盖远处）。
   */
  render(context: GlSceneContext): void
  /** 画布尺寸/比例变化时同步后备缓冲 */
  resize(width: number, height: number): void
  readonly ready: boolean
}

/** 一帧要画的静态地图内容：地块/覆盖物/建筑都从 `MapPreview` 取 */
export interface GlSceneContext {
  readonly preview: MapPreview
  readonly camera: Camera
  readonly range: CellRange
  readonly view: IsoView
  readonly tileCanvasAt: (tileIndex: number, subTile: number) => HTMLCanvasElement | undefined
}

const VERTEX_SHADER = `
attribute vec2 a_corner;
attribute vec2 a_origin;
attribute vec2 a_size;
uniform vec2 u_camera;
uniform float u_scale;
uniform vec2 u_viewport;
varying vec2 v_uv;
void main() {
  vec2 world = a_origin + a_corner * a_size;
  vec2 pixel = (world - u_camera) * u_scale;
  vec2 clip = vec2(pixel.x / u_viewport.x * 2.0 - 1.0, 1.0 - pixel.y / u_viewport.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = a_corner;
}`

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_texture;
varying vec2 v_uv;
void main() {
  gl_FragColor = texture2D(u_texture, v_uv);
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

export function createGlTileLayer(canvas: HTMLCanvasElement): GlTileLayer | undefined {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    // 抓帧/截图时缓冲区必须留到最后一次合成之后，否则截到的可能是被清空的一帧
    preserveDrawingBuffer: true,
  })
  if (!gl) return undefined

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (!vertex || !fragment) return undefined
  const program = gl.createProgram()
  if (!program) return undefined
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program))
    return undefined
  }

  const cornerLocation = gl.getAttribLocation(program, 'a_corner')
  const originLocation = gl.getAttribLocation(program, 'a_origin')
  const sizeLocation = gl.getAttribLocation(program, 'a_size')
  const cameraLocation = gl.getUniformLocation(program, 'u_camera')
  const scaleLocation = gl.getUniformLocation(program, 'u_scale')
  const viewportLocation = gl.getUniformLocation(program, 'u_viewport')
  const textureLocation = gl.getUniformLocation(program, 'u_texture')
  const buffer = gl.createBuffer()
  const textures = new WeakMap<HTMLCanvasElement, WebGLTexture>()

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)

  function textureFor(source: HTMLCanvasElement): WebGLTexture | undefined {
    const cached = textures.get(source)
    if (cached) return cached
    const texture = gl!.createTexture()
    if (!texture) return undefined
    gl!.bindTexture(gl!.TEXTURE_2D, texture)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, source)
    textures.set(source, texture)
    return texture
  }

  // 每个格子 6 个顶点（两个三角形）；每个顶点 4 个 float：角偏移 + 世界左上角
  const CORNERS = [0, 0, 60, 0, 0, 30, 0, 30, 60, 0, 60, 30]
  let data = new Float32Array(0)

  return {
    ready: true,
    resize(width, height) {
      canvas.width = width
      canvas.height = height
      gl.viewport(0, 0, width, height)
    },
    render(context) {
      const { preview, camera, range, view, tileCanvasAt } = context
      const width = canvas.width
      const height = canvas.height
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program!)
      gl.uniform2f(cameraLocation, camera.x, camera.y)
      gl.uniform1f(scaleLocation, viewScale(camera))
      gl.uniform2f(viewportLocation, width, height)
      gl.uniform1i(textureLocation, 0)
      gl.activeTexture(gl.TEXTURE0)

      /** 画一个画布四边形：`origin` 是世界坐标左上角，`size` 是像素尺寸。 */
      const drawQuad = (source: HTMLCanvasElement, originX: number, originY: number): void => {
        const texture = textureFor(source)
        if (!texture) return
        if (data.length < CORNERS.length * 3) data = new Float32Array(CORNERS.length * 3)
        for (let index = 0; index < CORNERS.length / 2; index++) {
          data[index * 6] = CORNERS[index * 2]!
          data[index * 6 + 1] = CORNERS[index * 2 + 1]!
          data[index * 6 + 2] = originX
          data[index * 6 + 3] = originY
          data[index * 6 + 4] = source.width
          data[index * 6 + 5] = source.height
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, CORNERS.length * 3), gl.STREAM_DRAW)
        gl.enableVertexAttribArray(cornerLocation)
        gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 24, 0)
        gl.enableVertexAttribArray(originLocation)
        gl.vertexAttribPointer(originLocation, 2, gl.FLOAT, false, 24, 8)
        gl.enableVertexAttribArray(sizeLocation)
        gl.vertexAttribPointer(sizeLocation, 2, gl.FLOAT, false, 24, 16)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.drawArrays(gl.TRIANGLES, 0, CORNERS.length / 2)
      }

      // 地块与覆盖物按格序画（覆盖物跟在它那一格之后，与 2D 路径一致）
      for (let y = range.minY; y <= range.maxY; y++) {
        for (let x = range.minX; x <= range.maxX; x++) {
          if (x < 0 || y < 0 || x >= preview.width || y >= preview.height) continue
          const cell = preview.cellByIndex.get(y * preview.width + x)
          if (!cell) continue
          const painted = tileCanvasAt(cell.tileIndex, cell.subTile)
          const centerX = (x - y) * (view.cellWidth / 2)
          const centerY = (x + y) * (view.cellHeight / 2)
          if (painted) drawQuad(painted, centerX - view.cellWidth / 2, centerY - view.cellHeight / 2)
          const overlay = preview.overlayLayer?.canvasAt(cell.overlay)
          if (overlay) drawQuad(overlay, centerX - overlay.width / 2, centerY - overlay.height / 2)
        }
      }

      // 建筑最后画，按 (x+y) 升序：近处的房子盖住远处的（与 2D 路径同一判据）
      const structures = [...preview.structures].sort(
        (left, right) =>
          left.placement.cellX + left.placement.cellY - (right.placement.cellX + right.placement.cellY),
      )
      for (const sprite of structures) {
        const { placement, canvas: source, foundationWidth, foundationHeight } = sprite
        const anchorX = (placement.cellX + (foundationWidth - 1) / 2 - (placement.cellY + (foundationHeight - 1) / 2)) * (view.cellWidth / 2)
        const anchorY = (placement.cellX + (foundationWidth - 1) / 2 + placement.cellY + (foundationHeight - 1) / 2) * (view.cellHeight / 2)
        drawQuad(source, anchorX - source.width / 2, anchorY - source.height / 2)
      }
    },
  }
}

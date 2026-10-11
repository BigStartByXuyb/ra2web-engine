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
  /** 实时阴影：把物体按光方向压扁投影到地面（重制版增强，默认关闭） */
  renderShadows(context: GlSceneContext): void
  /** 大气雾：按屏幕纵向梯度铺一层冷雾（重制版增强，默认关闭） */
  renderFog(): void
}

/** 一帧要画的静态地图内容：地块/覆盖物/建筑都从 `MapPreview` 取 */
export interface GlSceneContext {
  readonly preview: MapPreview
  readonly camera: Camera
  readonly range: CellRange
  readonly view: IsoView
  readonly tileCanvasAt: (tileIndex: number, subTile: number) => HTMLCanvasElement | undefined
  /** 单位：按 (x+y) 升序画在建筑之后（与 2D 路径同一判据）；坐标是世界坐标里的"贴地锚点" */
  readonly units: readonly GlUnitQuad[]
}

export interface GlUnitQuad {
  readonly source: HTMLCanvasElement
  /** 贴地锚点在该图内的位置 */
  readonly anchorX: number
  readonly anchorY: number
  /** 贴地锚点的世界坐标 */
  readonly worldX: number
  readonly worldY: number
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

/**
 * 阴影用的片元着色器：只取物体的 alpha 当遮蔽，颜色固定为黑、整体半透明。
 * 纹理已按预乘 alpha 上传，所以黑 = (0,0,0, alpha)，混合出来就是"地面被压暗"。
 */
const SHADOW_FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_texture;
uniform float u_alpha;
varying vec2 v_uv;
void main() {
  float mask = texture2D(u_texture, v_uv).a;
  gl_FragColor = vec4(0.0, 0.0, 0.0, mask * u_alpha);
}`

/** 阴影设置：光从左上打下来，影子因此往右下偏、并按 `squash` 压扁。 */
export interface ShadowStyle {
  readonly offsetX: number
  readonly offsetY: number
  readonly squash: number
  readonly alpha: number
}

export const DEFAULT_SHADOW: ShadowStyle = { offsetX: 10, offsetY: 6, squash: 0.45, alpha: 0.34 }

/**
 * 大气雾：等距视角里**屏幕上越靠上 = 离镜头越远**，所以用屏幕纵向梯度当雾的浓度，
 * 远处（画面上方）偏冷、偏灰，近处（画面下方）几乎透明。
 * 全屏一个四边形 + 一个片元着色器，代价可以忽略。默认关闭（原版无此效果）。
 */
const FOG_VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_screen;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_screen = a_position * 0.5 + 0.5;
}`

const FOG_FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 u_color;
uniform float u_strength;
varying vec2 v_screen;
void main() {
  // 画面上方 = 远处，雾更浓；用 1.6 次方让近处几乎不受影响
  float distance = pow(1.0 - v_screen.y, 1.6);
  float alpha = distance * u_strength;
  gl_FragColor = vec4(u_color * alpha, alpha);
}`

export const DEFAULT_FOG = { r: 0.62, g: 0.68, b: 0.78, strength: 0.22 }

/**
 * 可见格范围 → 世界坐标包围盒（带余量）。
 *
 * 等距投影下 `worldX = (x − y) · 30`、`worldY = (x + y) · 15`，所以在格子矩形上取极值即可：
 * worldX 的最小值出现在 (minX, maxY)、最大值出现在 (maxX, minY)；worldY 同理。
 * 建筑与单位的贴图会伸到格子之外（最高两百多像素、左右各几十像素），因此按最大贴图尺寸放余量。
 */
function visibleWorldBounds(
  range: CellRange,
  view: IsoView,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const halfWidth = view.cellWidth / 2
  const halfHeight = view.cellHeight / 2
  const margin = 320
  return {
    minX: (range.minX - range.maxY) * halfWidth - margin,
    maxX: (range.maxX - range.minY) * halfWidth + margin,
    minY: (range.minX + range.minY) * halfHeight - margin,
    maxY: (range.maxX + range.maxY) * halfHeight + margin,
  }
}

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
  // 阴影另起一个程序：顶点变换与主程序一致，片元只输出黑色遮罩
  const shadowFragment = compile(gl, gl.FRAGMENT_SHADER, SHADOW_FRAGMENT_SHADER)
  const shadowProgram = shadowFragment ? gl.createProgram() : undefined
  if (shadowProgram && vertex && shadowFragment) {
    gl.attachShader(shadowProgram, vertex)
    gl.attachShader(shadowProgram, shadowFragment)
    gl.linkProgram(shadowProgram)
  }
  const cameraLocation = gl.getUniformLocation(program, 'u_camera')
  const scaleLocation = gl.getUniformLocation(program, 'u_scale')
  const viewportLocation = gl.getUniformLocation(program, 'u_viewport')
  const textureLocation = gl.getUniformLocation(program, 'u_texture')
  const shadowCameraLocation = shadowProgram ? gl.getUniformLocation(shadowProgram, 'u_camera') : undefined
  const shadowScaleLocation = shadowProgram ? gl.getUniformLocation(shadowProgram, 'u_scale') : undefined
  const shadowViewportLocation = shadowProgram ? gl.getUniformLocation(shadowProgram, 'u_viewport') : undefined
  const shadowTextureLocation = shadowProgram ? gl.getUniformLocation(shadowProgram, 'u_texture') : undefined
  const shadowAlphaLocation = shadowProgram ? gl.getUniformLocation(shadowProgram, 'u_alpha') : undefined
  const shadowCornerLocation = shadowProgram ? gl.getAttribLocation(shadowProgram, 'a_corner') : -1
  const shadowOriginLocation = shadowProgram ? gl.getAttribLocation(shadowProgram, 'a_origin') : -1
  const shadowSizeLocation = shadowProgram ? gl.getAttribLocation(shadowProgram, 'a_size') : -1
  // 雾：全屏四边形（两三角形覆盖 −1..1），顶点只传 clip 坐标
  const fogVertex = compile(gl, gl.VERTEX_SHADER, FOG_VERTEX_SHADER)
  const fogFragment = compile(gl, gl.FRAGMENT_SHADER, FOG_FRAGMENT_SHADER)
  const fogProgram = fogVertex && fogFragment ? gl.createProgram() : undefined
  if (fogProgram && fogVertex && fogFragment) {
    gl.attachShader(fogProgram, fogVertex)
    gl.attachShader(fogProgram, fogFragment)
    gl.linkProgram(fogProgram)
  }
  const fogPositionLocation = fogProgram ? gl.getAttribLocation(fogProgram, 'a_position') : -1
  const fogColorLocation = fogProgram ? gl.getUniformLocation(fogProgram, 'u_color') : undefined
  const fogStrengthLocation = fogProgram ? gl.getUniformLocation(fogProgram, 'u_strength') : undefined
  const fogBuffer = fogProgram ? gl.createBuffer() : undefined
  const buffer = gl.createBuffer()
  const textures = new WeakMap<HTMLCanvasElement, WebGLTexture>()

  /**
   * 顶点批处理：一帧里所有四边形先拼进同一个数组、**一次上传**，再逐个 `drawArrays`。
   *
   * 原来每个四边形都单独 `bufferData`（一帧上千次上传），是浏览器里的主要开销
   * （实测开阴影+雾 12 fps）。批处理**不改变绘制顺序**，所以画面与逐次上传完全一致。
   * 属性步长 24 字节：角(8) + 左上角(8) + 尺寸(8)，一次设置多次复用。
   */
  let batchData = new Float32Array(4096 * 6)
  let batchCursor = 0
  const batchDraws: Array<{ texture: WebGLTexture; start: number }> = []

  const resetBatch = (): void => {
    batchCursor = 0
    batchDraws.length = 0
  }

  const pushQuad = (texture: WebGLTexture, originX: number, originY: number, sizeX: number, sizeY: number): void => {
    const needed = batchCursor + CORNERS.length * 3
    if (batchData.length < needed) {
      const grown = new Float32Array(Math.max(needed, batchData.length * 2))
      grown.set(batchData.subarray(0, batchCursor))
      batchData = grown
    }
    for (let index = 0; index < CORNERS.length / 2; index++) {
      const at = batchCursor + index * 6
      batchData[at] = CORNERS[index * 2]!
      batchData[at + 1] = CORNERS[index * 2 + 1]!
      batchData[at + 2] = originX
      batchData[at + 3] = originY
      batchData[at + 4] = sizeX
      batchData[at + 5] = sizeY
    }
    batchDraws.push({ texture, start: batchCursor / 6 })
    batchCursor += CORNERS.length * 3
  }

  const flushBatch = (corner: number, origin: number, size: number): void => {
    if (batchDraws.length === 0) return
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, batchData.subarray(0, batchCursor), gl.STREAM_DRAW)
    gl.enableVertexAttribArray(corner)
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 24, 0)
    gl.enableVertexAttribArray(origin)
    gl.vertexAttribPointer(origin, 2, gl.FLOAT, false, 24, 8)
    gl.enableVertexAttribArray(size)
    gl.vertexAttribPointer(size, 2, gl.FLOAT, false, 24, 16)
    for (const draw of batchDraws) {
      gl.bindTexture(gl.TEXTURE_2D, draw.texture)
      gl.drawArrays(gl.TRIANGLES, draw.start, 6)
    }
  }

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
  // 单位正方形的两个三角形：顶点乘 `a_size` 得到实际尺寸，纹理坐标直接用它
  const CORNERS = [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]
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
        pushQuad(texture, originX, originY, source.width, source.height)
      }

      resetBatch()

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
      const visible = visibleWorldBounds(range, view)
      const structures = [...preview.structures].sort(
        (left, right) => left.placement.cellX + left.placement.cellY - (right.placement.cellX + right.placement.cellY),
      )
      for (const sprite of structures) {
        const { placement, canvas: source, foundationWidth, foundationHeight } = sprite
        const anchorX =
          (placement.cellX + (foundationWidth - 1) / 2 - (placement.cellY + (foundationHeight - 1) / 2)) *
          (view.cellWidth / 2)
        const anchorY =
          (placement.cellX + (foundationWidth - 1) / 2 + placement.cellY + (foundationHeight - 1) / 2) *
          (view.cellHeight / 2)
        // 视野裁剪：屏幕外的建筑不提交（一张图几百个建筑，这一条省掉大部分绘制）
        if (
          anchorX - source.width / 2 > visible.maxX ||
          anchorX + source.width / 2 < visible.minX ||
          anchorY + source.height / 2 < visible.minY ||
          anchorY - source.height / 2 > visible.maxY
        ) {
          continue
        }
        drawQuad(source, anchorX - source.width / 2, anchorY - source.height / 2)
      }

      // 单位最后画（与 2D 路径一致：单位在所有建筑之上），锚点是贴地点
      for (const unit of context.units) {
        drawQuad(unit.source, unit.worldX - unit.anchorX, unit.worldY - unit.anchorY)
      }
      flushBatch(cornerLocation, originLocation, sizeLocation)
    },
    /**
     * 实时阴影：不单独做阴影贴图，直接把物体的贴图当**遮蔽掩模**，按光方向偏移、
     * 垂直压扁后贴回地面 —— 代价是每个物体一次 draw call，RTS 的同屏数量完全够用。
     * 只在开关打开时调用；关闭时画面与 2D 路径逐像素一致。
     */
    renderShadows(context) {
      if (!shadowProgram) return
      const { camera, view } = context
      const width = canvas.width
      const height = canvas.height
      gl.useProgram(shadowProgram)
      gl.uniform2f(shadowCameraLocation!, camera.x, camera.y)
      gl.uniform1f(shadowScaleLocation!, viewScale(camera))
      gl.uniform2f(shadowViewportLocation!, width, height)
      gl.uniform1i(shadowTextureLocation!, 0)
      gl.uniform1f(shadowAlphaLocation!, DEFAULT_SHADOW.alpha)
      gl.activeTexture(gl.TEXTURE0)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)

      const drawShadow = (source: HTMLCanvasElement, originX: number, originY: number, baseY: number): void => {
        const texture = textureFor(source)
        if (!texture) return
        const shadowHeight = Math.max(1, Math.round(source.height * DEFAULT_SHADOW.squash))
        // 影子底边与物体贴地线对齐，再按光方向偏移
        const shadowOriginX = originX + DEFAULT_SHADOW.offsetX
        const shadowOriginY = baseY - shadowHeight + DEFAULT_SHADOW.offsetY
        pushQuad(texture, shadowOriginX, shadowOriginY, source.width, shadowHeight)
      }

      resetBatch()

      const structures = [...context.preview.structures].sort(
        (left, right) => left.placement.cellX + left.placement.cellY - (right.placement.cellX + right.placement.cellY),
      )
      const visibleShadows = visibleWorldBounds(context.range, view)
      for (const sprite of structures) {
        const { placement, canvas: source, foundationWidth, foundationHeight } = sprite
        const anchorX =
          (placement.cellX + (foundationWidth - 1) / 2 - (placement.cellY + (foundationHeight - 1) / 2)) *
          (view.cellWidth / 2)
        const anchorY =
          (placement.cellX + (foundationWidth - 1) / 2 + placement.cellY + (foundationHeight - 1) / 2) *
          (view.cellHeight / 2)
        if (
          anchorX - source.width / 2 > visibleShadows.maxX ||
          anchorX + source.width / 2 < visibleShadows.minX ||
          anchorY + source.height / 2 < visibleShadows.minY ||
          anchorY - source.height / 2 > visibleShadows.maxY
        ) {
          continue
        }
        drawShadow(source, anchorX - source.width / 2, anchorY - source.height / 2, anchorY + source.height / 2)
      }
      for (const unit of context.units) {
        drawShadow(
          unit.source,
          unit.worldX - unit.anchorX,
          unit.worldY - unit.anchorY,
          unit.worldY + (unit.source.height - unit.anchorY),
        )
      }
      flushBatch(shadowCornerLocation, shadowOriginLocation, shadowSizeLocation)
    },
    renderFog() {
      if (!fogProgram || !fogBuffer) return
      gl.useProgram(fogProgram)
      gl.uniform3f(fogColorLocation!, DEFAULT_FOG.r, DEFAULT_FOG.g, DEFAULT_FOG.b)
      gl.uniform1f(fogStrengthLocation!, DEFAULT_FOG.strength)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1])
      gl.bindBuffer(gl.ARRAY_BUFFER, fogBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STREAM_DRAW)
      gl.enableVertexAttribArray(fogPositionLocation)
      gl.vertexAttribPointer(fogPositionLocation, 2, gl.FLOAT, false, 0, 0)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    },
  }
}

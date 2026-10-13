/**
 * 渲染现代化线任务 1：离屏渲染骨架（FBO 双缓冲 + 全屏 pass 链）。**本项目自定**。
 *
 * 后续所有现代化 pass（任务 2 色调映射/曝光/分级、任务 3 FXAA/SMAA、任务 5 SSAO）
 * 都挂在 `drawFullscreen` 这条链上；本任务只交付骨架与"拷贝 pass"，
 * 验收红线：接线后 `?pipeline=1` 与默认直绘路径逐像素一致。
 *
 * 代际策略：WebGL2 主路径（RGBA16F 可渲染时用 half 精度 RT，HDR 后处理用）；
 * WebGL1 回退（RGBA8 + 扩展拼装，能力探测见 tools/webgl2-probe.ts 报告）。
 * 纯逻辑（尺寸/双缓冲/精度决策）与 GL 调用分离，前者可单测。
 */

export interface ViewportSize {
  readonly width: number
  readonly height: number
}

export interface RenderTargetSize {
  readonly width: number
  readonly height: number
}

/** 画布尺寸 × pixelRatio → RT 尺寸：下限 1，上限截断到 maxTextureSize（本项目自定）。 */
export function computeRenderTargetSize(
  canvas: ViewportSize,
  pixelRatio: number,
  maxTextureSize: number,
): RenderTargetSize {
  const width = Math.min(Math.max(1, Math.floor(canvas.width * pixelRatio)), maxTextureSize)
  const height = Math.min(Math.max(1, Math.floor(canvas.height * pixelRatio)), maxTextureSize)
  return { width, height }
}

export interface BufferChain {
  /** 当前写入的缓冲下标 */
  readonly current: number
  readonly length: number
  /** 环形推进 n 步（缺省 1） */
  swap(steps?: number): void
}

/** ping-pong 双缓冲链（任务 2 起后处理链用；本任务单 pass 也走它保持结构一致）。 */
export function createBufferChain(length: number): BufferChain {
  if (length < 2) throw new Error(`缓冲链至少 2 项，收到 ${length}`)
  let current = 0
  return {
    get current(): number {
      return current
    },
    length,
    swap(steps = 1) {
      current = (current + steps) % length
    },
  }
}

export type Precision = 'half' | 'byte'

export interface PipelineCaps {
  readonly isWebGL2: boolean
  readonly halfFloatRenderable: boolean
}

/** 精度决策：仅 WebGL2 + 可渲染 half-float 时用 half（HDR），其余退 byte（LDR）。 */
export function resolvePrecision(caps: PipelineCaps): Precision {
  return caps.isWebGL2 && caps.halfFloatRenderable ? 'half' : 'byte'
}

/** 从真实 GL 上下文探测代际与 half-float 可渲染性（探测矩阵见 tools/webgl2-probe.ts）。 */
export function detectPipelineCaps(gl: WebGLRenderingContext): PipelineCaps {
  const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
  const halfFloatRenderable = isWebGL2
    ? gl.getExtension('EXT_color_buffer_float') !== null || gl.getExtension('EXT_color_buffer_half_float') !== null
    : gl.getExtension('OES_texture_half_float') !== null
  return { isWebGL2, halfFloatRenderable }
}

/** 全屏交换 pass 的顶点着色器（投影就是 clip 空间直通，两代 GL 通用）。 */
const FULLSCREEN_VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_uv = a_position * 0.5 + 0.5;
}`

/** 拷贝 pass：原样取样（预乘 alpha 语义由调用方保证纹理一致）。 */
export const COPY_FRAGMENT = `
precision mediump float;
uniform sampler2D u_texture;
varying vec2 v_uv;
void main() {
  gl_FragColor = texture2D(u_texture, v_uv);
}`

/** uniform 值：直接量或惰性函数（每帧求值——texelSize 这类随 resize 变化的值用函数）。 */
export type UniformValue = number | readonly number[] | (() => number | readonly number[])

/** 惰性 uniform 求值（任务 3 抽出的纯逻辑）：函数每次调用求值一次。 */
export function resolveUniformValue(value: UniformValue): readonly number[] {
  const resolved = typeof value === 'function' ? value() : value
  return typeof resolved === 'number' ? [resolved] : resolved
}

/** 自定义合成/pass 描述（uniform 值按名施加）。 */
export interface CompositeSpec {
  readonly fragment: string
  readonly uniforms?: Readonly<Record<string, UniformValue>>
}

/** 链上显式 pass：从 from RT 取样、画进 to RT（调用方自己管下标，ping-pong 可选）。 */
export interface PipelinePass extends CompositeSpec {
  readonly from: number
  readonly to: number
}

export interface RenderPipeline {
  /** 一帧开始：绑定场景 RT、清屏。之后场景内容照常画（此时画进离屏） */
  begin(): void
  /**
   * 在链上跑一个全屏 pass：从 sourceTexture 取样、着色器计算、画进**另一张** RT
   * （ping-pong 自动推进）。返回本次写入的 RT 下标（可喂给下一个 pass）。
   */
  drawFullscreen(fragmentSource: string, sourceTextureIndex: number, targetIndex: number): void
  /** 把链上某张 RT 画回画布后端缓冲（含视口重置）；给了 spec 则用自定义着色器合成（任务 2 起）。 */
  composite(textureIndex: number, spec?: CompositeSpec): void
  /** 依序跑帧内 pass（任务 3 起：FXAA 等挂这里），每项显式指定 from/to RT。 */
  runPasses(passes: readonly PipelinePass[]): void
  /** 建链时得到的 pass 数（RT 张数） */
  readonly length: number
  /** 取第 i 张 RT 的纹理（接线方把场景画进它 / 交给下一个 pass） */
  textureAt(index: number): WebGLTexture | undefined
  /** 画布尺寸变化：按 pixelRatio 重建 RT */
  resize(canvasWidth: number, canvasHeight: number): void
  readonly caps: PipelineCaps
  readonly precision: Precision
  dispose(): void
}

interface PassProgram {
  readonly program: WebGLProgram
  readonly uniformTexture: WebGLUniformLocation | null
  readonly attributePosition: number
  /** 具名 uniform 位置缓存（自定义合成用） */
  readonly uniforms: Map<string, WebGLUniformLocation | null>
}

/**
 * 建离屏骨架。`length` = RT 张数（≥2；任务 2 的后处理链会用到 3+）。
 * 绑定/状态纪律：pass 期间关闭混合（后处理是全屏不透明覆盖），结束时恢复。
 */
export function createRenderPipeline(
  gl: WebGLRenderingContext,
  length = 2,
  canvasSize: ViewportSize = { width: 1, height: 1 },
  pixelRatio = 1,
): RenderPipeline | undefined {
  const caps = detectPipelineCaps(gl)
  const precision = resolvePrecision(caps)
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  const vertexShader = compileGl(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX)
  if (!vertexShader) return undefined
  const quadBuffer = gl.createBuffer()
  if (!quadBuffer) return undefined
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  const programs = new Map<string, PassProgram | null>()
  let targets: { framebuffer: WebGLFramebuffer; texture: WebGLTexture }[] = []
  let size = computeRenderTargetSize(canvasSize, pixelRatio, maxTextureSize)

  const rebuild = (): void => {
    for (const target of targets) {
      gl.deleteFramebuffer(target.framebuffer)
      gl.deleteTexture(target.texture)
    }
    targets = []
    for (let index = 0; index < length; index++) {
      const texture = gl.createTexture()
      const framebuffer = gl.createFramebuffer()
      if (!texture || !framebuffer) continue
      gl.bindTexture(gl.TEXTURE_2D, texture)
      if (precision === 'half' && caps.isWebGL2) {
        // WebGL2 half-float RT（EXT_color_buffer_float 已探得可渲染）。
        // 0x881A = RGBA16F、0x140B = HALF_FLOAT（WebGL2 常量，WebGL1 类型面上没有，写字面值）
        gl.texImage2D(gl.TEXTURE_2D, 0, 0x881a, size.width, size.height, 0, gl.RGBA, 0x140b, null)
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size.width, size.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      targets.push({ framebuffer, texture })
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }
  rebuild()

  const programFor = (fragmentSource: string): PassProgram | null => {
    if (programs.has(fragmentSource)) return programs.get(fragmentSource) ?? null
    const fragmentShader = compileGl(gl, gl.FRAGMENT_SHADER, fragmentSource)
    if (!fragmentShader) {
      programs.set(fragmentSource, null)
      return null
    }
    const program = gl.createProgram()
    if (!program) {
      programs.set(fragmentSource, null)
      return null
    }
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    gl.deleteShader(fragmentShader)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[pipeline]', gl.getProgramInfoLog(program))
      programs.set(fragmentSource, null)
      return null
    }
    const entry: PassProgram = {
      program,
      uniformTexture: gl.getUniformLocation(program, 'u_texture'),
      attributePosition: gl.getAttribLocation(program, 'a_position'),
      uniforms: new Map(),
    }
    programs.set(fragmentSource, entry)
    return entry
  }

  const applyUniforms = (entry: PassProgram, uniforms: Readonly<Record<string, UniformValue>> | undefined): void => {
    if (!uniforms) return
    for (const [name, value] of Object.entries(uniforms)) {
      if (!entry.uniforms.has(name)) entry.uniforms.set(name, gl.getUniformLocation(entry.program, name))
      const location = entry.uniforms.get(name) ?? null
      if (location === null) continue
      const resolved = resolveUniformValue(value)
      if (resolved.length === 1) gl.uniform1f(location, resolved[0]!)
      else if (resolved.length === 2) gl.uniform2f(location, resolved[0]!, resolved[1]!)
      else if (resolved.length === 3) gl.uniform3f(location, resolved[0]!, resolved[1]!, resolved[2]!)
      else if (resolved.length === 4) gl.uniform4f(location, resolved[0]!, resolved[1]!, resolved[2]!, resolved[3]!)
    }
  }

  const drawQuad = (entry: PassProgram, source: WebGLTexture): void => {
    gl.useProgram(entry.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, source)
    gl.uniform1i(entry.uniformTexture, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
    gl.enableVertexAttribArray(entry.attributePosition)
    gl.vertexAttribPointer(entry.attributePosition, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  return {
    caps,
    precision,
    get length(): number {
      return targets.length
    },
    textureAt(index) {
      return targets[index]?.texture
    },
    begin() {
      const target = targets[0]
      if (!target) return
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
      gl.viewport(0, 0, size.width, size.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    },
    drawFullscreen(fragmentSource, sourceTextureIndex, targetIndex) {
      const entry = programFor(fragmentSource)
      const source = targets[sourceTextureIndex]?.texture
      const target = targets[targetIndex]
      if (!entry || !source || !target) return
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
      gl.viewport(0, 0, size.width, size.height)
      // 后处理是全屏不透明覆盖：关闭混合画，画完恢复（调用方原路径依赖混合）
      gl.disable(gl.BLEND)
      drawQuad(entry, source)
      gl.enable(gl.BLEND)
    },
    composite(textureIndex, spec) {
      const entry = programFor(spec?.fragment ?? COPY_FRAGMENT)
      const source = targets[textureIndex]?.texture
      if (!entry || !source) return
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.disable(gl.BLEND)
      gl.useProgram(entry.program)
      applyUniforms(entry, spec?.uniforms)
      drawQuad(entry, source)
      gl.enable(gl.BLEND)
    },
    runPasses(passes) {
      for (const pass of passes) {
        const entry = programFor(pass.fragment)
        const source = targets[pass.from]?.texture
        const target = targets[pass.to]
        if (!entry || !source || !target) continue
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
        gl.viewport(0, 0, size.width, size.height)
        gl.disable(gl.BLEND)
        gl.useProgram(entry.program)
        applyUniforms(entry, pass.uniforms)
        drawQuad(entry, source)
        gl.enable(gl.BLEND)
      }
    },
    resize(canvasWidth, canvasHeight) {
      const next = computeRenderTargetSize({ width: canvasWidth, height: canvasHeight }, pixelRatio, maxTextureSize)
      if (next.width === size.width && next.height === size.height) return
      size = next
      rebuild()
    },
    dispose() {
      for (const target of targets) {
        gl.deleteFramebuffer(target.framebuffer)
        gl.deleteTexture(target.texture)
      }
      targets = []
      gl.deleteBuffer(quadBuffer)
      for (const entry of programs.values()) if (entry) gl.deleteProgram(entry.program)
      programs.clear()
    },
  }
}

function compileGl(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | undefined {
  const shader = gl.createShader(type)
  if (!shader) return undefined
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[pipeline]', gl.getShaderInfoLog(shader))
    return undefined
  }
  return shader
}

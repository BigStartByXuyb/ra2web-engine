import { chromium } from 'playwright'

/**
 * WebGL2/WebGL1 能力探测（渲染现代化线任务 1，本项目自定工具）。
 *
 * 在真实 Chromium 里同时开 webgl2 与 webgl1 上下文，打印：上下文可用性、关键扩展矩阵、
 * 参数上限（纹理尺寸/采样数/各向异性）、渲染器标识，以及本项目渲染管线实际用到的能力逐项判定。
 * 用法：npx tsx tools/webgl2-probe.ts [--headed]
 */

const PROBE = `(() => {
  const result = { webgl2: null, webgl1: null, renderer: null }
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const EXTS_GL2 = [
    'EXT_color_buffer_float', 'EXT_texture_filter_anisotropic', 'OES_texture_float_linear',
    'EXT_color_buffer_half_float', 'WEBGL_compressed_texture_s3tc', 'EXT_frag_depth',
  ]
  const EXTS_GL1 = [
    'WEBGL_depth_texture', 'EXT_texture_filter_anisotropic', 'OES_texture_float_linear',
    'OES_standard_derivatives', 'EXT_shader_texture_lod', 'WEBGL_draw_buffers', 'EXT_frag_depth',
    'OES_element_index_uint', 'WEBGL_compressed_texture_s3tc',
  ]
  const probeCtx = (gl, exts) => {
    if (!gl) return null
    const info = {
      version: gl.getParameter(gl.VERSION),
      glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxSamples: gl.getParameter(gl.MAX_SAMPLES) ?? null,
      extensions: {},
      anisotropyMax: null,
    }
    for (const name of exts) info.extensions[name] = Boolean(gl.getExtension(name))
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic')
    if (aniso) info.anisotropyMax = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)
    return info
  }
  const gl2 = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true })
  result.webgl2 = probeCtx(gl2, EXTS_GL2)
  const canvas1 = document.createElement('canvas')
  const gl1 = canvas1.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true })
  result.webgl1 = probeCtx(gl1, EXTS_GL1)
  const any = gl2 || gl1
  if (any) {
    const dbg = any.getExtension('WEBGL_debug_renderer_info')
    result.renderer = dbg ? any.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : any.getParameter(any.RENDERER)
  }
  return result
})()`

async function main(): Promise<void> {
  const headed = process.argv.includes('--headed')
  const browser = await chromium.launch({ headless: !headed })
  const page = await browser.newPage()
  await page.goto('about:blank')
  const result = await page.evaluate(PROBE)
  console.log(JSON.stringify(result, null, 2))
  await browser.close()
}

void main()

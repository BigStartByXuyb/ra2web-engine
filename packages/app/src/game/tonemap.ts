/**
 * 色调映射 + 曝光（渲染现代化线任务 2，**本项目自定**——原版无此概念，现代增强项）。
 *
 * 算子：ACES filmic 的 Narkowicz 拟合（业界常用的单式近似）：
 *   f(x) = clamp((x(2.51x + 0.03)) / (x(2.43x + 0.59) + 0.14), 0, 1)
 * TS 版本是 GLSL 的逐字镜像——单测钉行为，着色器同式（改一处必须两处同改）。
 */

export interface TonemapParams {
  /** 曝光增益（线性域），本项目自定默认 1.15 */
  readonly exposure: number
  readonly enabled: boolean
}

export const TONEMAP_DEFAULTS: TonemapParams = { exposure: 1.15, enabled: true }

/** ACES Narkowicz 拟合（分量独立）。 */
export function acesApprox(rgb: readonly [number, number, number]): [number, number, number] {
  return [acesChannel(rgb[0]), acesChannel(rgb[1]), acesChannel(rgb[2])]
}

function acesChannel(x: number): number {
  const mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)
  return Math.min(1, Math.max(0, mapped))
}

/** 曝光 + 色调映射（关闭时原样返回——默认零影响的核心语义）。 */
export function applyTonemap(
  rgb: readonly [number, number, number],
  params: TonemapParams,
): [number, number, number] {
  if (!params.enabled) return [rgb[0], rgb[1], rgb[2]]
  const scaled: [number, number, number] = [rgb[0] * params.exposure, rgb[1] * params.exposure, rgb[2] * params.exposure]
  return acesApprox(scaled)
}

/**
 * 合成用 GLSL 片元（替换管线拷贝 pass；与上方 TS 同式）。
 * 预乘 alpha 语义：RT 内容是预乘的，先除回 alpha 做映射、再乘回，输出仍是预乘。
 */
export const TONEMAP_FRAGMENT = `
precision mediump float;
uniform sampler2D u_texture;
uniform float u_exposure;
uniform float u_tonemapOn;
varying vec2 v_uv;
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec4 texel = texture2D(u_texture, v_uv);
  vec3 straight = texel.rgb / max(texel.a, 0.0001);
  vec3 mapped = mix(straight, aces(straight * u_exposure), u_tonemapOn);
  gl_FragColor = vec4(mapped * texel.a, texel.a);
}`

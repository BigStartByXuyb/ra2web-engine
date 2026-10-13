/**
 * FXAA 3.11 紧凑版（Timothy Lottes；渲染现代化线任务 3，**本项目自定接入**）。
 *
 * 定位：离屏管线模式下场景绘进无 MSAA 的 RT，画布级 MSAA 失效——FXAA 作为链上 pass 补位
 * （直绘路径的画布 MSAA 保持不动）。作用在场景 RT（线性/HDR 域），alpha 取中心像素不参与模糊。
 */
export const FXAA_FRAGMENT = `
precision mediump float;
uniform sampler2D u_texture;
uniform vec2 u_texelSize;
varying vec2 v_uv;
void main() {
  vec3 rgbNW = texture2D(u_texture, v_uv + vec2(-1.0, -1.0) * u_texelSize).rgb;
  vec3 rgbNE = texture2D(u_texture, v_uv + vec2(1.0, -1.0) * u_texelSize).rgb;
  vec3 rgbSW = texture2D(u_texture, v_uv + vec2(-1.0, 1.0) * u_texelSize).rgb;
  vec3 rgbSE = texture2D(u_texture, v_uv + vec2(1.0, 1.0) * u_texelSize).rgb;
  vec4 center = texture2D(u_texture, v_uv);
  vec3 rgbM = center.rgb;
  vec3 luma = vec3(0.299, 0.587, 0.114);
  float lumaNW = dot(rgbNW, luma);
  float lumaNE = dot(rgbNE, luma);
  float lumaSW = dot(rgbSW, luma);
  float lumaSE = dot(rgbSE, luma);
  float lumaM = dot(rgbM, luma);
  float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
  vec2 dir = vec2(-((lumaNW + lumaNE) - (lumaSW + lumaSE)), ((lumaNW + lumaSW) - (lumaNE + lumaSE)));
  float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.25 * 0.03125, 0.0078125);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = min(vec2(8.0), max(vec2(-8.0), dir * rcpDirMin)) * u_texelSize;
  vec3 rgbA = 0.5 * (texture2D(u_texture, v_uv + dir * (1.0 / 3.0 - 0.5)).rgb +
                     texture2D(u_texture, v_uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(u_texture, v_uv - dir * 0.5).rgb +
                                   texture2D(u_texture, v_uv + dir * 0.5).rgb);
  float lumaB = dot(rgbB, luma);
  vec3 outRgb = (lumaB < lumaMin || lumaB > lumaMax) ? rgbA : rgbB;
  gl_FragColor = vec4(outRgb, center.a);
}`

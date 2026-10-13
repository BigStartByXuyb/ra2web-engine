/**
 * `?unitview=<单位名>` 模型检视模式（**本项目自定**调试入口，总工 2026-10-13 派单）。
 *
 * 单个单位模型大尺寸居中：拖拽转台（左右 = 绕竖轴转、上下 = 俯仰压扁）、滚轮缩放，
 * 缺省缓慢自转、炮塔以正弦摆动演示分件独立转向与枢轴（P0 验收用）——以后造型/发黑/
 * 炮塔枢轴的模型验收都走这里，不再依赖战场相机。
 *
 * 模型来源与战场一致：`/packs/units3d/<名>.glb` → `<名>-voxel.glb` 依次尝试（同一槽位口径）。
 * Esc 退出回战场页。**默认路径零影响**：没有这个参数时本模块一行不跑。
 */
import type { Camera } from './camera.js'
import { createUnit3dModel, createUnit3dRenderer, type Unit3dModel } from './webgl-unit3d.js'

/** 与 main.ts 的 `UNIT3D_SLOTS` 同口径：最好的一版 → 体素版 */
const SLOTS = ['', '-voxel'] as const
/** 自转速度（弧度/秒，本项目自定） */
const AUTO_SPIN = 0.45
/** 炮塔摆动幅度/速度（本项目自定：只为展示枢轴，原版转速口径未闭环） */
const TURRET_SWING = { amplitude: 0.9, speed: 0.8 }
/** 初始缩放：体素 1:1 落像素，坦克约 46 体素长，放大 8 倍铺满检视画面 */
const DEFAULT_ZOOM = 8

/** 有 `?unitview=` 就接管页面（单开一块覆盖画布）；返回值表示是否接管。 */
export function startUnitView(): boolean {
  const params = new URLSearchParams(location.search)
  const raw = params.get('unitview')
  if (raw === null || raw === '') return false
  // `&only=1` / `&only=0,1`：只画指定分组（车体 0 / 炮塔 1 / 炮管 2），分件定位排查用。
  // 空 token 必须先滤掉 —— `Number('') === 0` 会把"没传参数"变成"只画车体"（踩过一次）
  const only = (params.get('only') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
    .map((value) => Number(value))
    .filter((value) => value === 0 || value === 1 || value === 2)
  // `&tilt=<度>`：强制坡度俯仰（调试用，验证坡面姿态着色器路径；不传 = 0）
  const tiltDegrees = Number(params.get('tilt') ?? '0')
  const forcedTilt = Number.isFinite(tiltDegrees) ? (tiltDegrees * Math.PI) / 180 : 0
  void run(raw.toLowerCase(), only, forcedTilt)
  return true
}

async function run(name: string, onlyGroups: readonly number[], forcedTilt: number): Promise<void> {
  const canvas = document.createElement('canvas')
  canvas.id = 'unitview'
  canvas.style.cssText =
    'position:fixed;inset:0;width:100vw;height:100vh;background:#0a0d13;z-index:50;cursor:grab;touch-action:none'
  document.body.append(canvas)
  const status = document.getElementById('status')
  const hint = document.getElementById('hint')
  const say = (text: string): void => {
    if (status) status.textContent = text
  }
  say(`[模型检视] ${name.toUpperCase()}：装载中…`)
  if (hint) hint.textContent = '[模型检视] 拖拽转台 · 滚轮缩放 · Esc 退出'

  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: true,
    premultipliedAlpha: true,
    // 截图用例要靠它抓帧
    preserveDrawingBuffer: true,
  })
  if (!gl) {
    say('[模型检视] WebGL 不可用')
    return
  }
  const renderer = createUnit3dRenderer(gl)
  const model = await loadModel(gl, name)
  if (!model) {
    say(`[模型检视] 找不到模型：/packs/units3d/${name}*.glb`)
    return
  }
  say(`[模型检视] ${name.toUpperCase()} · ${model.primitives.length} 件 · 拖拽/滚轮/Esc`)
  console.info(
    `[模型检视] ${name}: ${model.primitives.length} 件 · 组=${model.primitives.map((p) => p.group).join('/')}` +
      ` · 顶点数=${model.primitives.map((p) => p.count).join('/')} · 高=${model.height}`,
  )
  for (const group of [0, 1, 2] as const) {
    const sample = model.primitives.find((p) => p.group === group)
    if (sample) {
      console.info(
        `[模型检视] 组${group}: nodeOffset=(${sample.nodeOffset.map((v) => v.toFixed(2)).join(', ')})` +
          ` pivotOffset=(${sample.pivotOffset.map((v) => v.toFixed(2)).join(', ')})`,
      )
    }
  }

  const camera: Camera = { x: 0, y: 0, zoom: DEFAULT_ZOOM, pixelRatio: window.devicePixelRatio || 1 }
  let yaw = Math.PI * 0.75
  let pitch = 1
  let dragging = false
  let lastX = 0
  let lastY = 0
  let lastInteraction = 0

  const resize = (): void => {
    camera.pixelRatio = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(window.innerWidth * camera.pixelRatio))
    canvas.height = Math.max(1, Math.floor(window.innerHeight * camera.pixelRatio))
    gl.viewport(0, 0, canvas.width, canvas.height)
  }
  resize()
  window.addEventListener('resize', resize)

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true
    lastX = event.clientX
    lastY = event.clientY
    lastInteraction = performance.now()
    canvas.style.cursor = 'grabbing'
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return
    yaw += (event.clientX - lastX) * 0.012
    // 上下拖 = 俯仰压扁（与 freecam 同一套伪 3D 口径），不真的换 3D 相机
    pitch = Math.min(1.5, Math.max(0.25, pitch + (event.clientY - lastY) * 0.004))
    lastX = event.clientX
    lastY = event.clientY
    lastInteraction = performance.now()
  })
  canvas.addEventListener('pointerup', (event) => {
    dragging = false
    canvas.style.cursor = 'grab'
    canvas.releasePointerCapture(event.pointerId)
  })
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      camera.zoom = Math.min(40, Math.max(1.5, camera.zoom * Math.exp(-event.deltaY * 0.001)))
      lastInteraction = performance.now()
    },
    { passive: false },
  )
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    const params = new URLSearchParams(location.search)
    params.delete('unitview')
    location.search = params.toString()
  })

  let lastFrameAt = performance.now()
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - lastFrameAt) / 1000)
    lastFrameAt = now
    // 拖拽或刚操作过 → 停自转；静置 1.5 秒后缓慢续转
    if (!dragging && now - lastInteraction > 1500) yaw += AUTO_SPIN * dt
    const swing = Math.sin((now / 1000) * TURRET_SWING.speed) * TURRET_SWING.amplitude

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.clearColor(0.04, 0.05, 0.075, 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    // 贴地锚点放画布中心偏下：模型从地面线上立起来，俯仰压扁也围绕这一点
    const scale = camera.zoom * camera.pixelRatio
    const shown =
      onlyGroups.length > 0
        ? { ...model, primitives: model.primitives.filter((p) => onlyGroups.includes(p.group)) }
        : model
    renderer.draw(camera, [
      {
        model: shown,
        worldX: canvas.width / (2 * scale),
        worldY: (canvas.height * 0.68) / scale,
        facing: yaw,
        turretFacing: swing,
        // `&tilt=` 强制坡度俯仰（调试）；默认 0 = 平地姿态
        slopePitch: forcedTilt,
      },
    ])
    // 俯仰压扁走 CSS（与 freecam 同一套伪 3D）：画布整体 scale(1, p)
    canvas.style.transform = `scale(1, ${pitch})`
    canvas.style.transformOrigin = '50% 68%'
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

async function loadModel(gl: WebGLRenderingContext, name: string): Promise<Unit3dModel | undefined> {
  for (const slot of SLOTS) {
    const url = `/packs/units3d/${name}${slot}.glb`
    try {
      const response = await fetch(url)
      console.info(`[模型检视] 尝试 ${url} → ${response.status}`)
      if (!response.ok) continue
      const model = await createUnit3dModel(gl, name.toUpperCase(), await response.arrayBuffer())
      console.info(`[模型检视] ${url} → ${model.primitives.length} 件`)
      return model
    } catch (error) {
      console.info(
        `[模型检视] 读 ${url} 失败（${error instanceof Error ? error.message : String(error)}），换下一个槽位`,
      )
    }
  }
  return undefined
}

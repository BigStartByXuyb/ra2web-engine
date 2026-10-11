import type { IsoView } from '@ra2web/render'

/**
 * 雨夜写实预设（测试档）的后处理：冷色调 + 湿地面反射 + 雨丝 + 泛光 + 暗角。
 *
 * 这一档**不改素材**，只在一个画面上叠后处理，用来测试"写实氛围"这条链：
 * 调色 → 反射 → 天气 → 泛光 → 暗角。换成真正的高清/写实素材、或者换成 WebGL 后端时，
 * 这套步骤与参数照样成立（那时泛光/反射会换成真正的 HDR 管线，而不是这里的近似）。
 *
 * 参考观感来自 AI 生成的"雨夜红警"概念图：冷蓝青基调、湿地面倒影、雨丝、辉光、压暗四角。
 * 那类图不是引擎实时渲染，所以这里做的是**同一氛围的近似**，不是复刻它的材质。
 */

export interface WetNightOptions {
  /** 帧时间戳（毫秒），用来推进雨丝 */
  readonly time: number
  /** 逻辑到屏幕的缩放，雨丝密度按它调整 */
  readonly scale: number
}

const GRADE_COLOR = 'rgba(10, 26, 44, 0.55)'
const BLOOM_COLOR = 'rgba(120, 190, 255, 0.16)'
const RAIN_COLOR = 'rgba(190, 220, 255, 0.30)'
const VIGNETTE = 'rgba(2, 6, 14, 0.72)'

/**
 * 湿地面倒影的形状：本体镜像一份，压扁到 `squash` 倍高度、整体半透明，再沿贴地线向上抬
 * `liftRatio × 格高`。`alpha` 到贴地线一侧不变、远端渐隐（见 WebGL 的 `u_fade`），
 * 否则镜像会把等距精灵读成"朝另一个方向的另一个物体"。
 * 2D 路径与 WebGL 路径共用这一份 —— 两条路径的倒影必须是同一个效果。
 */
export const WET_REFLECTION = { alpha: 0.28, squash: 0.6, liftRatio: 0.12 }

/** 泛光用的缩小画布：全分辨率模糊太贵，缩到 1/4 再放大回来。 */
let bloomCanvas: HTMLCanvasElement | undefined

/** 一个场景画完之后叠的整屏后处理。 */
export function applyWetNightGrade(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  options: WetNightOptions,
): void {
  const width = canvas.width
  const height = canvas.height
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)

  // 1) 冷色调 + 压暗
  context.globalCompositeOperation = 'multiply'
  context.fillStyle = GRADE_COLOR
  context.fillRect(0, 0, width, height)

  // 2) 泛光：把画面缩小后模糊，再加色叠回来
  bloomCanvas ??= document.createElement('canvas')
  const bloom = bloomCanvas
  bloom.width = Math.max(1, Math.floor(width / 4))
  bloom.height = Math.max(1, Math.floor(height / 4))
  const bloomContext = bloom.getContext('2d')
  if (bloomContext) {
    bloomContext.clearRect(0, 0, bloom.width, bloom.height)
    bloomContext.filter = 'blur(6px) brightness(1.35)'
    bloomContext.drawImage(canvas, 0, 0, bloom.width, bloom.height)
    bloomContext.filter = 'none'
    context.globalCompositeOperation = 'lighter'
    context.globalAlpha = 0.55
    context.drawImage(bloom, 0, 0, width, height)
    context.globalAlpha = 1
  }

  // 3) 冷色环境光
  context.globalCompositeOperation = 'lighter'
  context.fillStyle = BLOOM_COLOR
  context.fillRect(0, 0, width, height)

  // 4) 雨丝
  drawRain(context, width, height, options)

  // 5) 暗角
  context.globalCompositeOperation = 'source-over'
  const gradient = context.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.32,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.72,
  )
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
  gradient.addColorStop(1, VIGNETTE)
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  context.restore()
}

/**
 * 雨丝：固定数量的斜线，位置由一个确定性哈希给出，只靠时间平移。
 * 不引入随机数，所以两帧之间不会闪。
 */
function drawRain(context: CanvasRenderingContext2D, width: number, height: number, options: WetNightOptions): void {
  const drops = 220
  const length = 26 * Math.max(1, options.scale)
  const slant = length * 0.35
  const speed = 0.9 * Math.max(1, options.scale)
  context.save()
  context.globalCompositeOperation = 'lighter'
  context.strokeStyle = RAIN_COLOR
  context.lineWidth = Math.max(1, Math.round(options.scale))
  context.beginPath()
  for (let index = 0; index < drops; index++) {
    const seedX = hash(index * 3 + 1)
    const seedY = hash(index * 7 + 5)
    const x = seedX * width
    const travel = (height + length * 2) * 1
    const y = ((seedY * travel + options.time * speed) % travel) - length
    context.moveTo(x, y)
    context.lineTo(x + slant, y + length)
  }
  context.stroke()
  context.restore()
}

/** 确定性伪随机：同一个下标永远得到同一个 0..1 的值。 */
function hash(value: number): number {
  let x = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0
  return ((x ^ (x >>> 16)) >>> 0) / 0xffffffff
}

/**
 * 湿地面倒影：把一个精灵沿它的贴地线上下镜像画一份，压扁 + 低透明度。
 *
 * 贴地线是精灵自己的 `anchorY` 那一行；镜像后再把"离贴地线的距离"乘 `squash`，
 * 所以贴地点不动、远端贴向地面（这正是 WebGL 路径同一个式子的画布写法）。
 */
export function drawWetReflection(
  context: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  x: number,
  y: number,
  anchorY: number,
  view: IsoView,
): void {
  context.save()
  context.globalAlpha = WET_REFLECTION.alpha
  const groundY = y + anchorY
  context.translate(
    x,
    groundY + WET_REFLECTION.squash * anchorY - Math.round(view.cellHeight * WET_REFLECTION.liftRatio),
  )
  context.scale(1, -WET_REFLECTION.squash)
  context.drawImage(image, 0, 0)
  context.restore()
}

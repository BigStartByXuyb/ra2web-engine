import type { IsoView } from '@ra2web/render'

/**
 * 迷雾的图形：一格一块 60×30 的菱形，边界按**周围 8 个邻格**的探索情况做平滑衰减，
 * 不是一刀切的硬格边。
 *
 * 浓度规则：这一格的雾从"与已探索邻格相邻的那条边"开始往格心逐渐变浓 ——
 * 公共边处透明、格心处满浓度。四个正邻格各管一条边；四个斜邻格各管一个顶点
 * （菱形相邻两条边之间的那个角），因为斜向的邻格已探索时，只有顶点附近该被冲淡。
 *
 * 原版用的是 `shroud.shp` 的 96 帧（`conquer.mix` 里，每帧 60×30 菱形；像素值不是颜色，
 * 而是**浓度 0..127（64 级）**，254 = 格子外）。逐帧分类的结果：帧 0 是全实心格
 * （平均浓度 0.967），其余都是**菱形顶点/边附近的小块**，96 = 24 种覆盖块 × 4 档浓度 ——
 * 也就是原版按邻域可见情况挑一块贴上去，边界是平滑渐变。
 * **那 24 种块与邻接图案的对应表还没核实**，所以这里先用同一套几何自己算浓度；
 * 等拿到索引表就能原样换成档案里的帧。
 */

export interface FogSprites {
  /** 八邻域都没探索：整格实心 */
  readonly cell: HTMLCanvasElement
  /** 按八邻域掩码取图；掩码位 = `NEIGHBOURS` 里的次序，1 = 该邻格已探索 */
  spriteFor(mask: number): HTMLCanvasElement
}

/**
 * 边界渐隐跨几格。原版用 `shroud.shp` 的 96 帧做同一件事（24 种覆盖块 × 4 档浓度），
 * 逐格硬边会让人一眼看出"格子量化"的锯齿，所以这里把浓度摊到几格宽。
 */
export const FOG_FALLOFF_CELLS = 2.5

/** 一格迷雾的浓度倍率：离最近的已探索格越远越实，`falloff` 格外满浓度。 */
export function fogFadeFor(distance: number, falloff = FOG_FALLOFF_CELLS): number {
  if (distance <= 1) return Math.max(0, distance) / falloff
  return Math.min(1, distance / falloff)
}

/**
 * 八邻域次序：正邻格（东西南北）与斜邻格交替排列，
 * 这样第 i 个正邻格的两侧斜邻格正好是 `i*2-1` 与 `i*2+1`。
 * 屏幕方向与格坐标的对应：+x 落在右下、+y 落在左下。
 */
const NEIGHBOURS: readonly { readonly x: number; readonly y: number }[] = [
  { x: 1, y: 0 }, // 0 东  → 边 0
  { x: 1, y: 1 }, // 1 东南 → 顶点 0-1
  { x: 0, y: 1 }, // 2 南  → 边 1
  { x: -1, y: 1 }, // 3 西南 → 顶点 1-2
  { x: -1, y: 0 }, // 4 西  → 边 2
  { x: -1, y: -1 }, // 5 西北 → 顶点 2-3
  { x: 0, y: -1 }, // 6 北  → 边 3
  { x: 1, y: -1 }, // 7 东北 → 顶点 3-0
]

/**
 * 某条边（方向 0 东、1 南、2 西、3 北）从格心到该边的进度：格心 0、外边缘 1。
 * 菱形顶点在贴图坐标里是 上(30,0)、右(60,15)、下(30,30)、左(0,15)。
 */
function edgeProgress(direction: number, x: number, y: number): number {
  if (direction === 0) return (x + 2 * y - 60) / 30 // 东：外边缘是"右—下"那条边
  if (direction === 1) return (2 * y - x) / 30 // 南：外边缘是"下—左"
  if (direction === 2) return (60 - x - 2 * y) / 30 // 西：外边缘是"左—上"
  return (x - 2 * y) / 30 // 北：外边缘是"上—右"
}

function insideDiamond(x: number, y: number): boolean {
  return Math.abs(x - 30) / 30 + Math.abs(y - 15) / 15 <= 1
}

/** 衰减曲线：`progress` 越小（离已探索邻格越远）越浓。 */
function density(progress: number): number {
  return Math.min(1, Math.pow(Math.min(1, Math.max(0, 1 - progress)), 0.8))
}

export function createFogSprites(view: IsoView, color: string): FogSprites {
  const width = view.cellWidth
  const height = view.cellHeight
  const [red, green, blue] = parseColor(color)
  const cache = new Map<number, HTMLCanvasElement>()

  const make = (mask: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return canvas
    const image = context.createImageData(width, height)
    const revealed = NEIGHBOURS.map((_neighbour, index) => (mask & (1 << index)) !== 0)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = x + 0.5
        const py = y + 0.5
        if (!insideDiamond(px, py)) continue
        let alpha = 1
        for (let direction = 0; direction < 4; direction++) {
          const along = edgeProgress(direction, px, py)
          // 正邻格：只管这条边
          if (revealed[direction * 2]) alpha = Math.min(alpha, density(along))
          // 斜邻格：只管这个顶点（两条边进度取小者 = 靠近顶点）
          const next = (direction + 1) % 4
          if (revealed[direction * 2 + 1]) {
            alpha = Math.min(alpha, density(Math.min(along, edgeProgress(next, px, py))))
          }
        }
        const at = (y * width + x) * 4
        image.data[at] = red
        image.data[at + 1] = green
        image.data[at + 2] = blue
        image.data[at + 3] = Math.round(alpha * 255)
      }
    }
    context.putImageData(image, 0, 0)
    return canvas
  }

  const cell = make(0)
  return {
    cell,
    spriteFor(mask) {
      if (mask === 0) return cell
      let sprite = cache.get(mask)
      if (!sprite) {
        sprite = make(mask)
        cache.set(mask, sprite)
      }
      return sprite
    },
  }
}

/** 画一格迷雾：格子坐标决定取哪张图（按八邻域掩码），屏幕坐标决定贴在哪。 */
export function blitFogCell(
  context: CanvasRenderingContext2D,
  sprites: FogSprites,
  cell: { readonly x: number; readonly y: number },
  screenX: number,
  screenY: number,
  isExplored: (x: number, y: number) => boolean,
): void {
  let mask = 0
  for (let index = 0; index < NEIGHBOURS.length; index++) {
    const neighbour = NEIGHBOURS[index]!
    if (isExplored(cell.x + neighbour.x, cell.y + neighbour.y)) mask |= 1 << index
  }
  // 边界不能只有"一格宽"：按到最近已探索格的距离再摊几格，并加一点逐格扰动，
  // 否则可见区就是一个每格 60×30 的硬台阶（"锯齿"就是这么来的）
  const fade = fogFadeFor(exploredDistance(cell, isExplored))
  context.globalAlpha = fade * (0.92 + 0.08 * hashCell(cell.x, cell.y))
  context.drawImage(sprites.spriteFor(mask), screenX, screenY)
  context.globalAlpha = 1
}

/** 到最近已探索格的距离（切比雪夫，格为单位；找不到就返回扫描半径 +1）。 */
export function exploredDistance(
  cell: { readonly x: number; readonly y: number },
  isExplored: (x: number, y: number) => boolean,
  radius = 4,
): number {
  for (let distance = 1; distance <= radius; distance++) {
    for (let dy = -distance; dy <= distance; dy++) {
      for (let dx = -distance; dx <= distance; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== distance) continue
        if (isExplored(cell.x + dx, cell.y + dy)) return distance
      }
    }
  }
  return radius + 1
}

/** 逐格扰动（确定性）：边界有一点点不规则，不再像网格线。 */
function hashCell(x: number, y: number): number {
  let value = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y, 0xc2b2ae35)
  value = Math.imul(value ^ (value >>> 13), 0x27d4eb2f)
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff
}

function parseColor(color: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(color)
  if (!match) return [5, 6, 10]
  const value = Number.parseInt(match[1]!, 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

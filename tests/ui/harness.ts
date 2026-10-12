import fs from 'node:fs'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { DEFAULT_OVERRIDES_DIR, DEFAULT_PACK_DIR, startGameServer, type GameServer } from '../../tools/serve-game.js'
import { decodePng, decodePngBytes, type PngImage } from './png.js'

/**
 * 战场页的 UI 测试脚手架：起静态服务 → 开浏览器 → 按 URL 参数装载档案与开战 → 截图，
 * 再对截图做像素比对。所有用例共用同一个浏览器与同一份截图缓存，避免重复装载 280MB 的 RA2.MIX。
 *
 * 需要玩家自备的原版档案：缺档时整批 UI 用例走"跳过"，与 `vanilla:*` 那批单元测试同一口径。
 */

/** 截图固定 1600×900：界面面板的位置随之固定，比对时可以按下面这三块忽略掉文字变化。 */
export const VIEWPORT = { width: 1600, height: 900 }
/**
 * 左上 HUD、右侧操作面板、底部提示条：它们的文字会变，但不是画面差异。
 *
 * 左上这一块的宽高按 `#hud` 的实测外框取（427×151，落在 (12,12)）—— 只按 250 宽排除的话，
 * 面板右侧的数值（tick、帧率）会一直被算成画面差异。
 */
export const UI_PANELS = [
  { x: 0, y: 0, w: 445, h: 170 },
  { x: 1288, y: 0, w: 312, h: 420 },
  { x: 0, y: 828, w: VIEWPORT.width, h: VIEWPORT.height - 828 },
]

export interface CaptureRequest {
  /** 截图文件名（同时当缓存键） */
  readonly name: string
  /** 追加到 game.html 的查询串，例如 `renderer=webgl&reflect=1` */
  readonly query?: string
  /** 画质预设：pixel / hd / wetNight */
  readonly quality?: string
  /** 是否按 URL 直接开战（默认 true） */
  readonly battle?: boolean
  /** 换一张地图档案（默认用会话起的那一份），例如剧场比对要一次走三份图 */
  readonly map?: string
  /** 换地图档案里的第几张（默认用会话起的序号） */
  readonly mapIndex?: number
  /** 就绪后再等这么久（毫秒），让首帧与美术加载完 */
  readonly settleMs?: number
}

export interface UiSession {
  readonly origin: string
  readonly page: Page
  /** 同一 name 只截一次，后续调用直接返回缓存 */
  capture(request: CaptureRequest): Promise<PngImage>
  /** 该次截图装载完成后状态行里的原文；没截过这个名字时返回 undefined */
  statusText(name: string): string | undefined
  /** 给当前页面状态照一张（不重新装载），供交互用例比对 */
  snapshot(name: string): Promise<PngImage>
  /**
   * 不落盘地取一块画面：直接从战场画布上抠出来。
   *
   * 连拍要靠它 —— `page.screenshot` 一次要 380~650 毫秒，比逻辑帧（66.7 毫秒）长得多，
   * 那样根本抓不到"每个 tick 都在动"；这一条只花几十毫秒。
   */
  sampleRegion(rect: { x: number; y: number; w: number; h: number }): Promise<PngImage>
  close(): Promise<void>
}

export interface UiSessionOptions {
  readonly outDir?: string
  readonly packDir?: string
  readonly map?: string
  readonly mapIndex?: number
  readonly headless?: boolean
}

export const MAP_FILE = 'Maps01.mix'

/** 原版档案是否齐（缺就跳过整批 UI 用例）。 */
export function missingVanillaAssets(packDir: string): string | undefined {
  for (const file of ['RA2.MIX', MAP_FILE]) {
    if (!fs.existsSync(join(packDir, file))) return join(packDir, file)
  }
  return undefined
}

export async function openUiSession(options: UiSessionOptions = {}): Promise<UiSession> {
  const packDir = resolve(options.packDir ?? process.env.RA2_PACK_DIR ?? DEFAULT_PACK_DIR)
  const missing = missingVanillaAssets(packDir)
  if (missing !== undefined) throw new Error(`缺少原版档案：${missing}`)

  const outDir = resolve(options.outDir ?? 'tests/ui/out')
  mkdirSync(outDir, { recursive: true })
  const server: GameServer = await startGameServer({
    packDir,
    overridesDir: DEFAULT_OVERRIDES_DIR,
    port: 0,
  })
  const browser: Browser = await chromium.launch({ headless: options.headless ?? true })
  const page = await browser.newPage({ viewport: VIEWPORT })
  const mapIndex = options.mapIndex ?? 0
  const mapFile = options.map ?? MAP_FILE
  const cache = new Map<string, PngImage>()
  const statuses = new Map<string, string>()

  page.on('pageerror', (error) => console.error(`[页面报错] ${error.message}`))

  const capture = async (request: CaptureRequest): Promise<PngImage> => {
    const cached = cache.get(request.name)
    if (cached) return cached
    const params = new URLSearchParams()
    params.set('mix', '/pack/RA2.MIX')
    params.set('map', `/pack/${request.map ?? mapFile}`)
    params.set('index', String(request.mapIndex ?? mapIndex))
    if (request.battle ?? true) params.set('battle', '1')
    for (const [key, value] of new URLSearchParams(request.query ?? '')) params.set(key, value)

    await page.goto(`${server.origin}/game.html?${params.toString()}`, { waitUntil: 'load' })
    await page.waitForSelector('#mix-file')
    await page.waitForFunction(
      () => {
        const text = document.getElementById('status')?.textContent ?? ''
        return /(建筑 \d+ 个|单位 \d+ 辆)/.test(text) && !text.includes('读取')
      },
      undefined,
      { timeout: 300000 },
    )
    if (request.quality !== undefined) await page.selectOption('#quality', request.quality)
    await page.waitForTimeout(request.settleMs ?? 4000)
    statuses.set(request.name, await page.evaluate(() => document.getElementById('status')?.textContent ?? ''))
    const file = join(outDir, `${request.name}.png`)
    await page.screenshot({ path: file })
    const image = decodePng(file)
    cache.set(request.name, image)
    return image
  }

  const snapshot = async (name: string): Promise<PngImage> => {
    const file = join(outDir, `${name}.png`)
    await page.screenshot({ path: file })
    return decodePng(file)
  }

  const sampleRegion = async (rect: { x: number; y: number; w: number; h: number }): Promise<PngImage> => {
    const dataUrl = await page.evaluate(({ x, y, w, h }) => {
      const scratch = document.createElement('canvas')
      scratch.width = w
      scratch.height = h
      const scratchContext = scratch.getContext('2d')
      if (!scratchContext) throw new Error('取不到 2D 上下文')
      // 战场是多块画布叠出来的（WebGL 层 + 2D 层），按 DOM 顺序叠着画一遍才是眼睛看到的那张
      const canvases = Array.from(document.querySelectorAll('canvas')).filter((element) => {
        if (!(element instanceof HTMLCanvasElement)) return false
        const bounds = element.getBoundingClientRect()
        return bounds.width > 0 && bounds.height > 0
      })
      if (canvases.length === 0) throw new Error('页面上没有可见画布')
      for (const canvas of canvases) {
        const bounds = canvas.getBoundingClientRect()
        scratchContext.drawImage(
          canvas,
          0,
          0,
          canvas.width,
          canvas.height,
          bounds.left - x,
          bounds.top - y,
          bounds.width,
          bounds.height,
        )
      }
      return scratch.toDataURL('image/png')
    }, rect)
    return decodePngBytes(new Uint8Array(Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')))
  }

  return {
    origin: server.origin,
    page,
    capture,
    statusText: (name) => statuses.get(name),
    snapshot,
    sampleRegion,
    close: async () => {
      await browser.close()
      await server.close()
    },
  }
}

export interface DiffResult {
  /** 差异像素数（忽略界面面板、单通道阈值 24） */
  readonly changed: number
  /** 差异里"变亮"的像素数：原先有东西、现在没了（或被更亮的东西替换） */
  readonly brighter: number
  /** 差异里"变暗"的像素数：原先没有、现在画上了（或被更暗的东西替换） */
  readonly darker: number
  readonly sample: { readonly x: number; readonly y: number } | undefined
  /** 差异像素的包围盒（没差异时宽高为 0），用来判"只改了画面里的哪一块" */
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}

/** 两张同尺寸截图比差异；只统计画面区域，界面面板不算。 */
export function diffImages(before: PngImage, after: PngImage): DiffResult {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(`尺寸不同：${before.width}x${before.height} vs ${after.width}x${after.height}`)
  }
  const inPanel = (x: number, y: number): boolean =>
    UI_PANELS.some((panel) => x >= panel.x && x < panel.x + panel.w && y >= panel.y && y < panel.y + panel.h)
  let changed = 0
  let brighter = 0
  let darker = 0
  let sample: { x: number; y: number } | undefined
  let minX = before.width
  let minY = before.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < before.height; y++) {
    for (let x = 0; x < before.width; x++) {
      if (inPanel(x, y)) continue
      const at = (y * before.width + x) * 4
      const delta =
        Math.abs(before.pixels[at]! - after.pixels[at]!) +
        Math.abs(before.pixels[at + 1]! - after.pixels[at + 1]!) +
        Math.abs(before.pixels[at + 2]! - after.pixels[at + 2]!)
      if (delta <= 24) continue
      changed++
      const beforeSum = before.pixels[at]! + before.pixels[at + 1]! + before.pixels[at + 2]!
      const afterSum = after.pixels[at]! + after.pixels[at + 1]! + after.pixels[at + 2]!
      if (afterSum > beforeSum) brighter++
      else if (afterSum < beforeSum) darker++
      sample ??= { x, y }
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  return {
    changed,
    brighter,
    darker,
    sample,
    box:
      maxX < 0
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  }
}

/**
 * 只比一块矩形里的差异：用于"只关心某个物体附近发生了什么"的用例。
 *
 * 矩形用整帧坐标给出，`UI_PANELS` 不参与判断 —— 排除面板是为了整帧比对时不把界面文字算进画面，
 * 而这里的矩形是调用方自己选的（比如单位所在的一小块，本来就不含面板）。
 */
export function diffImagesWithin(
  before: PngImage,
  after: PngImage,
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
): DiffResult {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(`尺寸不同：${before.width}x${before.height} vs ${after.width}x${after.height}`)
  }
  const x0 = Math.max(0, rect.x)
  const y0 = Math.max(0, rect.y)
  const x1 = Math.min(before.width, rect.x + rect.w)
  const y1 = Math.min(before.height, rect.y + rect.h)
  let changed = 0
  let brighter = 0
  let darker = 0
  let sample: { x: number; y: number } | undefined
  let minX = before.width
  let minY = before.height
  let maxX = -1
  let maxY = -1
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const at = (y * before.width + x) * 4
      const delta =
        Math.abs(before.pixels[at]! - after.pixels[at]!) +
        Math.abs(before.pixels[at + 1]! - after.pixels[at + 1]!) +
        Math.abs(before.pixels[at + 2]! - after.pixels[at + 2]!)
      if (delta <= 24) continue
      changed++
      const beforeSum = before.pixels[at]! + before.pixels[at + 1]! + before.pixels[at + 2]!
      const afterSum = after.pixels[at]! + after.pixels[at + 1]! + after.pixels[at + 2]!
      if (afterSum > beforeSum) brighter++
      else if (afterSum < beforeSum) darker++
      sample ??= { x, y }
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  return {
    changed,
    brighter,
    darker,
    sample,
    box:
      maxX < 0
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  }
}

/** 一块区域的平均色，用来判断"画面是不是被整层盖住了"。 */
export function meanColor(image: PngImage, rect: { x: number; y: number; w: number; h: number }): number {
  let total = 0
  let count = 0
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const at = (y * image.width + x) * 4
      total += image.pixels[at]! + image.pixels[at + 1]! + image.pixels[at + 2]!
      count += 3
    }
  }
  return total / count
}

/**
 * 一条水平线上的"暗→亮"过渡宽度（像素）：迷雾边界是渐隐还是硬边，看这个数。
 * 硬边只有 1~2 像素，摊开几格的渐隐会有几十像素。
 */
export function transitionWidth(
  image: PngImage,
  line: { readonly y: number; readonly xFrom: number; readonly xTo: number },
): number {
  const luminance = (x: number): number => {
    const at = (line.y * image.width + x) * 4
    return image.pixels[at]! + image.pixels[at + 1]! + image.pixels[at + 2]!
  }
  let darkest = Number.POSITIVE_INFINITY
  let brightest = 0
  for (let x = line.xFrom; x <= line.xTo; x++) {
    const value = luminance(x)
    darkest = Math.min(darkest, value)
    brightest = Math.max(brightest, value)
  }
  const low = darkest + (brightest - darkest) * 0.15
  const high = darkest + (brightest - darkest) * 0.85
  let start = -1
  let end = -1
  for (let x = line.xFrom; x <= line.xTo; x++) {
    const value = luminance(x)
    if (value >= low && start < 0) start = x
    if (value >= high) {
      end = x
      break
    }
  }
  return start < 0 || end < 0 ? 0 : end - start + 1
}

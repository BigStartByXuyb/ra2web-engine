import fs from 'node:fs'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { DEFAULT_OVERRIDES_DIR, DEFAULT_PACK_DIR, startGameServer, type GameServer } from '../../tools/serve-game.js'
import { decodePng, type PngImage } from './png.js'

/**
 * 战场页的 UI 测试脚手架：起静态服务 → 开浏览器 → 按 URL 参数装载档案与开战 → 截图，
 * 再对截图做像素比对。所有用例共用同一个浏览器与同一份截图缓存，避免重复装载 280MB 的 RA2.MIX。
 *
 * 需要玩家自备的原版档案：缺档时整批 UI 用例走"跳过"，与 `vanilla:*` 那批单元测试同一口径。
 */

/** 截图固定 1600×900：界面面板的位置随之固定，比对时可以按下面这三块忽略掉文字变化。 */
export const VIEWPORT = { width: 1600, height: 900 }
/** 左上 HUD、右侧操作面板、底部提示条：它们的文字会变，但不是画面差异。 */
export const UI_PANELS = [
  { x: 0, y: 0, w: 250, h: 160 },
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

  return {
    origin: server.origin,
    page,
    capture,
    statusText: (name) => statuses.get(name),
    snapshot,
    close: async () => {
      await browser.close()
      await server.close()
    },
  }
}

export interface DiffResult {
  /** 差异像素数（忽略界面面板、单通道阈值 24） */
  readonly changed: number
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
      sample ??= { x, y }
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  return {
    changed,
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

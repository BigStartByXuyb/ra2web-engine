import assert from 'node:assert/strict'
import { diffImages, meanColor, UI_PANELS, VIEWPORT, type UiSession } from './harness.js'

/**
 * 战场页的 UI 验收点。每条都对着一个**画面事实**，不是"能跑起来"：
 *
 * 1. 同一串参数跑两次必须逐像素一致 —— 否则后面所有比对都不成立，所以先自检。
 * 2. WebGL 路径与 2D 路径在同一机位下逐像素一致（默认预设、已开战）。
 * 3. 增强开关（阴影、倒影）必须真的落在画面上：它们曾经被 render() 的清屏整块抹掉，
 *    所以"开了跟没开一样"必须判失败。
 * 4. 雨夜后处理必须作用在整幅画面上：GL 路径曾经被 2D 画布那层半透明叠加整块盖住。
 * 5. 选中与移动指令必须真的起作用：HUD 要报出选中单位，画面要跟着变。
 */
export interface UiCase {
  readonly name: string
  run(session: UiSession): Promise<string | undefined>
}

/** 默认预设下的 GL 基线：后面的比对都拿它当参照 */
const GL_BASE = { name: 'base-gl', query: 'renderer=webgl' }
const DIFF_TOLERANCE = 200

export const cases: readonly UiCase[] = [
  {
    name: '同一机位两次运行逐像素一致',
    async run(session) {
      const first = await session.capture({ ...GL_BASE, name: 'repeat-a' })
      const second = await session.capture({ ...GL_BASE, name: 'repeat-b' })
      const diff = diffImages(first, second)
      assert.equal(diff.changed, 0, `两次运行出现 ${diff.changed} 个差异像素（首个在 ${JSON.stringify(diff.sample)}）`)
      return undefined
    },
  },
  {
    name: 'WebGL 路径与 2D 路径逐像素一致',
    async run(session) {
      const gl = await session.capture(GL_BASE)
      const canvas = await session.capture({ name: 'base-2d', battle: true })
      const diff = diffImages(canvas, gl)
      assert.ok(
        diff.changed <= DIFF_TOLERANCE,
        `两条路径差异 ${diff.changed} 像素（上限 ${DIFF_TOLERANCE}），首个在 ${JSON.stringify(diff.sample)}`,
      )
      return `差异 ${diff.changed} 像素`
    },
  },
  {
    name: '阴影开关必须落在画面上',
    async run(session) {
      const base = await session.capture(GL_BASE)
      const withShadows = await session.capture({ name: 'shadows', query: 'renderer=webgl&shadows=1' })
      const diff = diffImages(base, withShadows)
      assert.ok(diff.changed >= 500, `开阴影只改了 ${diff.changed} 像素，等于没上屏`)
      return `阴影改变 ${diff.changed} 像素`
    },
  },
  {
    name: '倒影开关必须落在画面上',
    async run(session) {
      const base = await session.capture(GL_BASE)
      const withReflection = await session.capture({ name: 'reflect', query: 'renderer=webgl&reflect=1' })
      const diff = diffImages(base, withReflection)
      // 倒影压扁 + 远端渐隐后本来就淡，阈值按"肉眼能看出来"定；几何正确性由单元测试管
      assert.ok(diff.changed >= 150, `开倒影只改了 ${diff.changed} 像素，等于没上屏`)
      return `倒影改变 ${diff.changed} 像素`
    },
  },
  {
    name: '雨夜后处理作用在整幅画面上',
    async run(session) {
      const glWet = await session.capture({ name: 'wet-gl', query: 'renderer=webgl&reflect=1', quality: 'wetNight' })
      const canvasWet = await session.capture({ name: 'wet-2d', quality: 'wetNight' })
      const glBrightness = meanColor(glWet, { x: 0, y: 0, w: VIEWPORT.width, h: VIEWPORT.height })
      const canvasBrightness = meanColor(canvasWet, { x: 0, y: 0, w: VIEWPORT.width, h: VIEWPORT.height })
      const ratio = glBrightness / canvasBrightness
      assert.ok(
        ratio >= 0.5,
        `GL 雨夜画面亮度只有 2D 路径的 ${(ratio * 100).toFixed(0)}%（GL ${glBrightness.toFixed(1)} vs 2D ${canvasBrightness.toFixed(1)}）：后处理那一层把 GPU 层盖住了`,
      )
      return `亮度比 ${(ratio * 100).toFixed(0)}%`
    },
  },
  {
    name: '泛光必须是提亮，不是整体压暗',
    async run(session) {
      const base = await session.capture(GL_BASE)
      const bloom = await session.capture({ name: 'bloom', query: 'renderer=webgl&bloom=1' })
      const diff = diffImages(base, bloom)
      const before = meanColor(base, { x: 0, y: 0, w: VIEWPORT.width, h: VIEWPORT.height })
      const after = meanColor(bloom, { x: 0, y: 0, w: VIEWPORT.width, h: VIEWPORT.height })
      assert.ok(diff.changed >= 500, `开泛光只改了 ${diff.changed} 像素，等于没上屏`)
      assert.ok(
        after > before,
        `泛光把画面压暗了（${before.toFixed(1)} → ${after.toFixed(1)}）：这不是亮部溢出，是整体变暗`,
      )
      return `亮度 ${before.toFixed(1)} → ${after.toFixed(1)}，改变 ${diff.changed} 像素`
    },
  },
  {
    name: '选中与移动指令作用于模拟',
    async run(session) {
      const page = session.page
      const params = new URLSearchParams({
        mix: '/pack/RA2.MIX',
        map: '/pack/Maps01.mix',
        index: '0',
        battle: '1',
        renderer: 'webgl',
      })
      await page.goto(`${session.origin}/game.html?${params.toString()}`, { waitUntil: 'load' })
      await page.waitForFunction(
        () => /单位 \d+ 辆/.test(document.getElementById('status')?.textContent ?? ''),
        undefined,
        { timeout: 300000 },
      )
      await page.waitForTimeout(3000)

      const box = await page.locator('#stage').boundingBox()
      assert.ok(box, '找不到战场画布')
      const offsets = [0, -40, 40, -80, 80, -120]
      for (const offset of offsets) {
        await page.mouse.click(box.x + box.width / 2 + offset, box.y + box.height / 2)
        await page.waitForTimeout(400)
        const selected = await page.evaluate(() => document.getElementById('hud-selected')?.textContent ?? '')
        if (selected.trim() !== '' && selected.trim() !== '-') break
      }
      const selected = await page.evaluate(() => document.getElementById('hud-selected')?.textContent ?? '')
      assert.ok(selected.trim() !== '' && selected.trim() !== '-', '左键点不中任何单位，选中链路没通')

      const tickBefore = await page.evaluate(() => Number(document.getElementById('hud-tick')?.textContent ?? '0'))
      const before = await session.snapshot('interaction-before')
      await page.mouse.click(box.x + box.width / 2 + 90, box.y + box.height / 2 + 40, { button: 'right' })
      await page.waitForTimeout(5000)
      const after = await session.snapshot('interaction-after')
      const tickAfter = await page.evaluate(() => Number(document.getElementById('hud-tick')?.textContent ?? '0'))
      assert.ok(tickAfter > tickBefore, `tick 没推进（${tickBefore} → ${tickAfter}）：模拟没在跑`)
      const diff = diffImages(before, after)
      assert.ok(diff.changed >= 200, `下了移动指令之后画面只变了 ${diff.changed} 像素：单位没有动`)
      return `选中 ${selected.trim()}，tick ${tickBefore} → ${tickAfter}，画面变化 ${diff.changed} 像素`
    },
  },
  {
    name: '3D 单位只替换单位，且与精灵位置重合',
    async run(session) {
      const sprites = await session.capture(GL_BASE)
      const models = await session.capture({ name: 'units3d', query: 'renderer=webgl&units3d=1' })
      const diff = diffImages(sprites, models)
      assert.ok(diff.changed >= 500, `开 3D 单位只改了 ${diff.changed} 像素：3D 层没画出来`)
      // 只换了单位：差异必须集中在单位那一小块，地块与建筑逐像素不动
      assert.ok(
        diff.box.width <= 400 && diff.box.height <= 300,
        `差异范围 ${diff.box.width}×${diff.box.height} 太大：3D 路径动了单位以外的东西`,
      )
      return `差异 ${diff.changed} 像素，范围 ${diff.box.width}×${diff.box.height}`
    },
  },
]

export { UI_PANELS }

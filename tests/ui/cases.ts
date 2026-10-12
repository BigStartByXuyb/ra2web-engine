import assert from 'node:assert/strict'
import {
  diffImages,
  diffImagesWithin,
  meanColor,
  transitionWidth,
  UI_PANELS,
  VIEWPORT,
  type UiSession,
} from './harness.js'
import type { PngImage } from './png.js'

/**
 * 战场页的 UI 验收点。每条都对着一个**画面事实**，不是"能跑起来"：
 *
 * 1. 同一串参数跑两次必须逐像素一致 —— 否则后面所有比对都不成立，所以先自检。
 * 2. WebGL 路径与 2D 路径在同一机位下逐像素一致（默认预设、已开战）。
 * 3. 增强开关（阴影、倒影）必须真的落在画面上：它们曾经被 render() 的清屏整块抹掉，
 *    所以"开了跟没开一样"必须判失败。
 * 4. 雨夜后处理必须作用在整幅画面上：GL 路径曾经被 2D 画布那层半透明叠加整块盖住。
 * 5. 选中与移动指令必须真的起作用：HUD 要报出选中单位，画面要跟着变。
 * 6. 三个剧场（雪地/城市/温带）各刷一帧：地块美术与建筑层要按各自的剧场档案取到图，
 *    而且换图必须真的换到画面上 —— 只装一份档案的话，"支持剧场"这条线等于没测。
 */
export interface UiCase {
  readonly name: string
  run(session: UiSession): Promise<string | undefined>
}

/** 默认预设下的 GL 基线：后面的比对都拿它当参照 */
const GL_BASE = { name: 'base-gl', query: 'renderer=webgl&units3d=0' }
/**
 * 两条绘制路径（canvas2D 与 WebGL）的允许差异。
 *
 * 基线场景不含单位，所以 MSAA 只作用在相邻地块共享的四边形边上，逐像素差异实测仍是 0；
 * 3D 单位那一块的差异由下面的「3D 单位只替换单位」用例单独卡。
 */
const DIFF_TOLERANCE = 200

/**
 * 三个剧场的代表图（都在 MULTI.MIX 里）：地块美术、覆盖物、建筑贴图分别来自
 * snow / urban / temperate 三套剧场档案，任一套取不到图，这一帧就会露。
 */
const THEATER_MAPS = [
  { theater: '雪地', map: 'MULTI.MIX', mapIndex: 57 },
  { theater: '城市', map: 'MULTI.MIX', mapIndex: 9 },
  { theater: '温带', map: 'MULTI.MIX', mapIndex: 12 },
] as const

/**
 * 开一局（默认地图第 0 张）、点中一个单位、朝右下方下一道移动指令。
 *
 * 选中与下令这一段是几条用例共用的：谁要判画面，谁自己接着截图。
 */
async function selectAndMove(session: UiSession): Promise<{
  readonly box: { x: number; y: number; width: number; height: number }
  readonly selected: string
  readonly tickBefore: number
  /** 点中单位时用的画布坐标：单位就在这附近（拾取半径 22 像素以内） */
  readonly clickedAt: { x: number; y: number }
  /** 移动指令落点的画布坐标：单位会走到这一格 */
  readonly moveTarget: { x: number; y: number }
}> {
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
    {
      timeout: 300000,
    },
  )
  await page.waitForTimeout(3000)

  const box = await page.locator('#stage').boundingBox()
  assert.ok(box, '找不到战场画布')
  const offsets = [0, -40, 40, -80, 80, -120]
  let clickedAt = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  for (const offset of offsets) {
    clickedAt = { x: box.x + box.width / 2 + offset, y: box.y + box.height / 2 }
    await page.mouse.click(clickedAt.x, clickedAt.y)
    await page.waitForTimeout(400)
    const selected = await page.evaluate(() => document.getElementById('hud-selected')?.textContent ?? '')
    if (selected.trim() !== '' && selected.trim() !== '-') break
  }
  const selected = await page.evaluate(() => document.getElementById('hud-selected')?.textContent ?? '')
  assert.ok(selected.trim() !== '' && selected.trim() !== '-', '左键点不中任何单位，选中链路没通')

  const tickBefore = await page.evaluate(() => Number(document.getElementById('hud-tick')?.textContent ?? '0'))
  const moveTarget = { x: box.x + box.width / 2 + 90, y: box.y + box.height / 2 + 40 }
  await page.mouse.click(moveTarget.x, moveTarget.y, { button: 'right' })
  // 等指令真的生效（路径变成非 0）再往下走：不等的话，后面"等走到位"会立刻看到上一次的
  // 路径 0 直接通过，于是"回程"下在了原地 —— 单位根本没动。
  await page.waitForFunction(
    () => /路径 [1-9]/.test(document.getElementById('hud-selected')?.textContent ?? ''),
    undefined,
    { timeout: 30000 },
  )
  return { box, selected: selected.trim(), tickBefore, clickedAt, moveTarget }
}

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
    name: 'WebGL 路径与 2D 路径画的是同一张图',
    async run(session) {
      const gl = await session.capture(GL_BASE)
      const canvas = await session.capture({ name: 'base-2d', battle: true, query: 'units3d=0' })
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
      const withShadows = await session.capture({ name: 'shadows', query: 'renderer=webgl&shadows=1&units3d=0' })
      const diff = diffImages(base, withShadows)
      assert.ok(diff.changed >= 500, `开阴影只改了 ${diff.changed} 像素，等于没上屏`)
      return `阴影改变 ${diff.changed} 像素`
    },
  },
  {
    name: '倒影开关必须落在画面上',
    async run(session) {
      const base = await session.capture(GL_BASE)
      const withReflection = await session.capture({ name: 'reflect', query: 'renderer=webgl&reflect=1&units3d=0' })
      const diff = diffImages(base, withReflection)
      // 倒影压扁 + 远端渐隐后本来就淡，阈值按"肉眼能看出来"定；几何正确性由单元测试管
      assert.ok(diff.changed >= 150, `开倒影只改了 ${diff.changed} 像素，等于没上屏`)
      return `倒影改变 ${diff.changed} 像素`
    },
  },
  {
    name: '雨夜后处理作用在整幅画面上',
    async run(session) {
      const glWet = await session.capture({
        name: 'wet-gl',
        query: 'renderer=webgl&reflect=1&units3d=0',
        quality: 'wetNight',
      })
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
      const bloom = await session.capture({ name: 'bloom', query: 'renderer=webgl&bloom=1&units3d=0' })
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
      const { box, selected, tickBefore } = await selectAndMove(session)
      const before = await session.snapshot('interaction-before')
      await page.waitForTimeout(5000)
      const after = await session.snapshot('interaction-after')
      const tickAfter = await page.evaluate(() => Number(document.getElementById('hud-tick')?.textContent ?? '0'))
      assert.ok(tickAfter > tickBefore, `tick 没推进（${tickBefore} → ${tickAfter}）：模拟没在跑`)
      const diff = diffImages(before, after)
      assert.ok(diff.changed >= 200, `下了移动指令之后画面只变了 ${diff.changed} 像素：单位没有动`)
      return `选中 ${selected}，tick ${tickBefore} → ${tickAfter}，画面变化 ${diff.changed} 像素`
    },
  },
  {
    name: '3D 单位只替换单位，且与精灵位置重合',
    async run(session) {
      const sprites = await session.capture(GL_BASE)
      const models = await session.capture({ name: 'units3d', query: 'renderer=webgl&units3d=1' })
      const diff = diffImages(sprites, models)
      assert.ok(diff.changed >= 500, `开 3D 单位只改了 ${diff.changed} 像素：3D 层没画出来`)
      // 只换了单位：差异必须集中在单位那一带（高度就是单位自身高度），地块与建筑逐像素不动。
      // 单位在地图上排成一行，横向跨度本来就大（实测 449 像素），所以卡高度更有意义；
      // 再要求差异是"实心"的 —— 整张图被改的话差异会散在整个范围内。
      assert.ok(diff.box.height <= 120, `差异高度 ${diff.box.height} 太大：3D 路径动了单位以外的东西`)
      assert.ok(
        diff.changed <= diff.box.width * diff.box.height * 0.7,
        `差异 ${diff.changed} 像素散在 ${diff.box.width}×${diff.box.height} 范围里：不只是单位被换了`,
      )
      // 换的是"画法"，不是把单位抹掉：差异必须两头都有量 —— 一头是把精灵擦掉（画面变亮成地皮），
      // 一头是把模型画上去（变暗）。模型没出来（单位整辆消失在地皮下面）时只会剩"变亮"那一头。
      assert.ok(
        diff.brighter >= 300 && diff.darker >= 300,
        `差异只有单边（变亮 ${diff.brighter} / 变暗 ${diff.darker}）：有东西被擦掉却没有对应的东西画上去`,
      )
      const ratio = diff.brighter / Math.max(1, diff.darker)
      assert.ok(ratio <= 4 && ratio >= 0.25, `两边差得太多（变亮 ${diff.brighter} / 变暗 ${diff.darker}）`)
      return `差异 ${diff.changed} 像素（变亮 ${diff.brighter} / 变暗 ${diff.darker}），范围 ${diff.box.width}×${diff.box.height}`
    },
  },
  {
    name: '迷雾边界必须是渐隐，不是格子台阶',
    async run(session) {
      const base = await session.capture(GL_BASE)
      // 这条线从黑（未探索）横穿到亮（地形）：实测硬边 26 像素、渐隐 113 像素
      const width = transitionWidth(base, { y: 600, xFrom: 300, xTo: 1000 })
      assert.ok(width >= 40, `暗→亮只用了 ${width} 像素：迷雾边界还是格子台阶（"锯齿"就是这么来的）`)
      return `过渡宽度 ${width} 像素`
    },
  },
  {
    name: '单位移动是连续推进，不是一格一格跳',
    async run(session) {
      const page = session.page
      const { clickedAt, moveTarget } = await selectAndMove(session)
      // 先等它走到位，再命令它沿原路走回来：回程这一路的迷雾在去程已经揭开，
      // 画面里就只剩单位自己在动（走到新格子会揭开外围一圈、还要淡入几百毫秒，
      // 那一段变化摊在视野外沿，会把判据喂满 —— 实测未避开时单次变化上到 5 万像素）。
      await page.waitForFunction(
        () => /路径 0/.test(document.getElementById('hud-selected')?.textContent ?? ''),
        undefined,
        { timeout: 60000 },
      )
      // 沿原路走回来：落点是原来那一格，回程这 840 毫秒里单位仍在落点附近
      await page.mouse.click(clickedAt.x, clickedAt.y, { button: 'right' })
      await page.waitForTimeout(300)
      // 逻辑帧 15 tick/秒（66.7 毫秒），这里每 60 毫秒连拍一张：每两张之间正好一个 tick。
      // 犀牛每 tick 走 15/256 格 ≈ 1.8 像素，所以"每张都跟上"才算连续。
      // 截断成整格时，单位只在跨过格线的那一个 tick 动一次（约 1.1 秒才一次），
      // 840 毫秒的窗口里最多变化 1 次 —— 两边的差距是 10 次以上。
      //
      // 只取单位周围这一块（整帧截图要 650 毫秒，那样连拍就抓不到每个 tick 了）：
      // 窗口贴着移动指令的落点，单位这一段里走的距离不到一格（30 像素），精灵始终在里面
      // （精灵宽约 55 像素、以落点为底边中心）。
      const window = { x: Math.round(moveTarget.x) - 80, y: Math.round(moveTarget.y) - 70, w: 180, h: 130 }
      const frames: PngImage[] = []
      for (let index = 0; index < 14; index++) {
        frames.push(await session.sampleRegion(window))
        await page.waitForTimeout(60)
      }
      let advanced = 0
      let biggest = 0
      let widest = 0
      for (let index = 1; index < frames.length; index++) {
        const diff = diffImagesWithin(frames[index - 1]!, frames[index]!, {
          x: 0,
          y: 0,
          w: frames[index]!.width,
          h: frames[index]!.height,
        })
        if (diff.changed >= 20) advanced++
        biggest = Math.max(biggest, diff.changed)
        widest = Math.max(widest, diff.box.width)
      }
      const tick = await page.evaluate(() => Number(document.getElementById('hud-tick')?.textContent ?? '0'))
      assert.ok(
        advanced >= 8,
        `${frames.length - 1} 次采样里只有 ${advanced} 次画面动过（tick ${tick}）：单位在一格一格跳`,
      )
      assert.ok(
        widest <= 120,
        `有一次变化摊到 ${widest} 像素宽（两格）：这不是"单位挪了一步"，画面里还有别东西在整块变`,
      )
      return `${frames.length - 1} 次采样里 ${advanced} 次有推进，单次最多变化 ${biggest} 像素、最宽 ${widest} 像素`
    },
  },
  {
    name: '「单位画法」开关能在 3D 模型与原版贴图之间切换',
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
      await page.waitForFunction(() => /单位 \d+ 辆/.test(document.getElementById('status')?.textContent ?? ''), undefined, {
        timeout: 300000,
      })
      // 等迷雾揭开的淡入走完：那一段每帧都在变，会把"只换了单位"这条判据喂满
      await page.waitForTimeout(4000)
      const initial = await page.evaluate(() => (document.getElementById('units3d') as HTMLSelectElement).value)
      assert.equal(initial, '3d', `默认应当是 3D 模型档，实际是 ${initial}`)
      const models = await session.snapshot('switch-3d')

      await page.selectOption('#units3d', '2d')
      await page.waitForTimeout(800)
      const sprites = await session.snapshot('switch-2d')

      const diff = diffImages(sprites, models)
      assert.ok(diff.changed >= 500, `切到贴图档只改了 ${diff.changed} 像素：开关没接到画面上`)
      assert.ok(
        diff.box.height <= 140,
        `差异高度 ${diff.box.height} 太大：换画法动了单位以外的东西（单位只占一条带）`,
      )
      return `默认 ${initial}，切换后变化 ${diff.changed} 像素，范围 ${diff.box.width}×${diff.box.height}`
    },
  },
  {
    name: '三个剧场都能画出建筑，且两条绘制路径一致',
    async run(session) {
      const frames: { theater: string; image: PngImage; drawn: number; diff: number }[] = []
      for (const { theater, map, mapIndex } of THEATER_MAPS) {
        const gl = await session.capture({
          name: `theater-${mapIndex}-gl`,
          map,
          mapIndex,
          battle: false,
          query: 'renderer=webgl',
        })
        const canvas = await session.capture({ name: `theater-${mapIndex}-2d`, map, mapIndex, battle: false })
        const status = session.statusText(`theater-${mapIndex}-gl`) ?? ''
        const drawn = /建筑 \d+ 个（画出 (\d+) 个）/.exec(status)
        assert.ok(drawn, `${theater}地图没有报出建筑数，状态行是「${status}」`)
        const drawnCount = Number(drawn[1])
        assert.ok(drawnCount > 0, `${theater}地图一个建筑都没画出来（状态行：${status}）`)
        const diff = diffImages(canvas, gl)
        assert.ok(
          diff.changed <= DIFF_TOLERANCE,
          `${theater}地图两条路径差异 ${diff.changed} 像素（上限 ${DIFF_TOLERANCE}），首个在 ${JSON.stringify(diff.sample)}`,
        )
        frames.push({ theater, image: gl, drawn: drawnCount, diff: diff.changed })
      }
      // 换图必须真的换到画面上：同一张图跑三次会得到 0 差异，那样"支持三个剧场"等于没测。
      // 三张图的剧场美术互不相同，整幅战场都该变（战场面积约 115 万像素，下限取不到一成）。
      for (const frame of frames.slice(1)) {
        const changed = diffImages(frames[0]!.image, frame.image).changed
        assert.ok(
          changed >= 100000,
          `${frames[0]!.theater}与${frame.theater}的帧只差 ${changed} 像素：地图参数没生效，三帧是同一张图`,
        )
      }
      return frames.map((frame) => `${frame.theater} 画出 ${frame.drawn} 个 / 路径差异 ${frame.diff}`).join('，')
    },
  },
]

export { UI_PANELS }

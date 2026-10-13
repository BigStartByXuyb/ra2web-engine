/* 一次性干跑（跑完即删）：战斗联调链路——选中→攻击→炮塔独立转向→对齐→开火→弹体。
 * 用 ?debug=1 的传送钩把敌人摆到近距（官方地图双方出生隔 140 格，走位不现实）。
 * 判据（与战斗线对齐的口径）：turret 相对车体独立转 → turret.current==turret.target（对齐）
 * → cooldown 置位（开火）→ __battleShells>0（弹体存在）→ 末段闪光。
 */
import { openUiSession } from '../tests/ui/harness.js'

const session = await openUiSession({})
const page = session.page
const params = new URLSearchParams({
  mix: '/pack/RA2.MIX',
  map: '/pack/Maps01.mix',
  index: '0',
  battle: '1',
  renderer: 'webgl',
  units3d: '1',
  anim: '0',
  reveal: '1',
  debug: '1',
})
await page.goto(`${session.origin}/game.html?${params.toString()}`, { waitUntil: 'load' })
await page.waitForFunction(() => /单位 \d+ 辆/.test(document.getElementById('status')?.textContent ?? ''), undefined, {
  timeout: 300000,
})
await page.waitForTimeout(2500)

const readUnits = () => page.evaluate(() => (window as unknown as { __battleUnits?: unknown }).__battleUnits)
const readShells = () =>
  page.evaluate(() => ((window as unknown as { __battleShells?: unknown[] }).__battleShells ?? []).length)
const readCam = () =>
  page.evaluate(() => (window as unknown as { __battleCam?: { x: number; y: number; zoom: number } }).__battleCam)

// 敌人（index 3）传到友军（index 0，约 (45,24)）正东 5 格 → 车体朝北、目标在东
const teleport = await page.evaluate(() =>
  (window as unknown as { __debugTeleport?: (i: number, x: number, y: number) => string }).__debugTeleport?.(3, 50, 24),
)
console.log('传送:', teleport)
await page.waitForTimeout(500)
console.log('单位:', JSON.stringify(await readUnits()))

// 选中友军（镜头对准 units[0]，画布中心）
await page.mouse.click(800, 450)
await page.waitForTimeout(400)
const hud = await page.evaluate(() => document.getElementById('hud-selected')?.textContent ?? '')
console.log('选中:', hud.trim())
if (!/HTNK/.test(hud)) throw new Error('没选中友军')

// 滚轮拉近看清炮塔
await page.mouse.move(800, 450)
await page.mouse.wheel(0, -600)
await page.waitForTimeout(500)

// 计算敌人屏幕位置并右键攻击
const cam = await readCam()
if (!cam) throw new Error('没有相机状态')
const cx = 50.5
const cy = 24.5
const screenX = ((cx - cy) * 30 - cam.x) * cam.zoom
const screenY = ((cx + cy) * 15 - cam.y) * cam.zoom
console.log(`敌人屏幕位置 (${screenX.toFixed(0)}, ${screenY.toFixed(0)})，相机`, JSON.stringify(cam))
await page.mouse.click(screenX, screenY, { button: 'right' })

// 采样 6 秒（100ms 粒度——弹体只飞 6 tick≈0.4s，500ms 采样会漏）
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(100)
  const units = (await readUnits()) as Array<{
    hull: number
    turret: number
    target: number
    atk: number | null
    cd: number
  }> | null
  const attacker = units?.[0]
  const shells = await readShells()
  if (i % 5 === 0) {
    console.log(
      `t${i * 0.1}s: atk=${attacker?.atk} turret=${attacker?.turret} target=${attacker?.target} cd=${attacker?.cd} shells=${shells}`,
    )
  }
  if (shells > 0) {
    // 弹体出现：读它的精确位置 → 按屏幕坐标裁切验证渲染（弹只飞 6 tick，采样到就抓）
    const info = await page.evaluate(() => {
      const shells = (window as unknown as { __battleShells?: Array<Record<string, number>> }).__battleShells ?? []
      const tick = (window as unknown as { __battleTick?: number }).__battleTick ?? 0
      const cam = (window as unknown as { __battleCam?: { x: number; y: number; zoom: number } }).__battleCam
      return { shell: shells[0] ?? null, tick, cam }
    })
    if (info.shell && info.cam) {
      const s = info.shell
      const progress = Math.min(1, Math.max(0, (info.tick - s.startTick!) / Math.max(1, s.duration!)))
      const mix = (a: number, b: number): number => a! + (b! - a!) * progress
      const cx = mix(s.x0!, s.x1!) / 256
      const cy = mix(s.y0!, s.y1!) / 256
      const cz = mix(s.z0!, s.z1!)
      const screenX = ((cx - cy) * 30 - info.cam.x) * info.cam.zoom
      const screenY = ((cx + cy) * 15 - info.cam.y) * info.cam.zoom - cz * (10.546875 / 90)
      console.log(
        `  弹体 t${i * 0.1}s progress=${progress.toFixed(2)} 屏幕(${screenX.toFixed(0)},${screenY.toFixed(0)})`,
      )
      const zoomed = await page.evaluate(
        ({ x, y }: { x: number; y: number }) => {
          const size = 140
          const sx = Math.round(x - size / 2)
          const sy = Math.round(y - size / 2)
          const scratch = document.createElement('canvas')
          scratch.width = size * 5
          scratch.height = size * 5
          const context = scratch.getContext('2d')
          if (!context) throw new Error('无 2D 上下文')
          context.imageSmoothingEnabled = false
          for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
            const bounds = canvas.getBoundingClientRect()
            if (bounds.width <= 0 || bounds.height <= 0) continue
            context.drawImage(
              canvas,
              0,
              0,
              canvas.width,
              canvas.height,
              (bounds.left - sx) * 5,
              (bounds.top - sy) * 5,
              bounds.width * 5,
              bounds.height * 5,
            )
          }
          return scratch.toDataURL('image/png')
        },
        { x: screenX, y: screenY },
      )
      const { writeFileSync } = await import('node:fs')
      writeFileSync(
        `tests/ui/out/shell-crop-${i}.png`,
        Buffer.from(zoomed.slice('data:image/png;base64,'.length), 'base64'),
      )
      console.log(`  存图 shell-crop-${i}.png（以弹体屏幕坐标为圆心 ±70px，5×）`)
      break
    }
  }
}
const hud2 = await page.evaluate(() => document.getElementById('hud-selected')?.textContent ?? '')
console.log('结束 HUD:', hud2.trim())
await session.close()

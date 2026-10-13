/* 判决性对照（跑完即删）：单位静止朝北（hull=0 → 帧 6）下
 * 精灵路径（units3d=0，逐像素对齐原版的真值） vs 3D 模型路径同机位同放大对拍。
 * 判读：两条路径的坦克朝向必须一致；不一致 = 3D 朝向映射有残余 bug。
 */
import { openUiSession } from '../tests/ui/harness.js'
import { writeFileSync } from 'node:fs'

const session = await openUiSession({})
const page = session.page

const capture = async (name: string, units3d: string): Promise<void> => {
  const params = new URLSearchParams({
    mix: '/pack/RA2.MIX',
    map: '/pack/Maps01.mix',
    index: '0',
    battle: '1',
    renderer: 'webgl',
    anim: '0',
    units3d,
    reveal: '1',
    debug: '1',
  })
  await page.goto(`${session.origin}/game.html?${params.toString()}`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => /单位 \d+ 辆/.test(document.getElementById('status')?.textContent ?? ''),
    undefined,
    {
      timeout: 300000,
    },
  )
  await page.waitForTimeout(2500)
  const units = await page.evaluate(() => (window as unknown as { __battleUnits?: unknown }).__battleUnits)
  console.log(`${name} 状态:`, JSON.stringify(units))
  await page.mouse.move(800, 450)
  await page.mouse.wheel(0, -900)
  await page.waitForTimeout(600)
  const zoomed = await page.evaluate(() => {
    const sx = 700
    const sy = 370
    const sw = 200
    const sh = 160
    const scratch = document.createElement('canvas')
    scratch.width = sw * 5
    scratch.height = sh * 5
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
  })
  writeFileSync(`tests/ui/out/${name}.png`, Buffer.from(zoomed.slice('data:image/png;base64,'.length), 'base64'))
  console.log(`saved ${name}.png`)
}

await capture('p0-sprite', '0')
await capture('p0-model', '1')
await session.close()

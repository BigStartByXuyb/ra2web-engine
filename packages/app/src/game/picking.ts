import { cellToScreen, type IsoView } from '@ra2web/render'
import { fromFixedExact } from '@ra2web/sim'
import type { Battle } from './battle.js'
import type { UnitArt } from './unit-art.js'

/** 光标下的单位：以精灵贴地线为准取最近的一个，避免相邻单位互相抢。 */
export function pickUnit(
  battle: Battle,
  artByUnit: readonly (UnitArt | undefined)[],
  view: IsoView,
  point: { x: number; y: number },
): number | undefined {
  let best: number | undefined
  let bestDistance = Number.POSITIVE_INFINITY

  battle.world.units.forEach((unit, index) => {
    if (unit.health <= 0) return
    const frame = artByUnit[index]?.frames[0]
    // 与绘制同一判据：按定点坐标的精确值定位，点得中的地方就是看得见的地方
    const ground = cellToScreen(view, { x: fromFixedExact(unit.x), y: fromFixedExact(unit.y) })
    const height = frame ? frame.canvas.height : 20
    const centerY = ground.y - height / 2
    const radius = frame ? Math.max(22, frame.canvas.width / 2) : 20
    const distance = Math.hypot(point.x - ground.x, point.y - centerY)
    if (distance <= radius && distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  })
  return best
}

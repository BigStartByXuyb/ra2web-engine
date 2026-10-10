import { fromFixed, type World } from '@ra2web/sim'

/** 把世界状态画到 canvas。纯读取，不修改模拟状态。 */

const BLOCKED_FILL = '#243040'
const FREE_FILL = '#0d1319'
const GRID_LINE = '#182029'
const TARGET_STROKE = '#94a3b8'
const OWNER_FILL = ['#60a5fa', '#f87171', '#fbbf24', '#34d399']

export function drawWorld(canvas: HTMLCanvasElement, world: World): void {
  const context = canvas.getContext('2d')
  if (!context) return
  const cellSize = Math.floor(Math.min(canvas.width / world.grid.width, canvas.height / world.grid.height))
  context.clearRect(0, 0, canvas.width, canvas.height)

  for (let y = 0; y < world.grid.height; y++) {
    for (let x = 0; x < world.grid.width; x++) {
      context.fillStyle = world.grid.blocked.has(y * world.grid.width + x) ? BLOCKED_FILL : FREE_FILL
      context.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)
    }
  }

  context.strokeStyle = GRID_LINE
  context.lineWidth = 1
  for (let i = 0; i <= world.grid.width; i++) {
    context.beginPath()
    context.moveTo(i * cellSize + 0.5, 0)
    context.lineTo(i * cellSize + 0.5, world.grid.height * cellSize)
    context.moveTo(0, i * cellSize + 0.5)
    context.lineTo(world.grid.width * cellSize, i * cellSize + 0.5)
    context.stroke()
  }

  for (const unit of world.units) {
    const remaining = unit.path.slice(unit.pathIndex)
    if (remaining.length > 1) {
      context.strokeStyle = TARGET_STROKE
      context.beginPath()
      remaining.forEach((cell, index) => {
        const cx = cell.x * cellSize + cellSize / 2
        const cy = cell.y * cellSize + cellSize / 2
        if (index === 0) context.moveTo(cx, cy)
        else context.lineTo(cx, cy)
      })
      context.stroke()
    }

    context.fillStyle = OWNER_FILL[unit.owner % OWNER_FILL.length]!
    const size = Math.max(4, Math.floor(cellSize * 0.62))
    context.fillRect(
      (fromFixed(unit.x) + 0.5) * cellSize - size / 2,
      (fromFixed(unit.y) + 0.5) * cellSize - size / 2,
      size,
      size,
    )
  }
}

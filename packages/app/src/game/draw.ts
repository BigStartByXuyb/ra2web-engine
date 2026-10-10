import { RA2_ISO_VIEW, cellToScreen } from '@ra2web/render'
import { fromFixed } from '@ra2web/sim'
import type { Battle } from './battle.js'
import { viewScale, visibleCellRange, type Camera } from './camera.js'
import { drawMapPreview, type MapPreview } from './map-preview.js'
import { HOVER_COLOR, SELECTED_COLOR, drawTerrain, strokeCell } from './terrain.js'
import type { UnitArt } from './unit-art.js'

/** 画面：每帧只读一次状态，不写任何模拟数据。 */

export interface Scene {
  readonly canvas: HTMLCanvasElement
  readonly camera: Camera
  readonly battle: Battle | undefined
  readonly mapPreview: MapPreview | undefined
  readonly artByUnit: readonly (UnitArt | undefined)[]
  readonly hoverCell: { x: number; y: number } | undefined
}

const VIEW = RA2_ISO_VIEW

export function drawScene(scene: Scene): void {
  const context = scene.canvas.getContext('2d')
  if (!context) return

  const scale = viewScale(scene.camera)
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, scene.canvas.width, scene.canvas.height)
  context.setTransform(scale, 0, 0, scale, -scene.camera.x * scale, -scene.camera.y * scale)
  context.imageSmoothingEnabled = false

  const battle = scene.battle
  const range = visibleCellRange(scene.camera, VIEW, scene.canvas.width, scene.canvas.height)
  if (!battle && scene.mapPreview) {
    drawMapPreview(context, scene.mapPreview, VIEW, range)
    if (scene.hoverCell) strokeCell(context, VIEW, scene.hoverCell, HOVER_COLOR)
  }
  if (battle) {
    // 有官方地图时就画真实地块，否则退回占位网格
    if (scene.mapPreview) drawMapPreview(context, scene.mapPreview, VIEW, range)
    else drawTerrain(context, battle.world.grid, VIEW, range)
    if (scene.hoverCell) strokeCell(context, VIEW, scene.hoverCell, HOVER_COLOR)
    const selected = battle.selectedIndex === undefined ? undefined : battle.world.units[battle.selectedIndex]
    if (selected) {
      strokeCell(context, VIEW, { x: fromFixed(selected.x), y: fromFixed(selected.y) }, SELECTED_COLOR)
      drawPath(context, selected.path.slice(selected.pathIndex))
    }
    drawUnits(context, battle, scene.artByUnit)
  }
  context.setTransform(1, 0, 0, 1, 0, 0)
}

/** 选中单位的剩余路径：原版也用它表示"已接受这条移动指令"。 */
function drawPath(context: CanvasRenderingContext2D, path: readonly { x: number; y: number }[]): void {
  if (path.length === 0) return
  context.save()
  context.strokeStyle = SELECTED_COLOR
  context.lineWidth = 3
  context.beginPath()
  path.forEach((cell, index) => {
    const center = cellToScreen(VIEW, cell)
    if (index === 0) context.moveTo(center.x, center.y)
    else context.lineTo(center.x, center.y)
  })
  context.stroke()
  context.restore()
}

/** 按 (x+y) 升序画，保证近处单位盖住远处的。 */
function drawUnits(
  context: CanvasRenderingContext2D,
  battle: Battle,
  artByUnit: readonly (UnitArt | undefined)[],
): void {
  const order = battle.world.units
    .map((unit, index) => ({ unit, index }))
    .sort((left, right) => left.unit.x + left.unit.y - (right.unit.x + right.unit.y))

  for (const { unit, index } of order) {
    if (unit.health <= 0) continue
    const ground = cellToScreen(VIEW, { x: fromFixed(unit.x), y: fromFixed(unit.y) })
    const art = artByUnit[index]
    if (!art) {
      context.fillStyle = unit.owner === 0 ? '#60a5fa' : '#f87171'
      context.fillRect(ground.x - 4, ground.y - 12, 8, 8)
      continue
    }
    const frame = art.frames[battle.facingByUnit[index] ?? 0]!
    context.drawImage(frame.canvas, ground.x - frame.anchorX, ground.y - frame.anchorY)
  }
}

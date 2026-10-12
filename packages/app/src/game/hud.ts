import { unitCell } from '@ra2web/sim'
import type { Battle } from './battle.js'
import type { Camera } from './camera.js'
import type { MapPreview } from './map-preview.js'

/** 左上角状态面板：只显示只读信息，不参与模拟。 */

export interface HudElements {
  readonly tick: HTMLElement
  readonly fps: HTMLElement
  readonly zoom: HTMLElement
  readonly cell: HTMLElement
  readonly selected: HTMLElement
  readonly units: HTMLElement
}

export interface HudState {
  readonly battle: Battle | undefined
  readonly mapPreview: MapPreview | undefined
  readonly camera: Camera
  readonly hoverCell: { x: number; y: number } | undefined
}

export interface Hud {
  update(now: number, state: HudState): void
}

export function createHud(elements: HudElements): Hud {
  let frames = 0
  let windowStartedAt = 0

  return {
    update(now, state) {
      frames += 1
      if (windowStartedAt === 0) windowStartedAt = now
      if (now - windowStartedAt >= 500) {
        elements.fps.textContent = `${Math.round((frames * 1000) / (now - windowStartedAt))} fps`
        frames = 0
        windowStartedAt = now
      }

      elements.zoom.textContent = `${state.camera.zoom.toFixed(2)}x`
      elements.tick.textContent = String(state.battle?.world.tick ?? 0)
      elements.units.textContent = String(state.battle?.world.units.length ?? 0)
      elements.cell.textContent = state.hoverCell ? `${state.hoverCell.x}, ${state.hoverCell.y}` : '-'

      const index = state.battle?.selectedIndex
      const summary = state.battle && index !== undefined ? state.battle.summaryByUnit[index] : undefined
      if (!summary) {
        elements.selected.textContent = state.mapPreview
          ? `地图 ${state.mapPreview.declaredWidth}×${state.mapPreview.declaredHeight} ${state.mapPreview.theater ?? '-'} z ${state.mapPreview.zMin}–${state.mapPreview.zMax}`
          : '无'
        return
      }
      const unit = index === undefined ? undefined : state.battle?.world.units[index]
      const cell = unit ? unitCell(unit) : undefined
      const remaining = unit ? unit.path.length - unit.pathIndex : 0
      elements.selected.textContent = `${summary.id}（${summary.name}）HP ${summary.strength ?? '-'} 速度 ${
        summary.speed ?? '-'
      } 位置 ${cell ? `${cell.x}, ${cell.y}` : '-'} 路径 ${remaining}`
    },
  }
}

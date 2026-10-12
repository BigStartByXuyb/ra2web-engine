import type { TheaterIni } from '@ra2web/formats'

/**
 * 水面动画：原版的水面是**同一集里的多块地块轮播**。
 *
 * 口径来自剧场控制文件（实机数据）：`snow.ini` / `temperat.ini` 的 `[General]` 都写
 * `WaterSet=21`，第 21 集是 `Water(<Water>,14)` —— 14 块。所以"水面动画"就是让水格的
 * 地块号在集内循环 0..13。
 *
 * 未核对：原版推进一帧用多少逻辑帧。这里按毫秒走固定帧长（默认 200 毫秒一帧 ≈ 5 帧/秒），
 * 与 `zStep` 一样属于待核项；口径只有这一处，改也只改这里。
 */
export const WATER_FRAME_MS = 200

export interface WaterTileRange {
  /** 集内第一块的**全局地块号** */
  readonly start: number
  /** 集里有多少块 */
  readonly count: number
}

/**
 * 从剧场 ini 取水面地块集的范围；没有 `WaterSet` 或该集为空时返回 undefined（不播动画）。
 */
export function waterTileRange(ini: TheaterIni): WaterTileRange | undefined {
  const setIndex = Number(ini.general.get('waterset'))
  if (!Number.isInteger(setIndex)) return undefined
  const set = ini.sets.find((item) => item.index === setIndex)
  if (!set || set.tilesInSet <= 1) return undefined
  const start = ini.tiles.findIndex((tile) => tile.setIndex === set.index)
  if (start < 0) return undefined
  return { start, count: set.tilesInSet }
}

/** 到第几帧（按毫秒时钟）：开了动画才算，关掉时恒为 0。 */
export function waterFrameAt(elapsedMs: number, range: WaterTileRange | undefined, enabled: boolean): number {
  if (!enabled || !range) return 0
  return Math.floor(elapsedMs / WATER_FRAME_MS) % range.count
}

/**
 * 这一格这一帧该画哪一块：只有落在水面集里的地块才轮播，其余原样返回。
 */
export function animatedTileIndex(tileIndex: number, range: WaterTileRange | undefined, frame: number): number {
  if (!range || frame === 0) return tileIndex
  const offset = tileIndex - range.start
  if (offset < 0 || offset >= range.count) return tileIndex
  return range.start + ((offset + frame) % range.count)
}

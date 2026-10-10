/** 指令：进入队列时记录 tick，轮到该 tick 时按入队顺序应用（锁步语义）。 */

/**
 * 已入队指令。`sequence` 是入队序号，用于同一 tick 内多条指令的稳定排序 ——
 * 没有它，"同一批指令不同入队顺序"会得到不同结果。
 */
export type Command =
  | {
      readonly sequence: number
      readonly tick: number
      readonly kind: 'move'
      readonly unitId: number
      readonly target: { readonly x: number; readonly y: number }
    }
  | { readonly sequence: number; readonly tick: number; readonly kind: 'stop'; readonly unitId: number }

export type CommandInput =
  | { readonly kind: 'move'; readonly unitId: number; readonly target: { readonly x: number; readonly y: number } }
  | { readonly kind: 'stop'; readonly unitId: number }

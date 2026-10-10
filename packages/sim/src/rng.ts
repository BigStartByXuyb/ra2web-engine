/**
 * 种子随机（xorshift128）。模拟里所有随机都必须来自这里，禁止 `Math.random()`。
 * 状态是四个 uint32，可整体纳入状态哈希。
 */

export interface RngState {
  s0: number
  s1: number
  s2: number
  s3: number
}

export function createRng(seed: number): RngState {
  // splitmix32 展开种子，避免全零状态
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x9e3779b9) >>> 0
    let z = state
    z = (Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0) >>> 0
    z = (Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0) >>> 0
    return (z ^ (z >>> 15)) >>> 0
  }
  const s0 = next()
  const s1 = next()
  const s2 = next()
  const s3 = next()
  return { s0: s0 === 0 && s1 === 0 && s2 === 0 && s3 === 0 ? 1 : s0, s1, s2, s3 }
}

/** 推进 RNG 并返回下一个 uint32（就地修改，模拟内唯一允许的可变随机源）。 */
export function nextUint32(rng: RngState): number {
  let t = rng.s3
  const s = rng.s0
  rng.s3 = rng.s2
  rng.s2 = rng.s1
  rng.s1 = s
  t ^= t << 11
  t = (t ^ (t >>> 8)) >>> 0
  rng.s0 = (t ^ s ^ (s >>> 19)) >>> 0
  return rng.s0
}

/** [0, bound) 上的均匀整数；用拒绝采样避免取模偏差。 */
export function nextBelow(rng: RngState, bound: number): number {
  if (bound <= 0) throw new Error('bound must be positive')
  const limit = 0x100000000 - (0x100000000 % bound)
  let value = nextUint32(rng)
  while (value >= limit) value = nextUint32(rng)
  return value % bound
}

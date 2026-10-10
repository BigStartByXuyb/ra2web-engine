import type { World } from './world.js'

/**
 * 状态哈希：把世界状态按**固定字段顺序**写成字节流后做 FNV-1a。
 * 任何影响模拟结果的字段都必须进哈希；渲染/调试字段不进。
 */

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

class ByteStream {
  private hash = FNV_OFFSET >>> 0

  pushUint32(value: number): void {
    let v = value >>> 0
    for (let i = 0; i < 4; i++) {
      this.hash = (Math.imul(this.hash ^ (v & 0xff), FNV_PRIME) >>> 0) >>> 0
      v >>>= 8
    }
  }

  pushInt32(value: number): void {
    this.pushUint32(value | 0)
  }

  get value(): number {
    return this.hash >>> 0
  }
}

export function hashWorld(world: World): string {
  const stream = new ByteStream()
  stream.pushInt32(world.tick)
  stream.pushInt32(world.rng.s0)
  stream.pushInt32(world.rng.s1)
  stream.pushInt32(world.rng.s2)
  stream.pushInt32(world.rng.s3)
  stream.pushInt32(world.units.length)
  for (const unit of world.units) {
    stream.pushInt32(unit.id)
    stream.pushInt32(unit.owner)
    stream.pushInt32(unit.x)
    stream.pushInt32(unit.y)
    stream.pushInt32(unit.health)
    stream.pushInt32(unit.pathIndex)
    stream.pushInt32(unit.path.length)
    for (const cell of unit.path) {
      stream.pushInt32(cell.x)
      stream.pushInt32(cell.y)
    }
  }
  stream.pushInt32(world.pending.length)
  for (const command of world.pending) {
    stream.pushInt32(command.tick)
    stream.pushInt32(command.kind === 'move' ? 1 : 2)
    stream.pushInt32(command.unitId)
    if (command.kind === 'move') {
      stream.pushInt32(command.target.x)
      stream.pushInt32(command.target.y)
    }
  }
  return stream.value.toString(16).padStart(8, '0')
}

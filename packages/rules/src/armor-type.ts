/**
 * 护甲类型枚举（Verses 下标语义）。
 *
 * 证据：GAME.EXE `.data` 指针表 0x79ddf8 起 11 项（WarheadTypeClass::Read_INI 的 Verses
 * 按"逗号切分、循环 11 次"写入 +0xa0..+0xf8，见 work/decompiled/ra2-engine/fn-7204e0.md），
 * 每个指针指向的字符串逐一读核：
 * none(0x7ce0ec) flak(0x7d39c8) plate(0x7d39c0) light(0x7d39b8) medium(0x7d39b0)
 * heavy(0x7d39a8) wood(0x7d39a0) steel(0x7d3998) concrete(0x7d398c) special_1(0x7d3980)
 * special_2(0x7d3974)
 */

export const ARMOR_TYPE_NAMES = [
  'none',
  'flak',
  'plate',
  'light',
  'medium',
  'heavy',
  'wood',
  'steel',
  'concrete',
  'special_1',
  'special_2',
] as const

export type ArmorTypeName = (typeof ARMOR_TYPE_NAMES)[number]

const INDEX_BY_NAME = new Map<string, number>(ARMOR_TYPE_NAMES.map((name, index) => [name, index]))

/** 护甲名 → 下标；大小写不敏感，未知返回 undefined。 */
export function armorIndex(name: string): number | undefined {
  return INDEX_BY_NAME.get(name.trim().toLowerCase())
}

/** 下标 → 护甲名；越界返回 undefined。 */
export function armorName(index: number): string | undefined {
  return ARMOR_TYPE_NAMES[index]
}

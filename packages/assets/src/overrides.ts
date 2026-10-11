import { crc32, findMixEntry, readMixEntry, readMixIndex, readMixFile, type MixIndex } from '@ra2web/formats'

/**
 * 覆盖素材包：一个「按名字优先命中」的档案列表，排在原版档案前面。
 *
 * 用法与原版 MOD 一致 —— 把要替换的文件放进自己的 MIX 里，不做合并、不改原版档案：
 * 找 `tesla.shp` 时先看覆盖包，命中就用包里的，没命中再回落到 `RA2.MIX`。
 * 这样高清/写实素材包只要按原版文件名与目录结构打包即可被引擎直接吃下，
 * 换材质不需要改引擎代码。
 *
 * 包内布局两种都支持：文件直接放在包根（RA2 MOD 的常见做法），
 * 或者放在与原版同名的内嵌包目录里（与 `local.mix` 结构一致的包）。
 */

export interface AssetOverride {
  readonly name: string
  readonly bytes: Uint8Array
}

/** 档案索引只解析一次：解析要跑一遍 Blowfish/CRC 表，重复做代价太大。 */
const indexCache = new WeakMap<Uint8Array, MixIndex>()

function indexOf(bytes: Uint8Array): MixIndex {
  let index = indexCache.get(bytes)
  if (!index) {
    index = readMixIndex(bytes)
    indexCache.set(bytes, index)
  }
  return index
}

/**
 * 在覆盖包里找文件；包顺序就是优先级（先给的先命中）。
 * `containerFileName` 是原版档案里的内嵌包名（例如 `local.mix`）；覆盖包里同名目录也会被找。
 */
export function findOverride(
  overrides: readonly AssetOverride[] | undefined,
  fileName: string,
  containerFileName?: string,
): Uint8Array | undefined {
  if (!overrides || overrides.length === 0) return undefined
  for (const override of overrides) {
    const root = indexOf(override.bytes)
    const direct = findMixEntry(root, fileName, crc32)
    if (direct) return readMixEntry(override.bytes, root, direct)
    if (!containerFileName) continue
    const container = findMixEntry(root, containerFileName, crc32)
    if (!container) continue
    const nested = readMixIndex(readMixEntry(override.bytes, root, container))
    const entry = findMixEntry(nested, fileName, crc32)
    if (entry) return readMixEntry(readMixEntry(override.bytes, root, container), nested, entry)
  }
  return undefined
}

/**
 * 先看覆盖包、再回落到原版档案的通用读取。
 * 原版那一步就是 `readMixFile` 原本的行为（根 → 内嵌包）。
 */
export function readAsset(
  archiveBytes: Uint8Array,
  overrides: readonly AssetOverride[] | undefined,
  fileName: string,
  containerFileName?: string,
): Uint8Array | undefined {
  const overridden = findOverride(overrides, fileName, containerFileName)
  if (overridden) return overridden
  return containerFileName
    ? readMixFile({ bytes: archiveBytes, fileName, containerFileName })
    : readMixFile({ bytes: archiveBytes, fileName })
}

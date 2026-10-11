import { readVxl, type VxlModel } from '@ra2web/formats'
import { readAsset, type AssetOverride } from './overrides.js'

/**
 * 取一个单位的体素美术：`<单位>.vxl` 是机体，`<单位>tur.vxl` 是炮塔（可选）。
 *
 * `tur` 后缀与原版档案布局都是**素材约定**而不是格式规则：格式层只知道字节，
 * 由本层把它们对应到"一个单位的美术"。
 */

export interface VoxelUnit {
  readonly body: VxlModel
  readonly turret: VxlModel | undefined
}

export interface VoxelUnitLookup {
  readonly bytes: Uint8Array
  /** 顶层找不到时再进这个内嵌档案找一层；原版安装传 `local.mix` */
  readonly containerFileName?: string
  /** 覆盖素材包：命中就用包里的 `<单位>.vxl`（写实包可以换成更细的体素模型） */
  readonly overrides?: readonly AssetOverride[]
}

export function loadVoxelUnit(lookup: VoxelUnitLookup, unitId: string): VoxelUnit | undefined {
  const bodyBytes = readAsset(lookup.bytes, lookup.overrides, `${unitId}.vxl`, lookup.containerFileName)
  if (!bodyBytes) return undefined
  const turretBytes = readAsset(lookup.bytes, lookup.overrides, `${unitId}tur.vxl`, lookup.containerFileName)
  return { body: readVxl(bodyBytes), turret: turretBytes ? readVxl(turretBytes) : undefined }
}

/** 展平成渲染器要的模型列表：机体在前，炮塔在后。 */
export function voxelUnitModels(unit: VoxelUnit): readonly VxlModel[] {
  return unit.turret ? [unit.body, unit.turret] : [unit.body]
}

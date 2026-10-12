import type { Palette } from '@ra2web/formats'
import { readMixFile, readVxl } from '@ra2web/formats'
import { loadTheaterPalette } from '@ra2web/assets'
import { positionVoxelModel, type PositionedModel } from '@ra2web/render'

/**
 * 从原版档案里取单位/建筑图形：容器查找顺序与"机体 + 炮塔 + 色板"的拼法只有这一处，
 * 素材包生成（`build-png-pack`）与 3D 导出（`vxl-to-obj`）都走这里。
 */
const CONTAINERS = [
  'local.mix',
  'conquer.mix',
  'generic.mix',
  'isogen.mix',
  'isotemp.mix',
  'isosnow.mix',
  'isourb.mix',
  'temperat.mix',
  'snow.mix',
  'urban.mix',
  'tem.mix',
  'sno.mix',
  'urb.mix',
] as const

/** 先按 RA2 的容器次序找，再退回档案根。 */
export function findGameFile(archive: Uint8Array, fileName: string): Uint8Array | undefined {
  for (const container of CONTAINERS) {
    const bytes = readMixFile({ bytes: archive, fileName, containerFileName: container })
    if (bytes) return bytes
  }
  return readMixFile({ bytes: archive, fileName })
}

/**
 * 单位模型：机体（`<id>.vxl`）+ 炮塔（`<id>tur.vxl`）拼成整机，色板优先用模型内嵌的那份，
 * 内嵌缺失时才回退到剧场单位色板。
 */
export function loadUnitModel(
  archive: Uint8Array,
  unitId: string,
  theaterName: string,
): { model: PositionedModel; palette: Palette | undefined } {
  const id = unitId.toLowerCase()
  const models = []
  const body = findGameFile(archive, `${id}.vxl`)
  if (body) models.push(readVxl(body))
  const turret = findGameFile(archive, `${id}tur.vxl`)
  if (turret) models.push(readVxl(turret))
  const model = positionVoxelModel(models)
  const palette = model.palette ?? loadTheaterPalette(archive, theaterName, 'unit')
  return { model, palette }
}

import { readMixFile } from '@ra2web/formats'

/**
 * 原版的规则与美术配置都放在 `RA2.MIX` 内嵌的 `local.mix` 里（`rules.ini`、`art.ini`…），
 * 文本是 windows-1252 而不是 UTF-8。全仓只有这一处按这个约定读它们。
 */
export function readLocalText(archiveBytes: Uint8Array, fileName: string): string | undefined {
  const bytes = readMixFile({ bytes: archiveBytes, fileName, containerFileName: 'local.mix' })
  return bytes ? new TextDecoder('windows-1252').decode(bytes) : undefined
}

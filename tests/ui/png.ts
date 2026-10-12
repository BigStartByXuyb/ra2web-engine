import fs from 'node:fs'
import { decodePngBytes, type PngImage } from '../../tools/png-read.js'

export type { PngImage }

/** 读一张 8bit RGB/RGBA、非隔行 PNG（浏览器截图的格式）。解码实现在 `tools/png-read.ts`。 */
export function decodePng(filePath: string): PngImage {
  return decodePngBytes(new Uint8Array(fs.readFileSync(filePath)))
}

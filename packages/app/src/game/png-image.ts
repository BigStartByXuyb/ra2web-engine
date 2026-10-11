/**
 * 素材包里的真彩贴图解码：交给浏览器的 PNG 解码器（`createImageBitmap`）。
 *
 * 格式层不碰 PNG —— 它只负责在覆盖包里按名字取字节，解码与上屏都在这里。
 * 这样写实/超清素材可以用任意真彩色，不受 256 色索引色板限制。
 */

export async function decodePng(bytes: Uint8Array): Promise<HTMLCanvasElement> {
  const blob = new Blob([bytes as BlobPart], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (context) {
    context.drawImage(bitmap, 0, 0)
  }
  bitmap.close()
  return canvas
}

/**
 * 单位贴图约定：`<单位>.png` 是**横向 8 帧**的贴条，每帧是正方形（高 × 高），
 * 帧的贴地锚点取"底边中点"。这样一张图就能表达 8 个朝向，不需要额外的清单文件。
 */
export function sliceUnitSheet(
  sheet: HTMLCanvasElement,
): readonly { canvas: HTMLCanvasElement; anchorX: number; anchorY: number }[] {
  const frameSize = sheet.height
  const count = frameSize > 0 ? Math.max(1, Math.round(sheet.width / frameSize)) : 0
  const frames: { canvas: HTMLCanvasElement; anchorX: number; anchorY: number }[] = []
  for (let index = 0; index < count; index++) {
    const canvas = document.createElement('canvas')
    canvas.width = frameSize
    canvas.height = frameSize
    const context = canvas.getContext('2d')
    if (context) context.drawImage(sheet, index * frameSize, 0, frameSize, frameSize, 0, 0, frameSize, frameSize)
    frames.push({ canvas, anchorX: frameSize / 2, anchorY: frameSize })
  }
  return frames
}

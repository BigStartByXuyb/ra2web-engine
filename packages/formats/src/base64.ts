import { ParseError } from './errors.js'

/**
 * base64 解码（标准字母表，允许 `=` 补位与换行空白）。
 *
 * 自己实现是为了不依赖运行环境：浏览器有 `atob`、Node 有 `Buffer`，而格式层要两边通用。
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const REVERSE = new Int16Array(128).fill(-1)
for (let index = 0; index < ALPHABET.length; index++) REVERSE[ALPHABET.charCodeAt(index)] = index

export function decodeBase64(text: string): Uint8Array {
  const compact = text.replace(/\s+/g, '')
  const padded = compact.endsWith('==') ? compact.slice(0, -2) : compact.endsWith('=') ? compact.slice(0, -1) : compact
  const bytes = new Uint8Array(Math.floor((padded.length * 3) / 4))
  let written = 0
  let accumulator = 0
  let bits = 0

  for (let at = 0; at < padded.length; at++) {
    const value = REVERSE[padded.charCodeAt(at)] ?? -1
    if (value < 0) throw new ParseError(`base64 里出现非法字符：${padded[at]}`, at)
    accumulator = (accumulator << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[written++] = (accumulator >> bits) & 0xff
    }
  }
  return bytes.subarray(0, written)
}

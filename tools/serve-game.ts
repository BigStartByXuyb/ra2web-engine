import fs from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'

/**
 * 本地跑战场页：把构建产物与原版档案一起挂出去，浏览器里一条链接直接进战场。
 *
 * 用法：tsx tools/serve-game.ts [原版档案目录] [端口=3120]
 *   - `/`        → `packages/app/dist`（战斗页 game.html）
 *   - `/pack/`   → 原版档案目录（RA2.MIX、Maps01.mix…），只读
 *
 * 打开： http://127.0.0.1:3120/game.html?mix=/pack/RA2.MIX&map=/pack/Maps01.mix&battle=1
 */
const packDir = resolve(process.argv[2] ?? 'D:\\AI_GAME\\work\\assets\\pack')
/** 默认 3120：3100 留给 `npm run app:dev`（vite 开发服务器） */
const port = Number(process.argv[3] ?? 3120)
const appDir = resolve('packages/app/dist')

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mix': 'application/octet-stream',
  '.MIX': 'application/octet-stream',
}

function sendFile(path: string, response: import('node:http').ServerResponse): void {
  let stats
  try {
    stats = fs.statSync(path)
  } catch {
    response.writeHead(404).end('not found')
    return
  }
  if (!stats.isFile()) {
    response.writeHead(404).end('not found')
    return
  }
  response.writeHead(200, {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    'content-length': stats.size,
  })
  if (response.req?.method === 'HEAD') {
    response.end()
    return
  }
  fs.createReadStream(path).pipe(response)
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
  // 不用 node:path 的 normalize：Windows 上它会把 URL 里的 "/" 换成 "\"，前缀判断会失效。
  // 逐段拆开、丢掉空段与 ".."，顺带挡掉目录穿越。
  const segments = decodeURIComponent(url.pathname)
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
  if (segments[0] === 'pack') {
    sendFile(join(packDir, ...segments.slice(1)), response)
    return
  }
  sendFile(join(appDir, ...(segments.length > 0 ? segments : ['game.html'])), response)
})

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用：换一个端口，例如 tsx tools/serve-game.ts "${packDir}" ${port + 1}`)
  } else {
    console.error(error)
  }
  process.exit(1)
})

server.listen(port, '127.0.0.1', () => {
  const query = '?mix=/pack/RA2.MIX&map=/pack/Maps01.mix&battle=1'
  console.log(`战场页：http://127.0.0.1:${port}/game.html`)
  console.log(`自动开战：http://127.0.0.1:${port}/game.html${query}`)
  console.log(`原版档案：${packDir} → /pack/`)
})

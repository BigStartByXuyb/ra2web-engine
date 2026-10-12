import fs from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'

/**
 * 本地跑战场页：把构建产物与原版档案一起挂出去，浏览器里一条链接直接进战场。
 *
 * 用法：tsx tools/serve-game.ts [原版档案目录] [端口=3120]
 *   - `/`         → `packages/app/dist`（战斗页 game.html）
 *   - `/pack/`    → 原版档案目录（RA2.MIX、Maps01.mix…），只读
 *   - `/packs/`   → 覆盖素材包目录（写实/超清包），只读
 *
 * 打开： http://127.0.0.1:3120/game.html?mix=/pack/RA2.MIX&map=/pack/Maps01.mix&battle=1
 * 带素材包： …&pack=/packs/hd-sample.mix
 */
export const DEFAULT_PACK_DIR = 'D:\\AI_GAME\\work\\assets\\pack'
export const DEFAULT_OVERRIDES_DIR = 'D:\\AI_GAME\\work\\hd-packs'
/** 默认 3120：3100 留给 `npm run app:dev`（vite 开发服务器） */
export const DEFAULT_PORT = 3120

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mix': 'application/octet-stream',
  '.MIX': 'application/octet-stream',
}

export interface GameServerOptions {
  readonly packDir?: string | undefined
  readonly overridesDir?: string | undefined
  /** 端口，给 0 就让系统挑一个空闲端口 */
  readonly port?: number | undefined
  readonly appDir?: string | undefined
}

/** 战场页要挂的三份目录与访问入口；UI 测试也用这个起服务。 */
export interface GameServer {
  readonly origin: string
  readonly packDir: string
  readonly overridesDir: string
  close(): Promise<void>
}

export async function startGameServer(options: GameServerOptions = {}): Promise<GameServer> {
  const packDir = resolve(options.packDir ?? DEFAULT_PACK_DIR)
  const overridesDir = resolve(options.overridesDir ?? DEFAULT_OVERRIDES_DIR)
  const appDir = resolve(options.appDir ?? 'packages/app/dist')

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
      // 素材（`/pack/`、`/packs/`）与页面都在本地被反复替换：一律不缓存，
      // 否则改完模型/地块后浏览器还在用旧那份 —— 实测"炮管又没了"就是缓存了旧 GLB。
      'cache-control': 'no-store',
    })
    if (response.req?.method === 'HEAD') {
      response.end()
      return
    }
    fs.createReadStream(path).pipe(response)
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    // 不用 node:path 的 normalize：Windows 上它会把 URL 里的 "/" 换成 "\"，前缀判断会失效。
    // 逐段拆开、丢掉空段与 ".."，顺带挡掉目录穿越。
    const segments = decodeURIComponent(url.pathname)
      .split('/')
      .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    if (segments[0] === 'pack') {
      sendFile(join(packDir, ...segments.slice(1)), response)
      return
    }
    if (segments[0] === 'packs') {
      sendFile(join(overridesDir, ...segments.slice(1)), response)
      return
    }
    sendFile(join(appDir, ...(segments.length > 0 ? segments : ['game.html'])), response)
  })

  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(options.port ?? DEFAULT_PORT, '127.0.0.1', () => {
      server.off('error', fail)
      done()
    })
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : (options.port ?? DEFAULT_PORT)
  return {
    origin: `http://127.0.0.1:${port}`,
    packDir,
    overridesDir,
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}

/** 直接跑本文件时起服务并打印入口链接。 */
if (process.argv[1] !== undefined && /serve-game\.[tj]s$/.test(process.argv[1])) {
  const port = Number(process.argv[3] ?? DEFAULT_PORT)
  try {
    const server = await startGameServer({ packDir: process.argv[2], overridesDir: process.argv[4], port })
    const query = '?mix=/pack/RA2.MIX&map=/pack/Maps01.mix&battle=1'
    console.log(`战场页：${server.origin}/game.html`)
    console.log(`自动开战：${server.origin}/game.html${query}`)
    console.log(`原版档案：${server.packDir} → /pack/`)
    console.log(`素材包：${server.overridesDir} → /packs/`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `端口 ${port} 已被占用：换一个端口，例如 tsx tools/serve-game.ts "${process.argv[2] ?? ''}" ${port + 1}`,
      )
    } else {
      console.error(error)
    }
    process.exit(1)
  }
}

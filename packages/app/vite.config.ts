import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/** 工程根：显式指定，避免从仓库根调用 vite 时找不到 index.html。 */
const appRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: appRoot,
  // 相对路径：部署到 GitHub Pages 的子路径下也能正常工作
  base: './',
  server: {
    // 绑定 IPv4：内嵌浏览器访问 127.0.0.1 时不会走 IPv6 的 localhost
    host: '127.0.0.1',
    port: 3100,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})

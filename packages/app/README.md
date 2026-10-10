# @ra2web/app

浏览器端外壳：加载 `@ra2web/sim` 与 `@ra2web/scenarios`，把模拟跑起来并画出来。

## 职责边界

- 唯一允许接触 DOM / Canvas / 浏览器 API 的地方。
- **不允许**在这里写游戏规则：规则属于 `sim`。

## 运行

```bash
npm run build     # 先构建依赖包的 dist
npm run app:dev   # 启动 Vite 开发服务器
```

页面跑完整确定性场景，并把浏览器算出的末态哈希与 Node 端快照对比。

## 部署到 GitHub Pages

内嵌浏览器会拦截 `localhost` / `127.0.0.1`，要给别人看就走公开链接：

```bash
npm run build
npm run app:build                                  # 产出 packages/app/dist
# 把 dist 内容推到 gh-pages 分支（该分支只放构建产物）
# 仓库 Pages 设置：source = gh-pages 分支，根路径
```

线上地址：<https://bigstartbyxuyb.github.io/ra2web-engine/>

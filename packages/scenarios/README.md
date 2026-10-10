# @ra2web/scenarios

可复现的模拟脚本集合。**同一份脚本同时供 Node 端（`tools/sim-scenario.ts`）与浏览器端
（`packages/app`）使用** —— 确定性验证的前提是两边跑同一段代码，而不是"看起来一样"的两段。

## 用途

- 确定性回归：逐 tick 哈希比对
- 回归快照：末态哈希作为金标准

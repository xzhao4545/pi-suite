# Jobs Dock 计时

## 目标

- Dock 的 Jobs 行与 Agents 行一样，在活动期间按秒刷新运行时间。

同一规划中的 [Subagent 与 Workflow 执行 owner 跨加载替换](../finished/pi-suite/agents/execution-owner-reload.md) 已归档。

## Jobs Dock 运行时间刷新

### 现有根因

`src/jobs/index.ts` 的 `JobsModule.refresh()` 只在 JobManager 发出变化事件时重算 Dock 行；`elapsedMs` 在查询时计算（`src/jobs/manager.ts:78`）。输出增长不改变元数据、不触发刷新，Dock 行停留在启动时的 `0.0s`。Agents 在 `src/agents/index.ts` 有活动期间每秒刷新的展示计时器，Jobs 缺少同等机制；`/jobs` 浏览器自带每秒刷新，不受影响。

### 设计

- 新增 `src/ui/ticker.ts` 公共展示计时器：存在活动对象且详情可见时每秒触发，`unref`，隐藏、解绑或无活动对象时释放。Agents 替换现有私有 interval。
- `JobsModule.refresh()` 拆分为 Dock 行发布与通知处理；计时器只重新发布 Dock 行，读取内存元数据，不读历史文件、不投递通知、不写会话。

### 验收

- 活动 job 的 Dock 行运行时间每秒递增；job 结算后计时器释放。
- Agents 行为不变；typecheck 与 jobs/agents 相关测试通过。

## 相关 current 文档

- [Pi 子代理执行与记录](../current/agents/runtime.md)
- [公共运行时](../current/runtime/index.md)
- [统一界面](../current/ui/index.md)
- [执行任务](../current/jobs/index.md)

## 任务列表

- [ ] 公共展示计时器，Agents 与 Jobs 接入
- [ ] 更新 `doc/current` 的统一界面和 Jobs 页面
- [ ] typecheck、jobs/agents 相关测试与实际 Dock 验证

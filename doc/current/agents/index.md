# Pi 子代理

agents 模块在同一 Pi 进程内用 SDK 的 `createAgentSession` 运行 child 会话。执行层、两池队列、类型发现和记录引用改造自 @tintinweb/pi-subagents 0.23.0，来源见 [上游登记](../../../third-party/UPSTREAM.md)。工具、任务关联、wait、通知和查看器使用本包公共框架。

- 开关：`modules.agents`；`agents.*` 配置项与默认值见 [公共运行时配置](../runtime/index.md#配置)。
- 源码：`src/agents/`；child 内的本包工具由 `child.ts` 注册。

| 页面 | 内容 |
| --- | --- |
| [执行与记录](runtime.md) | ID 与记录字段、队列与并发、前台/后台、停止与 job 清理、会话文件、内存回收 |
| [进度与结果通知](progress.md) | agent_get 的进度字段、所属活动 job、结果通知 |
| [持久历史](history.md) | workspace 范围的历史发现、缓存、合并与只读记录 |
| [工具与操作](operations.md) | agent_* 工具、Dock、/subagents、@handle 提及、父级回答 |
| [类型、模型与 thinking](models.md) | 解析顺序、类型配置写入、启用开关、单个 run 的覆盖、模型运行时桥接 |
| [类型与资源](resources.md) | 类型文件与 frontmatter、扩展与工具范围、技能、提示组成、memory、包声明 |
| [定时调度](schedules.md) | cron、单次与周期调度 |
| [跨扩展 RPC](rpc.md) | 其他扩展启动、停止、引导和消费 child |
| [Workflow 编排](workflow/index.md) | 脚本编排多个 child |

## 内置类型

| 类型 | 工具 | 提示 |
| --- | --- | --- |
| general-purpose | 缺省工具集，见 [工具范围](resources.md#扩展与工具范围) | 追加在父级稳定提示之后（prompt_mode=append） |
| Explore | read、bash、grep、find、ls | 上游只读搜索提示（replace） |
| Plan | read、bash、grep、find、ls | 上游只读规划提示（replace） |

Explore 和 Plan 的只读来自提示词，且没有 write/edit 工具。它们不是沙箱：bash 仍可以修改文件。两者也没有 task、job 和 wait 工具。

## 默认值

| 项 | 默认 |
| --- | --- |
| 执行方式 | 后台（agent_start 的 background 默认 true） |
| 后台并发 `agents.maxConcurrent` | 10 |
| 前台并发 `agents.maxConcurrentForeground` | 0，不限 |
| 层数 `agents.maxDepth` | 3：顶级 child 加两层嵌套；嵌套 child 不占并发槽位 |
| 会话保存 `agents.persistSessions` | true，顶级 child 保存到磁盘；嵌套 child 默认在内存中 |

[返回当前文档](../index.md)

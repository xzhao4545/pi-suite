# 状态栏摘要与活动数量

目标：统一发布 goal 状态、活动 subagent 数量和活动 job 数量，使手机终端能从简短状态栏了解执行情况。

当前状态：待实施；Pi 与 pi-starship 的状态接口已静态核对，本包尚未注册业务状态。

影响范围：ui/status、goal、AgentManager、JobManager、会话绑定与 dock 显示去重。

约束：复用 setStatus；数量从实际执行记录派生，显示变化不启动、停止或转移执行对象。

相关当前文档：[项目当前状态](../../current/index.md)。

## 任务列表

- [ ] 通过共享发布入口维护 goal 和活动数量两个状态槽位
- [ ] 按当前会话可见集合派生数量，明确等待、排队、停止与终态的计数
- [ ] 合并生命周期更新，避免 token 级刷新和重复计数
- [ ] 协调 status/dock/hidden 模式及零数量隐藏
- [ ] 验证会话切换、reload、原生 footer 和 pi-starship 窄屏布局

## 验收方式

创建和结束多个 job/subagent，核对等待、排队、停止中和终态的计数；同一 job 被 agent 和任务同时引用仍只计一次。切换会话或 reload 后只显示新绑定可见集合，旧回调不能覆盖新数量。status 模式不在 dock 重复显示计数，无活动执行时清除数量状态。

## 关联计划

- [goal 状态栏联动](goal-status.md)
- [统一面板布局](ui.md)
- [job 查询与控制](jobs/history-control.md)
- [子代理记录与控制](agent-runs.md)

## 发布契约

共享 ui/status 使用 Pi 的公共 setStatus 发布两个稳定槽位：

| 状态键 | 内容 | 数据来源 |
| --- | --- | --- |
| goal | 目标及调度状态的短摘要 | 既有 goal 状态，保持原版稳定键 |
| pi-suite:runtime | agents N · jobs M | AgentManager 与 JobManager 的活动执行集合 |

```ts
ctx.ui.setStatus("goal", "goal 待答");
ctx.ui.setStatus("pi-suite:runtime", "agents 2 · jobs 3");
```

数量合并在同一状态槽位，减少 Starship 的 max_statuses 槽位占用；某一类为零时省略该段，两个数量都为零时清除 pi-suite:runtime。goal 独立更新，不因数量归零被清除。

所有模块提供既有状态或生命周期变化，只有共享入口写这些键；不持久化冗余计数，不读取状态栏文字反推执行状态。创建、开始、进入/退出等待、停止请求、退出结算和会话绑定变更时更新；同一批事件合并刷新，数量没有变化时不重复 setStatus。无需模型调用、轮询或每个 token 刷新。

## 计数范围与口径

默认统计当前绑定主会话可见的执行集合，与 jobs/agents 详情列表的默认归属过滤共用逻辑：包括当前分支引用的对象及所属 child 的执行对象。按实际 job ID 和 subagent 执行 ID 去重，不把主 agent 计入 subagent 数量。

- subagent 活动数包含已开始且尚未结算的执行：启动中、运行中、等待用户/任务/宿主、停止中。等待回答仍是活动执行，不因暂时没有模型流而消失。
- 排队未开始的 subagent、已结束执行，以及仅保留会话但没有未结算运行的 idle subagent 不计入活动数；排队数在详情中单独查看。
- job 活动数包含 starting、running、stopping；当前 manager 中退出清理仍 pending/unconfirmed 的执行保留在活动集合，并在详情明确“清理待确认”，避免尚未确认停止就显示空闲。
- 只剩持久历史、没有当前可控句柄的记录不当作已知活动 job；历史中的未确认状态保留诊断，不能把保存的 PID 当作当前运行证据。
- completed、failed、stopped、timed_out 等已结算对象不计入活动数量；历史列表仍可查询。

这里的数字表示活动执行数量，不能推导 CPU 利用率或正在发送的模型请求数量。用户切到别的会话时，原执行可继续，但摘要只展示新绑定可见对象；workspace 范围的列表可以查看其他会话对象，不自动转移所有权或通知归属。

## 显示配置与窄屏

沿用统一配置优先级，agents.display 和 jobs.display 采用与 goal.display 相同的 status/dock/hidden 取值：默认 status；dock 时仅由统一面板显示对应计数；hidden 时不常驻显示该类计数。不同模块可以选择不同位置，共享发布器只合并选择 status 的数量。

默认 status 模式下，dock 仍可按预算显示需要处理的 agent/job 详情行，但不重复纯数量汇总。用户进入详情可以查看完整状态；查看行为不改变运行或计数归属。

pi-starship 继续通过 `$extension_status` 显示；图标和样式可按原始键 pi-suite:runtime 配置。例如在已有 extension_status 配置中使用：

```toml
icons = { goal = "", "pi-suite:runtime" = "" }
```

goal 与数量共占两个状态槽位，需核对 Starship 的 max_statuses 和根 format 配置。Pi 原生 footer 将所有扩展状态合在一条额外状态行，不是每个状态键增加一行；该行仍需计入本包的聊天空间安排。Starship 可能整体换行，不能由本包强制限制其行数，边界见 [goal 状态栏联动](goal-status.md)。

示意：`goal 运行 · agents 2 · jobs 3`。实际连接符和排列由 footer 控制，不能承诺这三个片段一定显示在同一行或固定顺序。

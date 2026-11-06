# 状态栏摘要与活动数量

目标：统一发布 goal 状态、活动 subagent 数量和活动 job 数量，使手机终端能从简短状态栏了解执行情况。

当前状态：共享发布器、goal 摘要、agents/jobs 数量、显示模式和去重已实现，原生 footer 与完整 pi-starship 发布入口的 Linux 组合通过 [footer 联动阶段](../../finished/pi-suite/footer-integration.md) 验收；workflow 的 Dock 进度和 child/gate 普通数量过滤已接入，见 [宿主接入阶段](../../finished/pi-suite/agents/workflow-host.md)。当前 owner/branch 的直属 job 与可见 agent run 子树已共用完整 session 列表/数量范围，包含跨 cwd 和回收后代的遗留 job；必要详情走共享 StatusPublisher/Dock，数量变化写状态，问题、清理与选择变化单独刷新详情。Windows 与真实手机的可见集合、清理状态及用户实际 footer 配置继续验收。

影响范围：ui/status、goal、AgentManager、JobManager、会话绑定与 dock 显示去重。

约束：复用 setStatus；数量从实际执行记录派生，显示变化不启动、停止或转移执行对象。

相关当前文档：[项目当前状态](../../current/index.md)。

## 任务列表

- [x] 通过共享发布入口维护 goal 和活动数量两个状态槽位
- [x] 按当前会话可见集合派生数量，明确等待、排队、停止与终态的计数
- [x] 按摘要变化投影生命周期更新，避免 token 级刷新和重复计数
- [x] 协调 status/dock/hidden 模式及零数量隐藏
- [x] 通过同一发布入口接入待答、清理、失败和选中执行的必要详情，按状态变化刷新共享 Dock
- [x] workflow 提交共享 Dock 进度，child 与 gate 不重复计入普通 agents/jobs 数量
- [x] 验证会话切换、reload、原生 footer 40/60/120 列及 pi-starship extension_status 模块
- [x] Linux 完整 Starship 发布入口与真实 goal/tasks/child/jobs/ask 并存验收数量上限、缺失模块和三尺寸布局
- [ ] Windows 与真实手机 SSH 复核可见集合、复杂清理状态、用户实际 footer 与窄屏布局
- [x] 核对用户实际 Starship 配置缺少 `$extension_status`；默认 status 模式不承诺可见，用户配置保持不变，布局验收仍保留

## 验收方式

创建和结束多个 job/subagent，核对等待、排队、停止中和终态的计数；同一 job 被 agent 和任务同时引用仍只计一次。切换会话或 reload 后只显示新绑定可见集合，旧回调不能覆盖新数量。status 模式不在 dock 重复显示计数，无活动执行时清除数量状态。

停止 subagent 时同步跟踪其嵌套 child 和所属 job 的级联停止；child 模型已停止而 job 清理尚未确认时，仍保留未结算对象的活动计数和详情，不提前显示全部空闲。

## 关联计划

- [goal 状态栏联动](goal-status.md)
- [统一面板布局](ui.md)
- [job 查询与控制](jobs/history-control.md)
- [子代理记录与控制](../../finished/pi-suite/agents/runs.md)

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

所有模块提供既有状态或生命周期变化，只有本包共享入口写这些键，goal 键仅在本次激活实际启用 GoalManager 时持有；模块关闭时保留其他 provider 的 goal 状态，不随重绑配置值变化转移 ownership；不持久化冗余计数，不读取状态栏文字反推执行状态。创建、开始、进入/退出等待、停止请求、退出结算和会话绑定变更时更新；goal 摘要或活动数量变化时写状态，等数量的 ID 变化仍更新集合。必要详情通过 setActivities 一起提交，内容变化单独刷新 Dock，相同内容不重绘；token 增量和计时器不生成详情刷新。无需模型调用、轮询或每个 token 刷新。

## 计数范围与口径

默认统计当前绑定主会话可见的执行集合，与 jobs/agents 详情列表的默认归属过滤共用逻辑：直属 job 按 ownerSessionId 和当前 branch 的 anchor 过滤，汇总完整运行时 sessionJobs 与可见 agent run 根的 createdBy 子树，覆盖全部实际 cwd、已结束/已回收后代的遗留 job；列表在存储读取后补入当前 owned 副本，分页前按 ID 去重，workspace 范围仍限定当前工作区。agents 模块关闭时复用当前分支保存的 agent 记录和 visibleAgent 提取根，不创建新 AgentManager runtime。按实际 job ID 和 subagent 执行 ID 去重，不把主 agent 计入 subagent 数量。

- subagent 活动数包含已开始且尚未结算的执行：启动中、运行中、等待用户/父 agent/任务/宿主、停止中。等待回答仍是活动执行，不因暂时没有模型流而消失；child 向父 agent 提问时同样计入。workflow 内的 child 计入其 workflow 详情，不计入 agents 数量。
- 排队未开始的 subagent、已结束执行，以及仅保留会话但没有未结算运行的 idle subagent 不计入活动数；排队数在详情中单独查看。
- job 活动数包含 starting、running、stopping；workflow gate 由 workflow 详情和进度承载，不计入普通 jobs 数量。当前 manager 中 cleanup=pending 或 cleanup=unconfirmed 且尚未确认根进程退出的执行保留在活动集合，并在详情明确“清理待确认”，避免尚未确认停止就显示空闲。
- 只剩持久历史、没有当前可控句柄的记录不当作已知活动 job；历史中的未确认状态保留诊断，不能把保存的 PID 当作当前运行证据。
- completed、failed、stopped、timed_out 等已结算对象不计入活动数量；历史列表仍可查询。

占用的执行协议不兼容时，控制桥 v3 保留完整 session 查询与计数；v1/v2 状态仅显示当前分支直属活动 job，绑定时提示一次该范围，完整 session 列表明确返回 RUNTIME_UNAVAILABLE。workspace 查询、日志、停止和 quit 保留，不将能力不足解释为没有 child job。

这里的数字表示活动执行数量，不能推导 CPU 利用率或正在发送的模型请求数量。用户切到别的会话时，原执行可继续，但摘要只展示新绑定可见对象；workspace 范围的列表可以查看其他会话对象，不自动转移所有权或通知归属。

## 显示配置与窄屏

沿用统一配置优先级，agents.display 和 jobs.display 采用与 goal.display 相同的 status/dock/hidden 取值：默认 status；dock 时仅由统一面板显示对应计数；hidden 时不常驻显示该类计数。不同模块可以选择不同位置，共享发布器只合并选择 status 的数量。

默认 status 模式下，Dock 按预算显示需要处理的 agent/job 详情行，不重复纯数量汇总；hidden 同时隐藏该类常驻详情。待父级回答与 cleanup=pending/unconfirmed 优先，其后为未消费失败、停止中、查看入口选中的 run/job 和普通活动；已读取但尚未回答的问题继续显示，选择在绑定撤销时清除。用户进入详情可以查看完整状态；查看行为不改变运行或计数归属。

pi-starship 继续通过 `$extension_status` 显示；图标和样式可按原始键 pi-suite:runtime 配置。例如在已有 extension_status 配置中使用：

```toml
icons = { goal = "", "pi-suite:runtime" = "" }
```

goal 与数量共占两个状态槽位，需核对 Starship 的 max_statuses 和根 format 配置。Pi 原生 footer 将所有扩展状态合在一条额外状态行，不是每个状态键增加一行；该行仍需计入本包的聊天空间安排。Starship 可能整体换行，不能由本包强制限制其行数，边界见 [goal 状态栏联动](goal-status.md)。

示意：`goal 运行 · agents 2 · jobs 3`。实际连接符和排列由 footer 控制，不能承诺这三个片段一定显示在同一行或固定顺序。

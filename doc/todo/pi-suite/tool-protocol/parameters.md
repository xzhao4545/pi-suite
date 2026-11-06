# 参数与查询入口

## 列表与单项查询

推荐将查询意图放在工具名中，让模型无需记住同一对象中的隐藏互斥规则：

| 工具 | 主要参数 | 含义 |
| --- | --- | --- |
| task_list | groupId?、state?、cursor?、limit? | 未完成清单或某组内清单；无单项 id、parentId 或 detail |
| task_get | id | 一个组/子任务的状态与必要详情，不递归铺开整组；组内任务用 task_list(groupId) |
| job_list | state?、scope?、cursor?、limit? | jobs 列表；无单项 id |
| job_get | id、detail? | 单 job 状态；detail 明确请求完整命令和诊断元数据 |
| agent_list | state?、scope?、agentId?、cursor?、limit? | 子代理执行列表；agentId 是可组合的执行历史筛选，不触发单项详情模式 |
| agent_get | id、runId?、detail? | 当前或指定执行的状态；detail 按需查看配置来源与所属执行信息 |

task_list 使用 state 替代 includeDone；tasks 保留领域状态词（unfinished/doing/blocked/done/all），jobs 与 agents 保留 active/finished/all、agents 的 queued。统一字段含义、分页与默认值，不强迫不同状态机使用同一组枚举。

groupId 是筛选清单所属组；编辑时的 parentId 仍是父子关系字段。task_get 无“id 是组就自动列所有子任务”的隐藏模式，agent_get 也不隐式输出完整历史。历史执行通过带 agentId 的 agent_list 分页发现，返回准确 runId。

```json
{}
{"groupId":"1"}
{"groupId":"1","state":"all"}
```

上述为 task_list 示例；单任务详情使用 `task_get({"id":"2"})`。查询任务 #2 不要求模型同时知道其父级 #1。

列表继续分页，task 查询在领域层保留父子组织、完整组计数及跨页所需组上下文；不能直接切平铺数组导致下一页子项失去所属组。游标排序不依赖当前状态或最近更新，避免状态变化无故移动读取位置。

增加三个 get 工具有少量 schema 固定开销；验收比较总 schema、描述、结果和纠错轮次，而非仅比较工具数量。推荐该方案，因为错误入口被结构性消除，短回执和按需详情带来持续收益；不额外为每个详情字段拆一个工具。

## 紧凑 task_edit

单操作直接指定 op；批量也明确指定 op=batch：

```json
{"op":"done","id":"2"}
{"op":"start","id":"3"}
{"op":"block","id":"4","reason":"等待服务恢复"}
{"op":"unblock","id":"4"}
{"op":"update","id":"3","title":"验证实时刷新"}
{"op":"batch","changes":[{"op":"done","id":"2"},{"op":"start","id":"3"}]}
```

所有操作经同一 TaskStore 变更入口；批量项不允许再次嵌套 batch。block/unblock 与依赖阻塞的领域规则见 [任务专项](../tasks-goal-interaction.md)。start 不关闭其他 doing 任务，重复完成不能产生虚假的新完成反馈。

顶层保持 object；op 明确选择单操作或批量。使用当前宿主与 Provider 支持的 schema 能力表达操作所需字段，验证最终注册/转换后的 schema，不依赖仅对 TypeScript 有效的联合类型，也不依赖不支持的顶层 anyOf。批量额外的 op=batch 用于消除“单操作和 changes 同时传入”的意图歧义。

## 其他操作参数

保留 job_read/agent_read 的明确读取职责，保持 offset/limitBytes/search/context 的公共单位与续读语义。单项查询不顺带读取日志，读日志不隐式发送输入或恢复模型。

审查 job_start 的 command/agent/file-watch、job_write 的 input/keys/paste、agent_start 的 schedule/立即启动与 workflow 的 script/scriptPath。优先保留清晰常用默认路径，为真实冲突添加明确模式和 schema 约束；本专项不以节省字段名为由重构所有启动能力，也不使用含糊字符串 DSL。配置禁用的能力不要在可用 schema 中继续广告。

工具说明提供常用的最小示例、默认值和必要边界；复杂工作流的语义、审批、执行归属、超时效果及结构化输出约束保持完整。固定使用指南集中在工具描述或现有统一提示，避免每次成功回执重述。

## 错误与模型修正

- 参数错误返回稳定错误码、失败字段、简短原因和一个可执行示例；不能只报“exclusive”。明确未发生变更；若 job 已启动后关联失败，必须返回真实 job ID 和 started 状态。
- 未知 ID 提供正确发现入口；失效 cursor 提示重新列举；只读历史对象明确不能控制；不自动重试有副作用的操作。
- 不同时保留两个竞争查询入口，不通过静默忽略 id/parentId 等字段猜测用户意图；迁移所有内部调用、模型说明、测试和命令适配后更新注册。
- 模型仍可能给错参数；正确率目标是减少意图歧义和纠错成本，不能承诺所有模型绝不犯错。执行边界继续校验业务状态与归属。

示意：`INVALID_ARGS: task_list uses groupId for a group. Retry task_list({"groupId":"1","state":"all"}); one task uses task_get({"id":"1"}).`

[返回计划](index.md)

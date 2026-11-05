# 进度与结果通知

agents 的进度来自当前 run 记录、Pi 会话事件与 JobManager 的创建归属查询。读取进度不启动模型，不消费完成结果，也不改变 job 归属。

## agent_list(id)

指定稳定 agent ID 时返回该 agent 的最新 run 摘要与全部已知 run 摘要。模型正文只列最近 20 个 run（复用公共列表默认上限），同时标明已显示数量、总数和更多 workspace 历史入口；details.runs 保留全部已知 run，job 归属查询仍使用完整 runId 集合。正文显示状态、等待对象、活动、轮数、工具次数、用量、耗时、最近更新时间、模型/thinking 来源、待答问题及所属活动 job；完整输入、输出与工具参数仍通过 agent_read 按需读取。

| 返回字段 | 内容 |
| --- | --- |
| agent | 最新 run 的摘要；含 state、activity、turns、toolUses、usage、elapsedMs、lastUpdateAt 与模型来源，输入/结果分别为 promptSummary/resultSummary |
| runs | 同一稳定 agent ID 的全部已知 run 摘要，各自保留 runId 与真实状态 |
| waitingFor、question | 当前挂起问题的等待对象 parent 与共享 ask 参数；没有问题时不提供 |
| jobs | 所属活动 job 的 id、name、state、cleanup；cleanup 是清理状态，不能把已产生终态但仍待清理的 job 当作已完成控制 |
| jobsUnavailable | 创建归属查询不可用时的明确原因；此时 jobs 数组不能作为“没有活动 job”的依据 |

activity 在生成回复时显示 `Generating response`；工具开始后显示工具名与紧凑 JSON 参数，每个调用的参数摘要最多 180 字符。并发工具按 toolCallId 独立更新，某个调用结束不会隐藏其他未结束调用；执行退出时清除活动摘要。

usage 使用 Pi SessionStats 相对于本次 run 开始时的差值，包含 input、output、cacheRead、cacheWrite、total token 与 cost；消息和用量落盘事件更新活动查询，SDK 压缩产生的用量进入同一账本差值，结算时保存最终差值。耗时从实际开始计算，包含工具和父级回答等待；排队阶段不累计执行耗时。

## 所属活动 jobs

进度查询将该 agent 的全部 runId 交给 JobManager.createdBy；匹配创建 run 或其 ancestors，包含已结束、已回收 child 留下的 job。查询使用当前运行时持有的完整集合，不受 cwd、owner、branch 或分页限制，也不根据任务引用转移归属。保存的历史 PID 不用于重建活动 job。

活动筛选复用 jobs 的公共 isActive：非终态、cleanup=pending，以及 cleanup=unconfirmed 且尚未确认根进程退出的 job 参与展示。若控制桥不支持创建归属查询，返回 jobsUnavailable，其他进度字段仍可读取。modules.jobs=false 关闭 job 工具注册与绑定；agents 的主/child 查询仍通过未绑定的 JobsModule 访问同一运行时 owner，不清空 reload 前已创建的 job，也不另行订阅通知。

原生 agents 记录和 Transcript 的 Jobs 入口以所选 runId 查询其子树，复用 job 详情、日志和停止界面，操作边界见 [工具与操作](operations.md)。

## 结果通知

后台执行结算为 completed、failed、stopped 或 limited 时，统一 Notifications 投递一次结果摘要：agent ID、名称、runId、真实状态、耗时、用量、错误正文、结果首段和指定 runId 的 agent_read 提示。用量正文列出五类 token 与美元 cost（六位小数）；存在错误时显示经过字面量清理的前 500 字符，结果正文最多 500 字符。没有用量或错误记录时省略对应正文。

结果请求 ID 为 `agent:<agentId>:<runId>:result`；agent_read 或 wait 消费只撤销该次 run 尚未投递的通知，恢复后的新 run 独立。未提前返回的前台结果由工具直接返回；因提问或转后台提前返回的执行在最终结算后使用统一通知。提问与回答规则见 [父级回答](operations.md#父级回答)。

[返回 agents](index.md)

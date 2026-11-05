# 子代理运行记录与手动控制

目标：查看活动和已结束的 subagent，保留结果及原生会话历史，并允许用户停止指定 subagent 的当前执行。

当前状态：基础执行、结果/会话引用、独立 runId、恢复、历史结束叶子、列表、真实取消、嵌套与遗留 job 清理已接入，见 [基础阶段](../../../finished/pi-suite/agents/core.md)。Execution 定期回收、通知与 reader/workflow 保留引用、持久/非持久历史边界见 [类型与回收阶段](../../../finished/pi-suite/agents/types-retention.md)；workspace 持久历史发现、完整分支汇总、增量解析与原生只读查询通过 Linux 离线验收，范围见 [历史发现阶段](../../../finished/pi-suite/agents/history-discovery.md)，停止竞争通过 Linux 聚合验收，见 [生命周期阶段](../../../finished/pi-suite/agents/lifecycle.md)；所属 job 详情及平台组合继续推进。

影响范围：AgentManager、Pi child session、持久结果引用、agents 列表/查看器、停止信号及状态栏数量。

约束：agent 会话与一次执行分开；查看历史不启动模型；停止级联取消其嵌套 subagent 和所属后台 job，使用真实运行句柄并保留已产生内容。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [x] 列出活动、排队、已结束及全部 subagent 记录
- [x] 保留运行结果、起止时间、耗时、错误与 child session 引用
- [x] 对已结束记录复用原生会话查看器，按需读取历史
- [x] 将手动停止接入 child 的 abort 与工具取消、等待最终结算
- [x] 级联停止嵌套 child 及其启动的后台 job，处理启动竞争和多次执行边界（Linux 聚合验收通过，平台组合由扩展专项管理）
- [x] 将活动数量提供给共享状态栏发布器
- [x] 回收结束超过 10 分钟的 Execution，保留完整历史记录、结果、通知/reader/workflow 引用和遗留 job 归属
- [x] 从默认/配置目录与可达持久引用发现 workspace 完整分支历史，按 runId 查询并保留原生只读边界，读取不修复会话文件
- [ ] 在 agents 详情展示所属活动 job，并提供日志跳转与单独停止入口

## 验收方式

核对运行中、排队、成功、失败、手动停止和恢复后再次运行的记录；完成后读取结果并打开会话，查看不会产生模型请求。停止目标 child 时，同时取消嵌套执行和它们启动的后台 job；验证停止期间启动 job、已结束 child 遗留 job、重复 stop 和停止/自然完成竞争。不影响主 agent、同级 agent 及其创建的 job。reload 后仍可从持久引用查看已结束结果；旧回调不能覆盖新一次执行。

## 关联计划

- [原生会话查看器](../../../finished/pi-suite/agents/viewer-controls.md)
- [主从交互](interaction.md)
- [活动数量状态](../status.md)
- [job 查询与控制](../jobs/history-control.md)
- [目标调度](../goal.md)
- [统一工具设计](../tool-design.md)

## 运行记录与历史

agents 详情提供“活动 / 排队 / 已结束 / 全部”筛选。默认集合与状态栏当前主会话可见集合一致；明确切到 workspace 范围时可查其他会话的记录，不转移归属或混用通知。已结束包括成功完成、失败、手动停止和被运行限制中止，不能把这些状态统一标为成功。

Workspace records 与 `/agents workspace [active|queued|finished|all]` 默认 all，发现默认/当前配置会话目录及可达持久引用中的完整分支记录，按 configCwd 区分工作区。未知 ID 的 agent_list/read/send/stop 使用同一发现和 workspace 核对；其他 owner 或当前分支之外的已结算历史在原生菜单和查看器中只读。读取不修复、重写会话 JSONL，不启动模型；完整范围与合并/叶子验证见 [当前持久历史](../../../current/agents/history.md)。

每项展示 agent ID、名称/类型、任务摘要、ownerSession/parentAgent、本次执行标识、状态、开始/结束时间、运行耗时、用量、结果摘要与错误；完整输入、assistant 回复和工具结果在 child transcript 中按需查看。

活动执行可以实时查看；已结束执行仍可以读取结果并打开同一个原生消息查看器，保留 Markdown、代码块、thinking 和工具调用/结果折叠。关闭查看器只退出阅读。详细渲染规则维护在 [当前操作](../../../current/agents/operations.md)，专项设计与验收见 [原生会话查看器](../../../finished/pi-suite/agents/viewer-controls.md)，不另建文本版历史渲染器。

复用 Pi SessionManager 与上游 subagents:record 的会话条目（本包类型名为 pi-suite:agent-record）、child session 文件引用，避免另建一套会话数据库。默认保存完整 child session 和最终记录；内存对象释放后仍能通过引用查历史。主动选择不持久化的 agent 明确标记历史范围，不能承诺 Pi 退出后还能查看未保存的 transcript。上游的嵌套 child 默认不持久化，保留该默认值并在记录中标注。

历史不因面板折叠、完成通知已读或运行数量归零而删除。列表和模型结果读取默认返回摘要，完整结果与 transcript 按需分页/滚动；长时间没有被查看的内存对象可以释放，保存的会话仍可打开。

agent ID 用于稳定引用可恢复的会话；同一 agent 同时只保留一个未结算执行，每次执行使用独立执行标识或框架已有运行代次。恢复会话开始新一次执行，前次已结束结果仍可按记录查看；主会话条目记录对应结束位置，使历史查看不会把后来新增消息当成前次执行产物。只有明确的 resume/发送新任务动作启动模型，打开历史不隐式 resume。

耗时表示本次执行开始到结束的经过时间，包含等待用户、job 或宿主的时间，不把持久会话闲置时间累加进去。运行中按查询/可见详情更新，结束后固定；用量沿用框架与上游的既有用量账本，不在状态栏重复计算。

## 查询和控制接口

保留上游 Agent、get_subagent_result、steer_subagent 的能力，按 [统一工具设计](../tool-design.md) 改为 agent_start、agent_list、agent_read、agent_send、agent_stop 与共享 wait；查询、查看和停止各走 AgentManager 与同一个 child 记录，不为同一操作暴露多套参数。主从消息、提问转交和进度读取的完整规则见 [主从交互](interaction.md)。

| 入口 | 契约 |
| --- | --- |
| agent_list | 无 id 时 state? 为 active/queued/finished/all，默认 active；scope? 为 session/workspace，默认 session；cursor?/limit? 分页；返回短 ID、执行标识、状态、摘要和耗时，不附整段对话。有 id 时返回该 agent 的进度详情 |
| agent_read | id、runId?；stream 为 result（结算后默认）或 transcript（运行中默认）；offset/limitBytes/search/context 与 job_read 相同；已完成、失败、停止记录仍可读取 |
| agents 查看器 | 按记录打开活动或历史 child transcript，历史绑定该次执行结束位置；只有在底部自动跟随活动输出 |
| agent_stop | id、runId?；默认停止该 agent 的当前执行、所属嵌套执行及它们创建的活动 job；指定 runId 时限定到对应运行子树；返回 child/job 的真实停止进度，保留会话、结果和日志 |
| agent_send | 运行中为引导消息，提问等待中为回答，已结束为恢复会话并开始新一次执行；返回实际 action；查看历史与这些动作分开 |
| wait | ids 可包含 agent ID；仅控制本次调用是否等待，超时或取消不停止后台 child，需要明确调用 agent_stop |

用户在 agents 列表或查看器选择目标后可执行“停止”，入口明确提示同时停止其嵌套 subagent 和所属后台 job；可复用上游查看器已有的 x 再 x 操作，但必须在新查看器中明确提示并同步操作说明。阅读时按 Esc 退出、关闭 overlay 或停止主 agent 当前回复不能被误当作选择了该 child 的停止动作。

## 停止与资源边界

停止请求交给 child 的 AbortController/AgentSession abort 及工具取消信号，同时通过 JobManager 请求停止所属后台 job。进入停止中并等待 child 执行、嵌套 child 和 job 退出/清理结算；仅设置 stopped 标志或发送一条“请停止”消息不作为完成停止的依据。尚未返回的工具或尚未确认退出的 job 明确显示停止中或清理待确认，不虚构成功。

取消尚未开始的排队项会移出队列并记录停止原因，不创建 child 执行。停止先登记同范围共享操作、整批转换目标状态，再触发取消和订阅回调，重复停止合并已有停止请求；已经结算的 agent 仍检查其所属活动 job 并清理，原执行结果保持原终态。主模型停止请求、UI 停止和 child 自身结束竞争时按运行标识结算一次，旧执行的回调不能结束恢复后的新执行。父级最终结算等待所有未 settled 直接 child，自然终态不重复改为 stopped，清理期间不准入同 agent 的新 run；验收范围见 [生命周期阶段](../../../finished/pi-suite/agents/lifecycle.md)。

停止某个 subagent 时，同时取消其未结算的直属及后续嵌套 subagent 执行，并停止目标 agent 与这些后代创建的所有所属活动 job，包括已经结束的后代仍留在运行的 job；保留各自历史。按实际创建归属选择目标，不因某个 task 或 agent 仅引用了别人的 job 就转移所有权。一次请求汇总 child 和 job 的停止进度，不以父项单独改状态代替实际清理。

child 中同步执行的工具按其取消能力停止；已经由 JobManager 持有的后台 job 同样参与此次级联停止，pipe/PTY 以及已 detach 的 job 都适用。独立 manager 负责保活与实际进程控制，创建归属负责停止范围；detach 仅退出交互，不解除该归属。agents 详情展示所属 job，并保留跳转后单独停止的入口。外部请求已产生的副作用不能因 abort 自动回滚。

job_start 从 child 运行上下文自动记录创建 agent ID、执行标识和可追溯的父级执行链，模型不提交或维护级联名单。默认按 agent ID 停止时，包含该 agent 及其后代此前执行仍拥有的活动 job；指定执行标识时只处理该次运行及其后代创建的 job。从 manager 查询完整归属集合，不能因列表分页、面板折叠或工作区筛选遗漏目标。父级关系和 job 归属不因 child 完成、内存记录释放或会话切换而丢失。

停止开始时关闭目标运行子树的新 subagent/job 创建入口，再发出 child 与 job 的取消请求。正在启动的 job 必须先纳入 manager 的受管记录，启动完成后继续落实已有停止请求，避免在取消与注册之间留下进程。停止未结算前不恢复同一 agent 开始新执行；所有回调按原执行标识工作，不能误停止之后恢复的新运行。

一次 agent_stop 返回受影响的 child/job ID、已结束项和 pending/unconfirmed 摘要，可通过既有查询入口继续核对。child 模型停止不代表级联操作已经完成；存在未确认 job 时不能报告“全部停止”，对应活动数量也不能提前归零。仅有历史而无可控运行句柄时明确报告无法确认停止，不根据历史 PID 杀进程。

被实际中止的执行产生明确 stopped 结果，保留部分输出与错误；已结束执行的原结果不重写，不把关联任务标为 done，也不把 goal 自动改为完成。等待方收到结果后按用户指令决定后续；manager 不自行重启已停止 child。第一版不额外承诺活动 subagent 跨 Pi 进程保活，已保存历史可读取与恢复执行是不同能力。

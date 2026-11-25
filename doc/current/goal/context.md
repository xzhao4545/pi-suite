# 请求上下文与自动续跑

## 状态、模型视图和唤醒

GoalManager 是状态、归属与执行许可的唯一来源。`pi-suite:goal` version 2 完整 `custom` 快照用于分支恢复、详情和审计，不直接进入模型上下文。每秒 UI 时钟只读状态，不追加快照或请求。

`before_agent_start` 建立目标 ID、revision、Binding、控制代次和本轮权限。每次底层请求由公开 `context_with_system` 钩子读取相同归属守卫；过期、已取消、其他会话或未接纳运行不获得合同。模型上下文不反向授予执行许可。

权威合同是请求专用的 `pi-suite:goal-context` 自定义会话消息：稳定执行规则与 JSON 任务数据分别生成，模型请求中只有一份，不追加到持久日志。字段包括 goalId、revision、objective、status、access、automatic、resumeRequired、预算与 usedTokens、turns、当前 progress、错误、暂停原因及等待详情。工具参数范围不在合同中全文重复；目标正文不静默截断。

`access=execute` 允许 Goal 执行工具和自动续跑，`access=complete` 只允许审计与结案，不恢复执行。该权限不是文件沙箱；完成事实仍需逐项验收，skipped/timed_out/cancelled 的自动或未确认答案不是同意。

## 提示与 Provider 边界

完整 transcript 投影保留 leading system message、其他模块提示节以及工具增删记录，只移除本模块拥有的 `pi-suite-goal` 命名节。不会删除整条系统消息、强制重建提示或改写 Provider 私有 payload。

官方 Pi 1.5.0 在两种上下文钩子之后应用强制系统提示，并将系统节折叠到新的 head。会话形式的请求合同能保留在这个边界之后，不依赖可被覆盖的系统节。支持中途更新的 Provider 可以保留 prompt/tool deltas；折叠路径使用宿主公共 transcript adapter。

请求合同追加在本次上下文末尾，下一请求以最新合同替换它，不保留上一份合同。缓存兼容取决于接入的边界复用行为：存在接入能完整命中相同请求和追加式历史，却在移除上一份尾部合同后重新写入会话缓存，即使共同历史前缀、缓存键、模型和上游凭据均不变。这类接入的主会话可能仅命中系统／工具前缀；缓存键稳定或无 Goal 的子代理命中正常，均不能证明请求专用尾部合同可复用。该边界需用同请求重复、尾部合同替换和保留旧合同后的追加三种对照验证，不能推定所有 Responses 接入采用相同缓存策略。

## 通知的来源与有界性

自动继续仍经 Notifications，以 `goal:<ID>` 合并未送达请求。通知只携带简短模型唤醒信号，不复制目标正文、预算、进度或审计全文。纯 Goal 自动控制批次隐藏显示；混合通知由原生 message renderer 只隐藏 `source=goal-continuation` 的块，job/agent 等真实事件正文保留。已有宿主继续、待处理消息、用户输入、取消、重试、压缩和等待准入保持优先级；一个送达批次只产生一次唤醒。

显式 `/goal resume` 单独保存一条可见 `pi-suite:goal-resume` 自定义消息：正文为简短恢复结果，details 保存恢复前目标、原因、预算/用量、耗时、进度和必要等待信息。命令在共享通知 hold 内保存结果，再释放控制交付，不由展示消息启动模型。请求级投影移除该展示消息，不把用户摘要作为执行合同。注册在 factory 的轻量 renderer 使用宿主 expanded 选项与原生键盘展开，历史重建使用同一显示定义；阅读不改变执行许可或发起请求。

`pi-suite:notification` 的正文由文本块组成，`details.notificationVersion=1` 的 segments 与正文块一一对应，包含 requestId 和 source（`goal-continuation` 或 `event`）。job 结算、monitor/update、agent 结果/提问和 workflow 的实际来源由 requestId 区分；metadata 不重复保存事件正文。

请求视图只保留所属执行最近一份 Goal 控制片段。其他事件原样保留，包括混合批次中的结果、提问和更新；仅结案或无有效归属时移除 Goal 控制片段。持久批次与一次送达回调不受投影修改。未带结构化来源的通知不做文本匹配清洗，用户、模型、工具证据和完成/阻塞记录不作为重复控制删除。

投影读取内存状态并线性遍历宿主提供的 transcript，不扫描 JSONL、不序列化整个历史或重新复制工具定义。正常工作证据仍可增长；有界性只针对 Goal 自身的重复控制内容。

## 自动停跑

一个自动轮从当前目标的续跑通知实际送达开始，在宿主最终 completed、准备再次安排 Goal 继续的边界结束。错误尝试不结束自动轮，不计为无工具轮；agent_before_settle 的 error、已有 continue 或 pendingMessages 先等待恢复/宿主工作，不重复安排 Goal 控制。同轮的自然工具响应和宿主重试不单独计为自动轮。工具活动记录调用名/参数与最终 content/details/structuredContent/error 的摘要，包含嵌套调用；不保留完整工具输出历史，调用 ID、耗时和宿主请求用量不作为比较内容。并行完成按调用源顺序比较。

连续 5 个自动轮没有工具活动，或连续 5 个自动轮的调用与结果摘要相同，就保存 paused、撤销 automatic、取消 Goal pending 唤醒、冻结 running 时长，并保存 `reason.kind=no_tools|repeated_tools`。它不是完成、外部阻塞或 Provider error。既有 UI 通知和 `/goal` 详情显示原因；显式 `/goal resume` 清除原因、重新开始检测。后台事件、reload、树恢复或压缩不能恢复这份执行许可；新用户输入可审计，但不能自动恢复执行。

用户主动运行、实际 Goal 等待、编辑文本、替换、绑定撤销和非幂等显式 resume 重置检测；旧控制代次的结算不能停掉较新的恢复阶段。分支恢复在绑定时读取同目标/修订最后一份 snapshot 的自动停跑许可元数据，防止选择较早 active 快照绕过停跑；显式 resume 在同一快照流清除原因，不新建许可存储。变化的只读研究调用/结果保持正常推进。同一用户运行内的多个底层工具响应不触发五轮限制。

没有工具并不证明没有推理进展，相同结果也不证明工作毫无意义。这个保护只限制连续自动续跑，不评估质量、不自动结案；纯文本推理超过阈值会要求用户检查后恢复。

[返回目标管理](./index.md)

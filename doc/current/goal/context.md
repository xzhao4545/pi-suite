# 请求上下文与自动续跑

## 状态、模型视图和唤醒

GoalStore 的当前文件是状态与许可的唯一来源，GoalManager 协调运行归属和执行。存储、分支与迁移见 [单一当前状态](storage.md)。每秒 UI 时钟只读状态，不写文件或发请求。

`before_agent_start` 读取当前 Store 并建立目标 ID、revision、Binding、控制代次和本轮权限。工具继续核对最新状态和请求 AbortSignal；过期、已取消、其他会话或未接纳运行不能取得权限。模型上下文与交付 metadata 不反向授予执行许可。

稳定目标说明是持久进入会话的 `pi-suite:goal-context`：完整 objective、精确 goalId、revision、必要执行规则和最小控制字段分别生成。所选模型历史缺少当前目标修订时才追加完整说明；许可、预算或控制代次变化时追加短 `pi-suite:goal-control`。正常工具响应与统计变化复用已交付消息，`usedTokens`、`turns`、`elapsedMs`、完整进度与诊断留在 Store/UI，不每请求复制。工具证据/wait 约束由工具描述定义；目标正文不静默截断。

`access=execute` 允许 Goal 执行工具和自动续跑，`access=complete` 只允许审计与结案，不恢复执行，`access=none` 或无当前 Goal 禁止从历史取得 Goal 工具权限。该权限不是文件沙箱；完成事实仍需逐项验收，skipped/timed_out/cancelled 的自动或未确认答案不是同意。

## 提示与 Provider 边界

Goal/Notifications 不在 `context` 或 `context_with_system` 过滤历史、替换尾部合同或强制重建系统 head。系统提示、其他模块节与工具增删记录由宿主维护；`before_agent_start` 停止生成 `pi-suite-goal` 命名节，已有历史文字由最新 Goal 说明覆盖语义，不按请求删除。不会改写 Provider 私有 payload。

官方 Pi 1.5.0 在两种上下文钩子之后应用强制系统提示，并将系统节折叠到新的 head。持久会话形式的目标说明能保留在这个边界之后，不依赖可被覆盖的系统节。支持中途更新的 Provider 可以保留 prompt/tool deltas；折叠路径使用宿主公共 transcript adapter。

正常工作窗口保持已经发送的前缀，只追加必要目标说明、短控制和真实工作事件。合法压缩后从当前 Store 重建缺失目标说明：普通启动通过 `before_agent_start` 返回持久消息；压缩重试与工具之间的阈值压缩通过宿主 steering 在其已经安排的下一请求前交付，不为重建说明唤醒已完成目标或真实等待。目标历史、恢复文字与模型摘要不恢复权威状态。

本地真实 Responses serializer 核对正常续跑保留整个前次 input 前缀及系统/工具/缓存键。缓存命中还受服务实现、TTL、模型/凭据或资源切换、合法压缩与历史选择影响，不承诺生产命中率。收费对照须单独授权并限制请求及用量，不能以隐藏 UI、同缓存键或子代理命中替代主请求验证。

## 通知的来源与有界性

自动继续仍经 Notifications，以 `goal:<ID>` 合并未送达请求。通知只携带简短模型唤醒信号，不复制目标正文、预算、进度或审计全文。纯 Goal 自动控制批次隐藏显示；混合批次由真实 job/agent/workflow 等事件提供唤醒正文，不另加 Goal 继续文本，Goal 的实际交付回调仍只执行一次。已有宿主继续、待处理消息、用户输入、取消、重试、压缩和等待准入保持优先级；一个送达批次只产生一次唤醒。

显式 `/goal resume` 在必要状态提交成功后保存可见 `pi-suite:goal-resume` 条目，data.summary 与 data.text 仅为简短结果，不复制恢复前完整 Goal。命令在共享通知 hold 内保存结果，再释放控制交付，不由展示条目启动模型。该条目不进入模型上下文，也不作为执行合同。factory 的轻量 renderer 与宿主展开/历史显示复用同一定义；当前完整信息通过 `/goal status` 查看，阅读不改变执行许可或发起请求。

`pi-suite:notification` 的正文由文本块组成，`details.notificationVersion=1` 的 segments 与正文块一一对应，包含 requestId 和 source（`goal-continuation`、`event` 或不唤醒的 `reminder`）。job 结算、monitor/update、agent 结果/提问和 workflow 的实际来源由 requestId 区分；metadata 不重复保存事件正文。

已交付的 Goal 控制与真实事件原样留在模型历史，包括混合批次中的结果、提问和更新；最新有效控制覆盖历史许可语义。暂停、完成、clear、编辑或撤销绑定只取消未交付的旧请求，不删除已发送片段。未带结构化来源的通知不做文本匹配清洗，用户、模型、工具证据和完成/阻塞记录不作为重复控制删除。

说明交付在必要启动/压缩边界检查宿主公开模型投影，不逐请求扫描 JSONL、不重复序列化状态或复制工具定义。正常工作证据可增长，稀疏控制随工作历史由宿主自然压缩；不额外调用模型摘要或强制频繁 compact。Tasks 提醒复用 Notifications 的持久 envelope，在自然 turn_end 追加且不请求继续；频率和 generation 见 [任务提醒](../tasks/operations.md#提醒)。

## 自动停跑

一个自动轮从当前目标的续跑通知实际送达开始，在宿主最终 completed、准备再次安排 Goal 继续的边界结束。错误尝试不结束自动轮，不计为无工具轮；agent_before_settle 的 error、已有 continue 或 pendingMessages 先等待恢复/宿主工作，不重复安排 Goal 控制。同轮的自然工具响应和宿主重试不单独计为自动轮。工具活动记录调用名/参数与最终 content/details/structuredContent/error 的摘要，包含嵌套调用；不保留完整工具输出历史，调用 ID、耗时和宿主请求用量不作为比较内容。并行完成按调用源顺序比较。

连续 5 个自动轮没有工具活动，或连续 5 个自动轮的调用与结果摘要相同，就保存 paused、撤销 automatic、取消 Goal pending 唤醒、冻结 running 时长，并保存 `reason.kind=no_tools|repeated_tools`。它不是完成、外部阻塞或 Provider error。既有 UI 通知和 `/goal` 详情显示原因；显式 `/goal resume` 清除原因、重新开始检测。后台事件、reload、树恢复或压缩不能恢复这份执行许可；新用户输入可审计，但不能自动恢复执行。

用户主动运行、实际 Goal 等待、编辑文本、替换、绑定撤销和非幂等显式 resume 重置检测；旧控制代次的结算不能停掉较新的恢复阶段。分支绑定读取同会话的当前 Store，不能选择较早历史绕过停跑；显式 resume 原子清除当前原因，不新建许可存储。变化的只读研究调用/结果保持正常推进。同一用户运行内的多个底层工具响应不触发五轮限制。

没有工具并不证明没有推理进展，相同结果也不证明工作毫无意义。这个保护只限制连续自动续跑，不评估质量、不自动结案；纯文本推理超过阈值会要求用户检查后恢复。

[返回目标管理](./index.md)

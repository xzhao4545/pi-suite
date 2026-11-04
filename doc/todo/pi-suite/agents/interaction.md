# 主 agent 与 subagent 交互

目标：主 agent 可以启动、等待、查看进度、发送消息、回答提问并强制停止 subagent；child 需要信息时可以向父 agent 提问。

当前状态：待实施；上游只有父到子的 steer 和一次性结果，child 会话没有 UI，也没有向父 agent 或用户提问的工具。用户已确认 child 提问转给父 agent。

影响范围：AgentManager、child 会话工具注入、共享 Notifications 与 wait、agent_* 工具、状态栏计数和 goal 调度。

约束：child 不直接向用户弹出询问；提问与回答都走父会话的统一通知和 agent_send；查看与等待不启动模型；不另建消息总线。

相关当前文档：[公共运行时与配置](../../../current/runtime/index.md)、[ask 接口与操作](../../../current/ask/index.md)。

## 任务列表

- [ ] child 会话注册转交父 agent 的 ask_user，提问期间状态为 waiting(parent)
- [ ] agent_send 按 child 状态回答提问、引导运行或恢复会话，并返回实际 action
- [ ] agent_list(id) 返回进度详情，agent_read 读取运行中与已结束的 transcript 和结果
- [ ] 完成、失败、停止与提问经统一 Notifications 投递，已读取结果撤销通知
- [ ] wait 与前台 agent_start 在被等待的 child 提问时提前返回问题
- [ ] 嵌套 child 的提问只交给其直接父 agent

## 验收方式

用离线 faux provider 模拟主 agent 与 child：child 提问后主 agent 收到问题，用 agent_send 回答，child 收到回答继续执行并结算。主 agent 以 wait 等待两个 child 的 any/all；child 运行中 agent_read 返回最新进度与搜索结果。提问期间状态栏仍计入该 child；问题超时返回 timed_out，不当作同意；主 agent 被 Esc 中断时 child 继续等待回答；嵌套 child 的提问不越级投递给主 agent。

## 关联计划

- [运行记录与手动控制](runs.md)
- [扩展能力](extensions.md)
- [统一工具设计](../tool-design.md)
- [用户询问](../ask/index.md)
- [目标调度](../goal.md)

## 交互总览

| 方向 | 入口 | 行为 |
| --- | --- | --- |
| 主 → 子 启动 | agent_start | background 默认 true，立即返回 agent ID；false 时等待结算，child 提问时提前返回问题 |
| 主 → 子 发消息 | agent_send | 运行中插入为引导消息；提问等待中作为回答；已结束则恢复会话开始新一次执行；会话尚未创建时排队，创建后投递 |
| 主 ← 子 进度 | agent_list(id)、agent_read | 拉取状态、当前活动、transcript 与结果，不打断 child |
| 主 ← 子 等待 | wait | 多个 ID，any/all，超时只结束等待 |
| 主 ← 子 提问 | child 的 ask_user | 转为父会话通知，父 agent 用 agent_send 回答 |
| 主 ← 子 结果 | 结算通知、agent_read | 后台执行结算后通知一次；读取后撤销未投递通知 |
| 主 → 子 停止 | agent_stop | 级联停止嵌套 child 与所属 job，返回真实结算 |

agent_send 返回 action 为 answered、steered、resumed 或 queued 之一。child 处于 stopping、queued 或已删除时明确报错，不静默丢弃消息。

## child 提问

child 会话中注册同名 ask_user，参数沿用统一 schema，使父 agent 收到的问题结构与它自己向用户提问时相同，可以直接转问用户。

1. child 调用 ask_user 后，该执行进入 waiting，waitingFor 为 parent；child 的工具调用保持挂起，不结束其宿主循环。
2. 问题以请求 ID `agent:<agentId>:ask` 投递到父会话的统一通知。父会话 idle 时请求一次继续；忙碌时在下一个结算边界合并投递。
3. 通知包含 agent ID、名称、问题的紧凑文本、选项 ID 与标题，以及回答方式 `agent_send({"id":"agent_…","message":"…"})`。
4. 父 agent 可以直接回答，也可以调用自己的 ask_user 问用户后再回答。回答文本与某个选项 ID 或标题完全一致时，child 收到的结果带对应 optionIds；否则作为 freeform 文本返回，来源标为 parent。
5. timeoutMs 规则与 ask_user 相同：省略用配置默认值，0 不设期限。期限到达时 child 收到 timed_out，不能当作同意或默认答案。
6. 父 agent 调用 agent_stop 时，挂起的提问以 cancelled 结束并进入正常停止流程；对已超时或已结束的问题调用 agent_send 返回 NOT_RUNNING。

父 agent 正在 wait 或前台 agent_start 中等待该 child 时，等待直接返回问题，避免父等子、子等父。嵌套 child 的提问交给其直接父 agent：直接父正在等待时由等待返回；直接父以后台方式启动该 child 时，问题作为引导消息插入直接父的当前执行。上游在父执行结算时停止其嵌套 child，因此不存在直接父已结束而孙级仍在提问的情况。

child 提问期间计入 agents 活动数量；goal 调度不因 child 提问进入 waiting_user，主 agent 收到通知后按普通继续处理。

## 进度查看

agent_list(id) 返回：

| 字段 | 说明 |
| --- | --- |
| status、waitingFor | 统一状态及等待对象 |
| activity | 当前工具名与参数摘要，或“生成回复中” |
| turns、toolUses、usage、elapsedMs | 本次执行轮数、工具调用次数、用量与耗时 |
| lastUpdateAt | 最近一次消息或工具事件时间 |
| question | 待答问题摘要 |
| jobs | 所属活动 job 的 ID 与状态 |
| runs | 最近执行列表及各自结果状态 |

agent_read 的 stream 有两种：

- transcript：按消息顺序序列化为带角色标签的纯文本，工具调用写名称与参数摘要，工具结果写前若干行并标注省略字节数。运行中默认读取 transcript。
- result：最终 assistant 文本或结构化输出；失败与停止时为错误和保留的部分输出。结算后默认读取 result。

两种 stream 都使用与 job_read 相同的 offset、limitBytes、search、context 和默认智能截断，规则见 [jobs 输出读取](../jobs/output.md)。已写完的消息偏移稳定；正在生成的最后一条消息可能在下次读取时变长。

## 通知与唤醒

后台 child 结算（completed、failed、stopped、timed_out）时，向所属会话投递一次通知：ID、名称、状态、耗时、用量、结果首段（最多 500 字符）和 agent_read 提示。通知与 job、goal 共用统一 Notifications，在同一结算边界合并为一条消息。wait 或 agent_read 已经读取该次结算时，撤销尚未投递的通知。

上游 group-join 的批量等待由统一通知的边界合并替代，不保留 group 参数。前台执行的结果直接作为工具结果返回，不再另发通知。

[返回 agents 待办](index.md)

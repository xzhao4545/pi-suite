# 主 agent 与 subagent 交互

目标：主 agent 可以启动、等待、查看进度、发送消息、回答提问并强制停止 subagent；child 需要信息时可以向父 agent 提问。

当前状态：共享 ask schema 的父级提问、agent_send、wait/前台提前返回及统一通知已接入，见 [基础阶段](core.md)。多 run 通知/读取隔离、真实多 child any/all 与问题提前返回、嵌套 FG/BG 直接父级提问和 Esc/timeout 等待边界通过 3 项 Linux SDK 聚合检查，见 [生命周期阶段](lifecycle.md)；所属活动 jobs 与当前工具参数摘要的进度详情、结果通知的用量/错误正文已补齐，并通过 3 项 Linux 真实 SDK 聚合检查，稳定事实见 [进度与结果通知](../../../current/agents/progress.md)；平台验收由 [扩展专项](../../../todo/pi-suite/agents/extensions.md) 管理。

影响范围：AgentManager、child 会话工具注入、共享 Notifications 与 wait、agent_* 工具、状态栏计数和 goal 调度。

约束：child 不直接向用户弹出询问；提问与回答都走父会话的统一通知和 agent_send；查看与等待不启动模型；不另建消息总线。

相关当前文档：[公共运行时与配置](../../../current/runtime/index.md)、[ask 接口与操作](../../../current/ask/index.md)。

## 任务列表

- [x] child 会话注册转交父 agent 的 ask_user，提问期间状态为 waiting(parent)
- [x] agent_send 按 child 状态回答提问、引导运行或恢复会话，并返回实际 action
- [x] agent_list(id) 返回基本状态、活动和提问详情，agent_read 读取运行中与已结束的 transcript 和结果
- [x] 在 agent_list(id) 进度详情中补充当前工具参数摘要及所属活动 jobs 的 ID/状态
- [x] 在结果通知摘要补充用量及错误正文，保留既有 ID、名称、状态、耗时、结果首段和读取提示
- [x] 完成、失败、停止与提问经统一 Notifications 投递，已读取结果按 run 撤销通知
- [x] wait 与前台 agent_start 在当前会话任一直接 child 提问时提前返回问题（agents 已接入 unread，原生前台链路通过）
- [x] 嵌套 child 的提问只交给其直接父 agent

## 验收方式

用离线 faux provider 模拟主 agent 与 child：child 提问后主 agent 收到问题，用 agent_send 回答，child 收到回答继续执行并结算。主 agent 以 wait 等待两个 child 的 any/all；child 运行中 agent_read 返回最新进度与搜索结果。提问期间状态栏仍计入该 child；问题超时返回 timed_out，不当作同意；主 agent 被 Esc 中断时 child 继续等待回答；嵌套 child 的提问不越级投递给主 agent。

## 验收结论

进度与通知的 3 项 Linux（Node 24.22.2）真实 SDK 聚合检查通过。模型正文核对并发工具及参数上限、queued/waiting 状态、活动 usage 和 streaming transcript；归属核对稳定 ID 的全部 run 根与活动 descendant job，正文最近 20 个 run 不丢完整 details/query 范围，控制查询失败保留明确原因。失败通知核对实际 SDK 用量与错误正文，agent_read 按 run 取消未投递结果。基础问答和等待边界沿用上述生命周期阶段；Windows 与真实手机组合保留在 [扩展专项](../../../todo/pi-suite/agents/extensions.md)。

## 关联计划

- [运行记录与手动控制](runs.md)
- [扩展能力](../../../todo/pi-suite/agents/extensions.md)
- [统一工具设计](../../../todo/pi-suite/tool-design.md)
- [用户询问](../../../todo/pi-suite/ask/index.md)
- [目标调度](../../../todo/pi-suite/goal.md)

## 交互总览

| 方向 | 入口 | 行为 |
| --- | --- | --- |
| 主 → 子 启动 | agent_start | background 默认 true，立即返回 agent ID；false 时等待结算，child 提问时提前返回问题 |
| 主 → 子 发消息 | agent_send | 运行中插入为引导消息；提问等待中作为回答；已结束则恢复会话开始新一次执行；会话尚未创建时排队，创建后投递 |
| 主 ← 子 进度 | agent_list(id)、agent_read | 拉取状态、当前活动、transcript 与结果，不打断 child |
| 主 ← 子 等待 | wait | 多个 ID，any/all；其他未读执行也会提前返回，包括同 agent 的旧 run；超时或取消只结束等待 |
| 主 ← 子 提问 | child 的 ask_user | 转为父会话通知，父 agent 用 agent_send 回答 |
| 主 ← 子 结果 | 结算通知、agent_read | 后台执行结算后通知一次；读取后撤销未投递通知 |
| 主 → 子 停止 | agent_stop | 级联停止嵌套 child 与所属 job，返回真实结算 |

agent_send 返回 action 为 answered、steered、resumed 或 queued 之一。排队、创建中或当前没有流式请求的 child 暂存消息；处于 stopping、结算中或无法找到目标时明确报错。执行已结束但停止/清理操作仍未返回时拒绝新 run，不能通过恢复绕过清理。

共享 wait 按 `(id, runId)` 判断已经在 results 中的执行。等待当前 run 时，同 agent 的旧未读结果进入 others、reason 为 other；消费只改变旧 run，新 run 保持 pending。提前返回的原因是另一个执行的结果，不要求 agent ID 不同。入口 signal 已取消时立即拒绝；wait 的取消和超时不停止 child。

## child 提问

child 会话中注册同名 ask_user，参数沿用统一 schema，使父 agent 收到的问题结构与它自己向用户提问时相同，可以直接转问用户。

1. child 调用 ask_user 后，该执行进入 waiting，waitingFor 为 parent；child 的工具调用保持挂起，不结束其宿主循环。
2. 问题以请求 ID `agent:<agentId>:<runId>:ask` 投递到父会话的统一通知。父会话 idle 时请求一次继续；忙碌时在下一个结算边界合并投递。请求和消费均限定该次 run，不取消恢复后新执行的通知。
3. 通知包含 agent ID、名称、问题的紧凑文本、选项 ID 与标题，以及回答方式 `agent_send({"id":"agent_…","message":"…"})`。
4. 父 agent 可以直接回答，也可以调用自己的 ask_user 问用户后再回答。回答文本与某个选项 ID 或标题完全一致时，child 收到的结果带对应 optionIds；否则作为 freeform 文本返回，来源标为 parent。
5. timeoutMs 规则与 ask_user 相同：省略用配置默认值，0 不设期限。期限到达时 child 收到 timed_out，不能当作同意或默认答案。
6. 父 agent 调用 agent_stop 时，挂起的提问以 cancelled 结束并进入正常停止流程；问题超时后不再接受该次回答。运行结算/停止清理中不能通过 agent_send 恢复，清理结束后的显式发送按普通新 run 恢复契约处理。

父 agent 正在 wait 或前台 agent_start 中等待时，它的任一直接 child 提问都使等待直接返回问题，不限于正在等待的那个 child，避免父等子、子等父或提问的 child 卡到等待超时。嵌套 child 的提问交给其直接父 agent：直接父正在等待时由等待返回；直接父以后台方式启动该 child 时，问题作为引导消息插入直接父的当前执行。上游在父执行结算时停止其嵌套 child，因此不存在直接父已结束而孙级仍在提问的情况。goal_wait 的 waitFor 也不阻挡提问通知，见 [目标状态与续跑](../../../todo/pi-suite/goal.md)。

child 提问期间计入 agents 活动数量；goal 调度不因 child 提问进入 waiting_user，主 agent 收到通知后按普通继续处理。

## 进度查看

agent_list(id) 的进度正文包含下列字段；details 中的 agent 保留 run 摘要，waitingFor/question 为待答问题，jobs 为所属活动列表，runs 为全部已知执行摘要。模型正文按公共默认上限只列最近 20 个 run，并标明总数及更多 workspace 历史入口，归属查询不受该正文上限影响：

| 字段 | 说明 |
| --- | --- |
| state、waitingFor | 统一状态及等待对象 |
| activity | 生成回复时为 Generating response；工具期间为当前工具名与每个调用最多 180 字符的紧凑 JSON 参数，并发调用按 toolCallId 分别保留 |
| turns、toolUses、usage、elapsedMs | 本次执行轮数、工具调用次数、用量与耗时 |
| lastUpdateAt | 最近一次消息或工具事件时间 |
| question | 待答问题摘要 |
| jobs | 该稳定 agent ID 的全部已知 run 及其子树创建的活动 job，包含 id、name、state、cleanup，正文提供 job_read 提示 |
| jobsUnavailable | 创建归属查询不可用的明确原因，不能把不可用解释为空活动集合 |
| runs | 全部已知执行列表及各自结果状态；模型正文仅最近 20 个，details.runs 保留完整集合 |

agent_read 的 stream 有两种：

- transcript：按消息顺序完整序列化为带角色标签的纯文本，工具调用包含名称与参数，工具结果保留文本后由共享字节读取规则分页/截断。运行中默认读取 transcript。
- result：最终 assistant 文本或结构化输出；失败与停止时为错误和保留的部分输出。结算后默认读取 result。

两种 stream 都使用与 job_read 相同的 offset、limitBytes、search、context 和默认智能截断，规则见 [jobs 输出读取](../../../todo/pi-suite/jobs/output.md)。已写完的消息偏移稳定；正在生成的最后一条消息可能在下次读取时变长。

## 通知与唤醒

后台 child 结算（completed、failed、stopped、limited）时，向所属会话投递一次通知：ID、名称、runId、状态、耗时、用量、错误正文、结果首段（最多 500 字符）和指定 runId 的 agent_read 提示。用量沿用 Pi SessionStats 的本次执行差值，正文包含 input/output/cacheRead/cacheWrite/total token 与美元 cost（六位小数），SDK 压缩用量进入同一账本；错误正文经字面量清理后最多 500 字符。没有用量或错误记录时省略相应正文。未回答问题的 timed_out/cancelled 由 child 的 stopped 终态保留。结果请求 ID 为 `agent:<agentId>:<runId>:result`。通知与 job、goal 共用统一 Notifications，在同一结算边界合并为一条消息。wait 或 agent_read 已经读取该次结算时，只撤销该 run 尚未投递的通知。

上游 group-join 的批量等待由统一通知的边界合并替代，不保留 group 参数。未提前返回的前台执行结果直接作为工具结果返回，不再另发通知；因提问或转后台提前返回的执行，最终结果进入统一通知。

[返回已完成专项](../../index.md)

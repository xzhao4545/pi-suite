# 接口与操作

| 命令 | 行为 |
| --- | --- |
| /goal <目标> | 建立目标并请求执行；替换未完成目标时由界面确认 |
| /goal --tokens 100k <目标> | 建立有显式 token 上限的目标，支持 k/m 数量单位 |
| /goal 或 /goal status | 查看完整文本、目标与调度状态、ID、用量、响应次数、耗时、进度和错误 |
| /goal edit <文本> | 修改目标文本与修订号；中止归属原修订的在途运行，按自动许可调度 |
| /goal edit --tokens 200k | 修改预算；达到上限立即限制；提高预算后使用 resume 恢复 |
| /goal pause | 显式暂停目标并中止归属该目标的运行 |
| /goal resume | 恢复未完成目标；已耗尽的预算需要先提高。目标正运行时保持 running；宿主忙时提示等待当前响应、取消或宿主操作结束，不并行启动第二个主模型 |
| /goal stop | 停止并保留目标、进度、用量、耗时与错误，记录 stoppedFrom；中止归属该目标的运行，清除自动许可和期限 |
| /goal clear | 删除目标、状态和期限，中止归属该目标的运行 |

目标文本最长 4000 字符；较长要求可引用文件。预算为正整数，省略时无限制。新用户输入可恢复宿主输入框 Esc 或询问系统取消留下的 active 目标；paused、failed、blocked、budget_limited、stopped 不因普通输入恢复执行，只有显式 `/goal resume` 恢复。正常退出保存未完成目标为 stopped，冷启动也撤销遗留 active 自动许可；树选择和 reload 不能绕过冷启动的手动恢复要求。询问面板的顶层 Esc 返回 skipped，模型继续本轮且保持目标自动许可；空闲到期 timed_out 提交自动答案并继续，这两种结果都不提供需要用户同意的操作授权。

常驻摘要保留 `goal` 标签，用图标区分状态：`🎯 goal 03:27` 运行，`⏳ goal` 等待用户、任务或宿主恢复及待继续，`⏸ goal` 显式暂停或 Esc 后停止自动续跑，`⚠ goal` 阻塞，`❌ goal` 请求失败，`⏹ goal` 预算耗尽或 stopped，`✅ goal` 完成。完成反馈显示 5 秒，其余状态持续显示；clear 后立即隐藏，stop 保留停止摘要。所有可见状态附累计有效时长，格式为 mm:ss，超过一小时使用 h:mm:ss；暂停与等待冻结，恢复接续，不按 24 小时归零。具体等待原因、预算、停止前状态和错误通过 `/goal` 查看。

目标工具使用当前提示中的精确 goalId，并由运行归属校验：

- goal_complete(goalId, summary)：summary 提供逐项完成和验证证据；成功后 completed，并结束宿主循环。新的用户驱动审计轮可关闭 failed、paused、blocked、budget_limited、stopped，不须先 resume，不授予自动执行权；completed 幂等保留原证据、时间与反馈，不另加 complete 命令。
- goal_blocked(goalId, reason, evidence, repeatedTurns)：同一外部障碍至少连续三轮，必须提供具体原因与证据；成功后 blocked，结束宿主循环。
- goal_wait(goalId, reason, waitFor?, resumeAfterMs?)：仅等待已安排的外部事件；可选 1–2147483647 毫秒单次期限；成功后 waiting_jobs，结束宿主循环。waitFor 为 1–50 个 job_/agent_/wf_ ID：目标只在它们全部结算、期限到达、其中 job 的 monitor 事件（`job:<id>:monitor`）或 hands-free 更新（`job:<id>:update`）、直接 child 提问（`agent:<id>:<runId>:ask`）或用户输入时恢复，其他结算通知排队并在恢复时合并送达。调用时已结算的 ID 列在结果中，全部已结算时不进入等待；不存在的 ID 报错；Pi 重启后只剩历史的 ID 不再阻挡恢复。

goal_complete、goal_blocked、goal_wait 使用公共一行 renderer，结果到达后隐藏调用；分别显示 summary、reason 或等待结论。展开保留完整 summary、阻塞 evidence/repeatedTurns 或 waitFor/resumeAfterMs/已结算对象；默认 Ctrl+O 与鼠标单项展开由宿主管理。

三个模型工具共用 ToolError：空白参数为 INVALID_ARGS，缺失或错误 goalId 为 NOT_FOUND；wait/block 的目标非 active 或仅结案轮为 NOT_RUNNING（错误码，不是目标状态）；旧修订、旧请求/取消代次、已撤销绑定或非所属会话为 STALE_BINDING。complete 仍严格校验 ID、revision、Binding、所属会话与本轮请求，不因非 active 放宽归属。错误正文给出下一步，objectId 为调用中的 goalId。该边界作用于模型工具，命令交互与持久记录解析保留各自错误说明。

完成判定仍需模型依据原目标逐项审计；运行归属与参数校验不能代替事实验收。普通未完成工作不能用 blocked 或 wait 替代推进。

详情通过 Markdown 与独立阅读位置在共用阅读 overlay 中呈现。↑/↓、PageUp/PageDown、Home/End 阅读，/ 搜索，n/N 查找下一/上一匹配，Esc 关闭。关闭详情恢复 dock，不改变目标。

[返回目标管理](./index.md)

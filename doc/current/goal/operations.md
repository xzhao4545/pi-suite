# 接口与操作

| 命令 | 行为 |
| --- | --- |
| /goal <目标> | 建立目标并请求执行；替换未完成目标时由界面确认 |
| /goal --tokens 100k <目标> | 建立有显式 token 上限的目标，支持 k/m 数量单位 |
| /goal 或 /goal status | 查看完整文本、统一用户状态、原因、ID、用量、响应次数、耗时、进度和错误 |
| /goal edit <文本> | 修改目标文本与修订号；中止归属原修订的在途运行，按自动许可调度 |
| /goal edit --tokens 200k | 修改预算；达到上限立即限制；提高预算后使用 resume 恢复 |
| /goal pause | 显式暂停目标、撤销自动许可，取消续跑与等待资源并中止归属运行；保留目标、证据、错误、用量和耗时 |
| /goal resume | 恢复未完成目标；已耗尽预算需要先提高。默认 `Goal resumed`；已运行时 `Goal already running`；宿主忙时 `Goal resumed · waiting`，不并行启动第二个主模型 |
| /goal clear | 删除目标、状态和期限，中止归属该目标的运行 |

目标文本最长 4000 字符；较长要求可引用文件。预算为正整数，省略时无限制。新用户输入可恢复宿主输入框 Esc、询问系统取消或失败的手动 compact 留下的暂停；显式暂停、外部阻塞、最终请求失败、预算耗尽、自动保护与退出/冷启动撤权需要显式 `/goal resume`。取消结果本身不提供同意，新输入恢复执行与危险操作授权分别判断。树选择和 reload 不能绕过手动恢复要求。暂停入口仅有 pause；`stop` 被拒绝为未知控制命令，不作为目标正文创建目标。询问面板的顶层 Esc 返回 skipped，模型继续本轮且保持目标自动许可；空闲到期 timed_out 提交自动答案并继续，这两种结果都不提供需要用户同意的操作授权。

常驻摘要保留 `goal` 标签，用四种图标区分用户状态：`🎯 goal 03:27` 进行中（执行或已安排继续），`⏳ goal` 等待用户、外部工作或宿主恢复，`⏸ goal` 已暂停，`✅ goal` 已完成。完成反馈显示 5 秒，其余状态持续显示；clear 后立即隐藏。所有可见状态附累计有效时长，格式为 mm:ss，超过一小时使用 h:mm:ss；暂停与等待冻结，恢复接续，不按 24 小时归零。具体等待对象、期限、预算、暂停原因及真实错误通过 `/goal` 查看。

恢复结果是一条不进入模型上下文的自定义会话条目，默认仅一行；使用宿主原生展开键（默认 Ctrl+O）阅读恢复前目标、原因、用量/预算、进度和必要等待信息，再次收起。展开/收起只影响阅读，不发请求或改变执行许可。Pi 1.5.0 的自定义条目没有单项鼠标展开接口；这里使用原生键盘操作，不增加模拟点击界面。条目 data 保留 summary 与展开正文，错误通过命令边界报告，不写成功结果。

连续 5 个自动续跑轮无工具活动，或调用与结果摘要完全相同，会暂停并显示 `⏸ goal` 与原因。普通用户输入可以审计，不能恢复该停跑阶段的执行；使用 `/goal resume` 清除原因并重置检测。后台通知、reload 与 compact 不绕过这一要求。用户主动轮和同轮自然工具响应不计作独立自动轮，真实等待走 goal_wait；纯文本推理不等于无进展，但超过自动阈值仍需检查后恢复。详细边界见 [请求与续跑](./context.md)。

目标工具使用当前请求合同中的精确 goalId，并由运行归属校验：

- goal_complete(goalId, summary)：summary 提供逐项完成和验证证据；成功后 completed，并结束宿主循环。新的用户驱动审计轮可关闭 paused 目标，不须先 resume，不授予自动执行权；completed 幂等保留原证据、时间与反馈，不另加 complete 命令。
- goal_blocked(goalId, reason, evidence, repeatedTurns)：同一外部障碍至少连续三轮，必须提供具体原因与证据；成功后 paused、reason.kind=blocked，结束宿主循环。
- goal_wait(goalId, reason, waitFor?, resumeAfterMs?)：仅等待已安排的外部事件；可选 1–2147483647 毫秒单次期限；成功后 waiting_jobs，结束宿主循环。waitFor 为 1–50 个 job_/agent_/wf_ ID：目标只在它们全部结算、期限到达、其中 job 的 monitor 事件（`job:<id>:monitor`）或 hands-free 更新（`job:<id>:update`）、直接 child 提问（`agent:<id>:<runId>:ask`）或用户输入时恢复，其他结算通知排队并在恢复时合并送达。调用时已结算的 ID 列在结果中，全部已结算时不进入等待；不存在的 ID 报错；Pi 重启后只剩历史的 ID 不再阻挡恢复。

goal_complete、goal_blocked、goal_wait 使用公共一行 renderer，结果到达后隐藏调用；分别显示 summary、reason 或等待结论。展开保留完整 summary、阻塞 evidence/repeatedTurns 或 waitFor/resumeAfterMs/已结算对象；默认 Ctrl+O 与鼠标单项展开由宿主管理。

三个模型工具共用 ToolError：空白参数为 INVALID_ARGS，缺失或错误 goalId 为 NOT_FOUND；wait/block 的目标非 active 或仅结案轮为 NOT_RUNNING（错误码，不是目标状态）；旧修订、旧请求/取消代次、已撤销绑定或非所属会话为 STALE_BINDING。complete 仍严格校验 ID、revision、Binding、所属会话与本轮请求，不因非 active 放宽归属。错误正文给出下一步，objectId 为调用中的 goalId。该边界作用于模型工具，命令交互与持久记录解析保留各自错误说明。

完成判定仍需模型依据原目标逐项审计；运行归属与参数校验不能代替事实验收。普通未完成工作不能用 blocked 或 wait 替代推进。

详情组件仅在实际查看路径按需加载；加载后重新校验 SessionBinding 与取消信号，已撤销的页面不挂载。通知使用 hold/finally 在读取后释放，加载异常由命令边界报告。详情通过 Markdown 与独立阅读位置在共用阅读 overlay 中呈现。↑/↓、PageUp/PageDown、Home/End 阅读，/ 搜索，n/N 查找下一/上一匹配，Esc 关闭。关闭详情恢复 dock，不改变目标。

[返回目标管理](./index.md)

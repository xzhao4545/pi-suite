# 状态与宿主生命周期

目标以 version: 2 的 pi-suite:goal 自定义会话条目保存。字段包含稳定 ID、目标修订号、文本、生命周期、自动工作许可、可选手动恢复要求 resumeRequired、暂停原因 reason、等待类型、可选期限和 token 预算、累计用量、运行耗时、响应次数、进度、错误。reason 保存原因 kind、必要的先前原因 previous、历史自动保护诊断 automaticStop 和撤销的等待详情 wait。恢复读取所选分支最后一条记录；goal: null 表示清除。非法记录与矛盾许可组合报告错误。

持久生命周期仅为 active、paused、completed。内部调度为 running、waiting_user、waiting_jobs、waiting_host、detached、idle，不单独持久化，也不与生命周期并列展示。统一用户状态为进行中、等待中、已暂停、已完成；active 的用户、外部或宿主等待投影为等待中，其余 active 为进行中；paused 与 completed 分别对应已暂停与已完成。detached 仅表示未绑定。

version 1 读取在快照解析边界迁移：failed、blocked、budget_limited、stopped 和 paused 映射为 paused，保留错误、阻塞证据及历史停止/自动保护诊断；active 的自动许可、等待、手动恢复标记决定继续等待或暂停。Esc、询问系统取消与失败的手动 compact 可由新用户输入恢复；显式暂停、自动保护及冷启动撤权需要显式 resume。迁移只生成内存视图，不重写原 JSONL，所有新快照写 version 2。

| 事件 | 状态与调度 |
| --- | --- |
| 目标未完成，正常结算 | active，统一边界安排一次继续 |
| agent_end 与宿主重试 | active，waiting_host；等最终结算，不叠加重试 |
| 重试耗尽，最终请求错误 | agent_settled 确认 paused，reason.kind=request_failed，保存最终真实错误；agent_before_settle 只冻结为 waiting_host，不提前撤权 |
| 手动 compact | 压缩成功后按恢复许可恢复自动工作，等待宿主 idle；已有用户/job 等待继续保留，显式恢复要求不能被压缩绕过 |
| 自动阈值/溢出 compact | 保留 active；willRetry 时由宿主恢复响应，否则由统一协调器调度 |
| compact 取消或失败 | paused，reason.kind=compaction_failed；等待诊断与可用错误保留，新用户输入可恢复 |
| 宿主输入框 Esc | paused、idle，reason.kind=cancelled，resumeRequired=false；新用户输入或 /goal resume 可恢复 |
| 连续 5 个自动轮无工具或工具活动摘要完全相同 | paused、idle，保存 reason.kind=no_tools/repeated_tools；显式 resume 才恢复，新用户输入仅审计 |
| ask_user skipped | active，保持自动许可并继续本轮；保留已有答案，不作为整批确认或同意 |
| ask_user timed_out | active、running，自动答案作为推荐方案继续，不作为授权 |
| ask_user cancelled | paused，reason.kind=cancelled，reason.wait.waiting=user；新用户输入或 /goal resume 恢复执行，结果本身不提供同意 |
| goal_wait | active、waiting_jobs；外部唤醒或单次期限恢复工作 |
| 显式暂停/完成/预算耗尽 | paused/completed；取消继续请求与等待期限，暂停保留等待诊断；clear 才删除 |
| quit | 所有未完成目标保存 paused、reason.kind=shutdown 与 resumeRequired=true；撤销自动许可和期限，保留错误、进度、用量和耗时；completed 保持完成 |
| 冷启动 | 所有未完成目标撤销遗留许可并要求手动 resume，包括 Esc 可恢复快照；不发请求或安装期限唤醒 |
| reload/new/resume/fork/tree | 撤销旧绑定，按当前分支重建；不能绕过该目标的冷启动恢复要求 |

运行归属记录目标 ID、修订号、所属会话 Binding、本轮请求 AbortSignal 与控制取消代次；显式 resume 的控制代次保护较新恢复意图，不让旧响应 aborted 结算覆盖它；过期工具不能完成、阻塞或等待被修改或替换的目标。执行权限要求 active 与本轮执行归属；非 active 目标的新用户审计轮可取得仅结案权限，不恢复 automatic，不调度工作、登记 running 耗时或触发执行预算门。completed 的重复完成保持原证据、时间和反馈，不追加状态。仅被接纳的运行由每次请求的 context_with_system 注入一份不落盘的 pi-suite:goal-context 会话合同，稳定规则与 JSON 任务数据分开；通知只携带短唤醒信号，提示与投影细节见 [请求上下文](./context.md)。无用户输入的无关扩展运行或 child 不取得结案权。Esc 后的其他扩展自定义运行不能恢复目标。预算只在显式配置时生效；message_end 累加宿主提供的 totalTokens，包括输入、输出与缓存用量，结案审计也计入用量。文本修改后同一目标的在途响应仍计入累计用量，但不能覆盖显式暂停等终态。

运行耗时使用 performance.now 单调时钟累计有效 running 片段；实时摘要加上当前片段，离开 running 时冻结。用户等待、后台等待、宿主恢复、暂停及应用离线时间不计入，恢复后接续累计。可见 TUI 运行时每秒通过同一 StatusPublisher 刷新，tick 不写会话、不发模型请求；离开 running 或撤销绑定时取消 interval。对已归属当前目标的进行中运行，resume 幂等保留 running，不排队新响应。宿主忙于其他响应、取消结算、压缩或重试时保存恢复意图，并在可用边界安排一次继续。自动继续使用 goal:<ID> 稳定请求 ID；与其他通知合并，已有宿主继续和待处理消息优先。界面详情不发起模型请求。

期限与完成反馈定时器在撤销绑定时取消，回调检查绑定代次和目标 ID。修改目标文本取消原目标的 job 等待；询问系统取消保留用户等待详情与新输入恢复许可。完成反馈 5 秒后清除摘要，持久目标及完成证据继续保留。

暂停原因及手动恢复要求存放在同一 Goal snapshot；同一会话的 getEntries 只读查找同 goalId 权限元数据，true 阻止旧 active 分支绕过，显式 resume 写 false 且只授权当前选择的 revision。version 1 未含 resumeRequired 的自动保护记录也参与撤权判断；同修订的后续快照清除自动保护时保留该版本的显式恢复语义，但无标记保存不能覆盖已有手动恢复标记。状态通过正常 append 保存，不修改源 JSONL，也不在树切换时把出站目标写入入站分支。自动保护、手动暂停与冷启动撤权共用这份快照流，不建立第二份权限存储。

[返回目标管理](./index.md)

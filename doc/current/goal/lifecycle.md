# 状态与宿主生命周期

目标以 version: 1 的 pi-suite:goal 自定义会话条目保存。字段包含稳定 ID、目标修订号、文本、目标状态、自动工作许可、等待类型、可选期限和 token 预算、累计用量、运行耗时、响应次数、进度与错误。恢复读取所选分支最后一条记录；goal: null 表示清除。非法记录报告错误。

目标状态为 active、paused、blocked、failed、completed、budget_limited。调度状态为 running、waiting_user、waiting_jobs、waiting_host、detached、idle；调度不作为另一份持久目标状态保存。

| 事件 | 状态与调度 |
| --- | --- |
| 目标未完成，正常结算 | active，统一边界安排一次继续 |
| agent_end 与宿主重试 | active，waiting_host；等最终结算，不叠加重试 |
| 重试耗尽，最终请求错误 | failed，保存错误并停止自动工作 |
| 手动 compact | 保留 active；压缩成功后恢复自动工作，等待宿主 idle；已有用户/job 等待继续保留 |
| 自动阈值/溢出 compact | 保留 active；willRetry 时由宿主恢复响应，否则由统一协调器调度 |
| compact 取消或失败 | 保留 active 与等待原因，保存可用错误，停止自动工作 |
| 宿主输入框 Esc | active、idle，停止自动续跑；新用户输入或 /goal resume 可恢复 |
| ask_user skipped | active，保持自动许可并继续本轮；保留已有答案，不作为整批确认或同意 |
| ask_user timed_out | active、running，自动答案作为推荐方案继续，不作为授权 |
| ask_user cancelled | active、waiting_user，结束宿主循环，停止自动工作 |
| goal_wait | active、waiting_jobs；外部唤醒或单次期限恢复工作 |
| 显式暂停/完成/预算耗尽 | 对应目标状态，取消继续请求与等待期限 |
| reload/new/resume/fork/tree | 撤销旧绑定，按当前分支记录重建目标与摘要 |
| /responses fork | 副本保留目标身份与进度，active 变为 paused，automatic=false，清除等待/期限；源目标不变，新会话等待用户输入或 /goal resume |

运行归属记录目标 ID、修订号和绑定代次；显式 resume 的控制代次保护较新恢复意图，不让旧响应 aborted 结算覆盖它；过期工具不能完成、阻塞或等待被修改或替换的目标。仅被接纳的运行注入 pi-suite-goal 系统提示节。Esc 后的其他扩展自定义运行不能恢复目标。预算只在显式配置时生效；message_end 累加宿主提供的 totalTokens，包括输入、输出与缓存用量。文本修改后同一目标的在途响应仍计入累计用量，但不能覆盖显式暂停等终态。

运行耗时使用 performance.now 单调时钟累计有效 running 片段；实时摘要加上当前片段，离开 running 时冻结。用户等待、后台等待、宿主恢复、暂停及应用离线时间不计入，恢复后接续累计。可见 TUI 运行时每秒通过同一 StatusPublisher 刷新，tick 不写会话、不发模型请求；离开 running 或撤销绑定时取消 interval。对已归属当前目标的进行中运行，resume 幂等保留 running，不排队新响应。宿主忙于其他响应、取消结算、压缩或重试时保存恢复意图，并在可用边界安排一次继续。自动继续使用 goal:<ID> 稳定请求 ID；与其他通知合并，已有宿主继续和待处理消息优先。界面详情不发起模型请求。

期限与完成反馈定时器在撤销绑定时取消，回调检查绑定代次和目标 ID。修改目标文本取消原目标的 job 等待；询问系统取消保留明确恢复要求。完成反馈 5 秒后清除摘要，持久目标及完成证据继续保留。

[返回目标管理](./index.md)

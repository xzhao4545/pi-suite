# job 记录、输入输出与手动控制

目标：统一查看运行中和已结束的 job，保留可分页的输入输出及时间信息，并允许用户明确停止指定 job。

当前状态：实施中；记录、日志、输入记录、列表与详情、停止证据及活动数量的基础实现通过两平台检查，见 [执行任务](../../../current/jobs/index.md)。/jobs 用户入口（筛选、翻页、详情、各通道读取、确认停止、清理已结算历史）与 PTY attach/detach 已实现；有界日志窗口、实时跟随、历史翻页和列表游标通过 Linux 检查，见 [日志查看基础阶段](../../../finished/pi-suite/jobs/log-viewer-core.md)。Linux 已验证自然退出后 monitor 处理期间 stop 保留退出结果，见 [升级控制基础阶段](../../../finished/pi-suite/jobs/runtime-control-core.md)；创建归属及 child/后代级联停止已接入 agents 并通过 Linux 检查。Windows 查看流程、停止竞争与级联组合尚待验证。

影响范围：JobManager、持久元数据、日志、工具适配入口、jobs 详情与平台停止后端。

约束：记录查看不重新启动进程；退出、停止请求和进程清理分开；PTY 输出不伪装为独立 stdout/stderr。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [x] 查询活动、已结束及全部 job，支持单项详情与列表分页
- [x] 保存命令、归属、开始/结束时间、耗时、退出信息和日志引用
- [x] 保存可查看的输入记录，区分 pipe 与 PTY 输出通道
- [x] 支持实时查看、历史分页、attach/detach 与明确停止（Windows 综合交互验收仍待实施）
- [x] Linux 验证停止竞争、重复停止、受管范围清理及历史只读边界
- [ ] Windows 综合复核停止竞争、重复停止、进程树清理及历史只读边界
- [x] 记录 child 创建归属，支持 subagent 停止时级联清理所属 job（Windows 综合验收待实施）
- [x] 用户确认后清理已结算且清理已确认的单项元数据与全部日志，拒绝活动或未确认对象
- [x] 将活动数量提供给共享状态栏发布器

## 验收方式

在 Windows 和 Linux 分别核对运行中、自然完成、失败、手动停止与超时记录；查询命令、输入、输出、运行时间和退出结果。验证大日志分页、中文边界、敏感输入标记、PTY 合并输出、清理未确认、重复 stop 和停止/自然退出竞争。停止 subagent 时，其本人及嵌套 child 创建的 job 一并停止，包括已 detach 或 child 已结束的 job；验证停止与启动竞争和创建归属。关闭详情、取消读取等待和 reload 不终止 job；已结束记录可继续读取，历史 PID 不作为停止目标。

## 关联计划

- [执行模式与后端](execution.md)
- [同进程保活](session-lifecycle.md)
- [活动数量状态](../status.md)
- [子代理停止边界](../../../finished/pi-suite/agents/runs.md)
- [输出读取](output.md)
- [统一工具设计](../../../finished/pi-suite/tool-design.md)

## 记录与历史查看

jobs 详情提供“活动 / 已结束 / 全部”筛选。默认按当前主会话可见集合展示，可主动切到当前 workspace 查看其他会话的记录；查看不改变 ownerSession、分支引用或通知目标。列表使用稳定 ID，查询某个 ID 时不因该记录已完成而隐藏。

每项记录包含：

| 信息 | 用途 |
| --- | --- |
| ID、名称、命令、cwd、mode | 识别启动了什么、在哪里执行及是否为 PTY |
| workspace、ownerSession、可选 taskId、创建 agentId/agentRunId 及父级执行链 | 关联会话、任务与创建归属，确定 subagent 级联停止范围 |
| createdAt、startedAt、endedAt、elapsedMs | 创建、开始、结束时间和实际运行耗时 |
| status、exitCode、signal、stopReason | 区分成功、失败、手动停止、超时与启动失败 |
| 输入/输出日志引用、可读取范围 | 分页查看执行记录 |
| 停止/清理状态及错误 | 区分请求停止与已确认结束 |

状态为 starting/running/stopping 或退出清理未结算的当前执行进入活动列表；completed/failed/stopped/timed_out 等已结算对象进入已结束列表。正常退出码为 0 才表示进程成功结束，停止不能显示为成功完成。没有可靠退出证据时保留真实状态，不虚构 exitCode。

elapsedMs 运行中随查询或可见详情刷新更新，结束后固定；不包含排队或开始前的时间。起止时间用于展示，当前进程内耗时使用单调计时并在结束时保存，避免系统时间调整造成负数或把 Pi 离线时间算作运行时间。未真正启动的失败记录不伪造运行耗时。

元数据与日志写入磁盘，列表默认只返回短摘要，打开详情才读取长命令或日志。完成对象从常驻面板收起，但历史不因折叠或通知已读被删除；第一版保留至用户主动清理。清理入口仅允许已结算且确认无活动执行的记录，并明确清理其历史与日志。当前执行协议可用的 `/jobs` 详情提供 `Clear history`，确认后通过同一 JobManager 和 JobStore 删除；清理等待结算、输入/事件写入与元数据保存，删除前复核磁盘状态，并撤销该 job 未送达的通知。执行协议受限的 owner 与只读 agents 历史不提供删除操作。

Pi 重新启动后仍可读取保存的记录和日志，但不因此获得原进程或 PTY 的控制权。没有确认结算的历史保持未确认标记，在全部列表或诊断中展示，不归入已知活动或成功完成；Pi 退出终止原任务与 PTY，不提供跨 Pi 进程重新 attach，见 [退出清理范围](../../../finished/pi-suite/jobs/exit-scope.md)。

## 输入与输出

- pipe：独立记录 stdout/stderr，保留命令与后续写入 stdin 的记录；程序输出不与用户输入混在同一文本通道。
- PTY：保存终端合并输出及实际发送的输入记录，支持实时终端与历史回看；PTY 通常无法可靠区分 stdout/stderr，界面和工具明确使用 output 通道。
- 输入记录标明发送时间、来源和发送内容；只表示“已发送”，不能当作程序已读取或执行的证明。PTY 的程序回显属于输出，不再重复计为一次用户输入。
- attach 中的输入和工具写入走同一输入入口。敏感输入可显式标记 sensitive，仅保留时间与已发送标记，输入通道不保存或返回正文；程序自行回显的内容仍按输出通道处理。
- 输出按采集顺序保存；跨 stdout/stderr 的时间顺序不承诺等同于程序内部写入顺序。历史输出使用安全文本或终端渲染，不直接执行其中的终端控制内容。

模型默认读取按 [输出读取](output.md) 的智能截断返回头部、尾部和中段关键行，可按偏移分页或搜索；完整详情支持滚动，只有用户停在底部时跟随新输出。模型按需读有限日志，不把每次完整输出注入上下文。日志文件按需读取、视图缓存保持有限；不因为内存尾部缓存淘汰就宣称原日志已被删除。

## 查询和控制入口

统一 manager 承担全部入口；工具名与共享参数按 [统一工具设计](../../../finished/pi-suite/tool-design.md)，上游旧工具不再注册。

| 入口 | 精简参数与返回 |
| --- | --- |
| job_list | id? 查询单项；否则 state? 为 active/finished/all，默认 active；scope? 为 session/workspace，默认 session；cursor?/limit? 用于列表分页；返回 ID、短标题、状态、mode、耗时和停止/清理摘要，不附整段日志 |
| job_read | id、stream?；pipe 默认 stdout，可选 stdout/stderr；PTY 默认 output；两种模式都可选 input，monitor 另有 events；offset?/limitBytes? 分页，默认读取为智能截断、上限 64 KiB；search?/context? 搜索；返回实际 offset、nextOffset、结束标记和可读范围 |
| job_write | id 与 input、keys 或 paste 之一；submit 追加回车；敏感输入按需指定 sensitive；已结束、已停止接收输入或用户接管中的对象明确报错 |
| wait | ids、mode?、timeoutMs?；等待 job 结算，超时或取消只结束等待；已返回的结算从通知队列撤销 |
| job_stop | id；明确请求停止指定执行，返回真实状态、是否提出停止请求和清理结果；重复调用合并正在处理的请求，不隐式重启或反复发送终止 |
| attach / detach（用户操作） | /jobs 详情或 job_start 的 attach；只连接或退出查看交互，不停止 job；已结束对象打开历史，不创建新 PTY |

id 查询直接返回详情；state/scope/cursor/limit 是列表参数，不能与 id 混用，混用返回 INVALID_ARGS。不存在或不支持的日志通道明确报错；指定 offset 时按原始字节读取并处理 UTF-8 边界。模型不需要手工计算进度、耗时或终态计数。

用户入口放在 jobs 详情：选择记录后查看状态、命令、输入、stdout/stderr 或 PTY 输出、时间和退出结果；活动对象可执行“停止”。关闭视图、detach、取消等待、compact/reload 不作为停止操作。

## 手动停止与关联对象

停止请求先进入 stopping，由平台后端停止受管进程及其受管后代、等待退出并结算日志。Linux 捕获受管根组及可追溯后代身份，覆盖另建进程组的工具；Windows 使用经验证的进程树停止能力；不能只杀 shell 而默认其工作负载已结束。仅在有相应证据时确认停止，仍有清理问题时明确显示 pending/unconfirmed。

同时发生自然退出和停止请求时按真实退出观测结算，停止原因单独保留；不能把请求发送成功当作退出确认。当前 manager 中已结算的完成、失败或已停止对象再次 stop 返回既有结果。只有历史记录但无当前 manager 控制句柄时拒绝停止，不凭历史 PID 操作可能已复用的进程。

停止 job 不删除历史，不自动把关联 task 标为 done，不停止其他 job 或主 agent。等待它的 subagent/goal 收到明确 stopped 结果，按用户要求处理后续工作；停止对象不由 manager 自动重启。

subagent 发起的 job 由运行上下文自动记录创建归属；停止该 subagent 时，AgentManager 调用同一 JobManager 停止它及所属后代创建的活动 job，不需要模型逐项调用 job_stop。job 归属与 task/agent 的展示引用分开，执行已 detach 或创建 child 已完成仍参与级联清理。关闭视图、会话切换和 reload 仅改变绑定，不触发该停止流程。

注册和启动 job 时检查创建执行是否已在停止，并先记录受管对象；若停止与启动同时发生，继续将该 job 纳入同一停止请求。停止返回 child/job 的真实结算信息，pending/unconfirmed 继续可查询，日志与历史保留。具体运行子树与执行标识规则见 [子代理停止边界](../../../finished/pi-suite/agents/runs.md)。

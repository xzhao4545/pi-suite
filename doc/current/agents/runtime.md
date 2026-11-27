# 执行与记录

`AgentManager`（`manager.ts`）持有本进程的全部 child 执行，每个 agentDir 一个，见 [进程注册与 reload](#进程注册与-reload)。

## ID 与记录

- agent ID（`agent_` 加 8 位十六进制）标识一个可恢复的 child 会话，恢复时不变。
- run ID（`run_` 加 8 位十六进制）标识一次执行。运行句柄、取消信号、父级引用、用量和并发槽位都属于 run（`Execution` 对象）。
- 同一 agent 同时只能有一个未结算的 run。该 agent 的停止操作尚未返回时，新的 run 返回 ALREADY_RUNNING。
- 通过 agent_send、@handle 或查看器发送消息可以恢复已结束的 child。workflow 也可续接自己的 child。网络或上游错误会触发 [自动恢复](#网络与上游错误自动恢复)。恢复生成新的 run；读取记录或打开 Transcript 不启动模型。

每个 run 的记录是 `AgentRecord`，以 custom entry `pi-suite:agent-record` 保存：

| 字段 | 内容 |
| --- | --- |
| id、runId、type、name | 名称为 agent_start 的 name，缺省为类型的 display_name 或类型名 |
| prompt、result、error | 本次输入、最后一条含非空文本的 assistant 消息（结构化输出时为验证后的 JSON）、错误 |
| state | 见 [状态](#状态) |
| cwd、configCwd | 实际工具目录；类型、资源与 workspace 归属使用的配置目录。RPC 可指定与 configCwd 不同的 cwd |
| ownerSessionId、anchorEntryId | 启动该 run 的主会话及当时的叶子 entry，决定顶级 child 在 session 范围的可见性；嵌套 child 按 parentRunId 匹配直接父级 |
| parentAgentId、parentRunId、ancestors | 嵌套 child 的直接父级与全部祖先 run ID |
| background | 是否后台执行 |
| createdAt、startedAt、endedAt、elapsedMs | elapsedMs 从实际开始计到清理结束、关闭会话之前，使用单调时钟，包含工具执行和等待父级回答，不含排队时间 |
| model、modelSource、thinking、thinkingSource、individual | 实际模型与来源；individual 是单个 agent 的覆盖，见 [模型配置](models.md) |
| usage、contextUsage | usage 是本次 run 的用量差值，规则见 [进度](progress.md#agent_get-与执行历史)；contextUsage 见下 |
| turns、toolUses、activity、lastUpdateAt | toolUses 统计本次 run 开始执行的工具调用，包含失败的调用 |
| sessionFile、endLeafId、persisted | 会话文件、结算时的叶子 entry、是否持久 |
| handle、alias | @handle 名称，见 [@handle 提及](operations.md#handle-提及) |
| taskId、taskGeneration | 分配的父级子任务及其代次 |
| scheduleId、workflowId、structuredJson | 调度来源、所属 workflow、结构化结果 |

`contextUsage` 为 `{tokens, contextWindow, percent}`，来自 SDK 的 `getContextUsage`。tokens 和 percent 为 null 表示未知（例如压缩后尚无新的用量）。runner 在工具开始、回合结束、用量与压缩 entry 写入时更新它；切换模型和关闭会话时保存最后一次快照。恢复产生的新 run 重新统计；历史记录没有快照时显示为不可用。

父会话只在记录的 state、background、sessionFile、endedAt、model、thinking 或 individual 变化时追加 entry；token 和计时变化不写入。child 会话关闭时在自己的会话文件中追加最终记录。

## 状态

| 状态 | 含义 | 计入活动 |
| --- | --- | --- |
| queued | 等待并发槽位 | 是（单独计数，不计入状态栏活动数量） |
| starting | 已离开队列，正在加载资源和建立会话 | 是 |
| running | 正在执行 | 是 |
| waiting | child 的 ask_user 正在等待父级回答（显示为 `waiting(parent)`） | 是 |
| stopping | 已请求停止，等待结算 | 是 |
| completed | 正常结束 | 否 |
| failed | 出错，或结算清理失败 | 否 |
| stopped | 被停止，或父级回答超时/取消 | 否 |
| limited | 回合数超过 maxTurns（0 或省略表示不限） | 否 |

## 队列与并发

顶级 child 进入一个共享队列。每次调度取队列中最早一个所在池有空位的 run，所以前台池满时不阻塞后台 run，各池内部保持先进先出。

| 池 | 上限 | 成员 |
| --- | --- | --- |
| background | `agents.maxConcurrent`，默认 10 | background 为 true 的顶级 run |
| foreground | `agents.maxConcurrentForeground`，默认 0（不限） | background 为 false 的顶级 run |
| 不占池 | — | 嵌套 child、workflow child、非后台的 RPC 分离运行 |

- 嵌套 child 不占池，避免父级等待 child 时互相占用槽位。workflow 自己控制并发。
- 调度触发的 run（`bypassQueue`）不等待空位，但仍计入其所在池的占用数。
- run 开始时记下所计入的池（`chargedPool`）。修改上限不改变已有 run 的计数；结算时释放该池的一个槽位。
- 停止排队中的 run 时，它直接移出队列并以 stopped 结算。

## 前台、后台与转后台

- 后台启动立即返回 ID，最终结果经统一通知送达，见 [结果通知](progress.md#结果通知)。
- 前台启动等待结果。以下情况提前返回：当前父级的任一直接 child 提问、用户插话（steer）、等待超过 1 小时。提前返回后，最终结果改由通知送达。
- 前台调用返回之前，父级按 Esc 会停止该 child 及其子树；提前返回之后 Esc 不再影响它。后台 child 不受 Esc 影响。
- 类型 frontmatter 的 run_in_background 优先于调用参数；调度触发的 run 总是后台。

转后台：在查看器按 `b`，把正在等待真实 agent_start 前台调用的顶级 run 转为后台：

1. 该 run 的池计数从 foreground 移到 background。后台池已满也允许转入；之后的排队按实际占用计算。
2. 前台调用立即返回，正文为 `Continuing in background; the result will be notified.`，details 带 `backgrounded: true`。
3. 父级之后的取消不再停止该 child，最终结果经统一通知送达。

queued、stopping、已结算、嵌套、workflow、RPC 和通过 agent_send 恢复的 run 没有等待中的前台调用，不能转后台。

## 网络与上游错误自动恢复

runner 在模型请求以错误结束（最后一条 assistant 消息的 stopReason 为 error）时抛出 `ModelRequestError`（`retry.ts`），带 provider 错误文本和 Pi 的 retry 设置（`getRetrySettings()`）。满足以下全部条件时，结算后为同一 agent 排入新的 run，而不是新开 agent：

- Pi retry 已启用；错误文本匹配网络、连接、超时、upstream、overloaded、429 或 5xx 等特征，且不含 quota、billing、balance、usage limit、insufficient、unauthorized、401、403；
- run 以 failed 结算，且结算清理和关闭会话都未失败；
- 不是 workflow child；未被停止或终止，manager 未关闭，该 agent 没有进行中的停止；嵌套 child 的直接父 run 仍活动且未关闭；
- 本次是第 attempt 次自动恢复，attempt 不超过 `retry.maxRetries`。

新 run 的规则：

1. 沿用原 run 已准入的父级范围、配置、类型、模型、thinking 及其来源和任务关联，结算与新 run 成为最新 run 之间不做 I/O。提示改为说明上次请求的错误，并要求从中断处继续、不重复已完成步骤。
2. 继承 background、结果通知标记、等待中的前台调用和尚未提交的消息。前台 agent_start 跟随最新的替代 run，Esc 停止的也是它。
3. 原 run 标为已消费，不发结算事件和结果通知；最终结果由最后一个 run 送达。
4. 新 run 以 queued 进入队列，延迟 `min(baseDelayMs × 2^(attempt−1), maxAgentDelayMs)` 后才可被调度；等待期间显示 `retry <attempt>/<maxRetries>`。停止排队中的重试会取消计时并以 stopped 结算。
5. 次数用尽时，最后一次失败的 error 末尾追加 ` · gave up after <n> automatic resumes`。agent_send（含引导、暂存和回答问题）与停止会清零该 run 的计数。

## 启动时捕获的内容

agent_start 在分配 run 之前捕获父级的 cwd、模型、模型目录、thinking、项目信任、系统提示和所属会话（ownerSessionId、anchorEntryId）。排队中的 run 和 workflow 的后续调用使用这些副本，不读取 /reload 已撤销的 ExtensionContext。

| 内容 | 何时读取 |
| --- | --- |
| 类型、模型、thinking | agent_start 时解析，排队期间不再解析 |
| 普通 child 的模块与工具配置（`run.config`） | 实际开始执行时从 configCwd 重新读取；资源加载和本包工具注册使用同一份 |
| workflow child | 沿用启动时的配置快照；续接（resume）沿用原类型、模型、thinking、schema 和工具 |
| 嵌套 child | 父 child 调用 agent_start 时从 configCwd 读取当前类型、模型和启用配置；父 child 自身已加载的工具与资源不变 |

普通 agent_send 恢复按 [模型配置](models.md#解析与来源) 重新解析模型。

## 进程注册与 reload

`runtime.ts` 通过 `owner.ts` 在进程全局槽位 `Symbol.for('pi-suite.agents.runtime.v1')` 中创建或复用 manager，按 agentDir 区分。槽位名称定义在 `registry.ts`。首次启动 child 时按顺序加载 `runner.ts` 和 `child.ts`。工具 renderer 查名称只读取已注册的 manager，按 id 和可选 runId 匹配，跳过 workflow child；找不到时显示原 ID，不创建 manager，也不读取历史文件。

会话切换和树导航只更换订阅。/reload 后如何替换或保留旧 manager 见 [会话和通知](../runtime/index.md#会话和通知)。以下任一情况使旧 manager 在 /reload 时保留：

- 有未结算的 run，或停止操作尚未返回；
- 有父级尚未看到的问题；
- 有尚未消费、需要通知的结果；
- 同一 agentDir 的 workflow manager 仍有工作。

旧 manager 忙碌时，新加载的代码在绑定时提示一次，并对以下操作返回 RUNTIME_UNAVAILABLE：agent_start（含 schedule 登记）、对已结束 agent 的 agent_send、调度触发、RPC spawn、新建或恢复执行的 @handle、查看器中会导致恢复的消息。调度触发的错误记入该次调度结果。查询、停止、引导运行中的 child、回答父级问题和接收结果仍可用。

## 停止与 job 清理

child 的 job_start 自动带上 creator（agentId、runId 和祖先 run ID；属于 workflow 时也带 workflow ID），模型不需要维护这份名单。停止时用这些 ID 调用 `JobManager.stopCreatedBy`，规则见 [agent 创建的 job](../jobs/index.md#agent-创建的-job)。传入的 run ID 会记入停止集合，停止期间才开始启动的 job 也会被拒绝。

agent_stop 的范围：

- 不指定 runId：该 agent 的全部 run 及其后代，以及它们创建的全部活动 job，包括已结束 run 留下的 job。
- 指定 runId：只含该 run 的子树。
- 不影响同级 agent 或主会话创建的 job。

停止流程（`AgentManager.stop`）：

1. 先登记本次停止的共享 Promise，同一范围的重复调用（包括回调中的同步重入）加入它。
2. 关闭这些 run 启动新 child 的能力，再统一改变全部目标的状态：排队目标移出队列并以 stopped 结算（elapsedMs 为 0），运行中目标改为 stopping。
3. 之后才触发 abort、事件和订阅回调，所以回调中的 configure/drain 不能启动已排队的后代。
4. 同时等待 job 清理和全部目标结算。job 清理失败时，仍等全部目标结算后再报告错误；之后再次 stop 可以重新清理。

返回值 `StopOutcome`：requested（有目标被取消或有 job 被停止）、state（该 run 的状态）、cleanup（任一 job 的清理为 pending/unconfirmed 时为 unconfirmed，否则 confirmed）、affected（各 run 与 job 的状态）。

run 自身结算时（`launch` 的 finally）：

1. 等待全部尚未结算的直接嵌套 child。仍在活动的 child 通过 stop 取消；已有终态、正在关闭会话或保存记录的 child 只等待其结算完成，保留原终态。
2. run 收到取消信号（包括停止或超过回合上限），或因父级回答未完成而终止时，清理它创建的 job。正常结束的 run 留下的 job 继续运行，可以用 agent_stop 或 Runs 页的 Cleanup jobs 清理。
3. 上述任一清理失败时，记录 `Execution cleanup failed: …`，状态为 failed。会话关闭失败记录 `Session finalization failed: …`，状态同样为 failed。
4. 最后释放槽位、发出结算事件，再通知订阅者。完成事件在订阅通知之前同步触发，RPC 的同步消费因此先于结果通知排队。

活动数量、父级 done 和结果通知都以这一步完成为准。

## 会话文件

| 情况 | 会话 |
| --- | --- |
| 顶级 child | 持久，`agents.persistSessions` 默认 true |
| 嵌套 child | 内存 |
| 类型设置 persist_session | 按类型设置 |
| @类型 的任务整理克隆 | 内存，不产生 child 记录 |

新建的持久 child 会话放在：

1. 类型设置了 session_dir 时，放在该目录（支持 `~`；相对路径按 child 的 cwd 解析）。
2. 否则放在直接父会话文件所在目录下的 `subagents/`；父文件已在 `subagents/` 中时直接使用该目录，嵌套不再加层。
3. 父会话在内存中时，放在 Pi 按 child cwd 计算的默认会话目录（`<agentDir>/sessions/<编码后的 cwd>/`）下的 `subagents/`。

PI_CODING_AGENT_SESSION_DIR 和 Pi settings 的 sessionDir 只影响主会话文件的位置，child 跟随主会话目录。普通启动、workflow、mention 和调度触发在新建持久 child 会话时使用 `session.ts` 的 `createChildSession`。恢复时复用保留的会话树，或打开记录中的 sessionFile。

Pi 1.5.0 的 `SessionManager.list` 只读取指定目录直接包含的 `.jsonl`，`listAll` 只读取 sessions 下一层目录，所以 `subagents/` 中的 child 不出现在 `/resume` 列表中。

结算时保存 endLeafId。读取磁盘上的 run transcript 时，若记录指定了叶子 ID，先验证叶子存在，再读取到该叶子为止的分支；叶子不存在时报 AGENT_HISTORY。读取历史不会把恢复后新增的消息归入原 run。

非持久会话在 [执行引用回收](#执行引用回收) 之前可以在同一 Pi 进程中读取和恢复；进程退出后只能使用持久会话。保存记录的状态仍是活动状态、但本进程没有对应 run 时，按 [持久历史](history.md#中断的运行) 处理。

## 任务关联

agent_start 的 taskId 指向直接父级任务清单中的一个子任务（如 `1.2`），必须同时传 taskGeneration：

1. 缺少 taskGeneration 时返回 TASK_GENERATION_REQUIRED。
2. 父级没有任务清单（tasks 模块关闭）时返回 TASK_SCOPE。
3. 该 ID 不是当前代次中的子任务时返回 NOT_FOUND。
4. run 创建后把 agent ID 写入该子任务的执行引用；写入失败返回 TASK_LINK_FAILED，此时 run 已启动。

嵌套 child 使用其直接父 child 自己的私有清单，而不是父 child 被分配的那个任务。恢复沿用记录中的 taskId 和 taskGeneration，代次过期返回 TASK_STALE，子任务不存在返回 NOT_FOUND。删除任务或清空清单不停止运行中的 child；child 结算也不修改任务状态。child 中的私有清单与 `scope:"assigned"` 规则见 [child 任务范围](../tasks/operations.md#child-任务范围)。

## 执行引用回收

AgentManager 每 60 秒检查一次已结算的 run。结束超过 10 分钟且没有被保留的 run，从内存执行表移入历史表：记录、结果、endLeafId、ancestors、handle/alias 和 job 的 creator 关系都保留；会话树、父级上下文、控制器和内存 transcript 被释放。SDK 会话本身在结算时已经关闭。

以下情况阻止回收：

- 结果尚未消费且需要通知：顶级 run 的结果一直保留到送达，主会话离开期间也一样；嵌套 run 只在其父 run 尚未结算时保留；顶层 workflow child 的结果由 workflow 宿主消费，不阻止回收。
- 查看器正在阅读该 run（`retain`），包括其中的消息输入、模型选择和 Jobs 往返。
- 运行中的 workflow 保留自己的 child，用于查看、续接和清理。

回收后，持久 transcript 仍按 sessionFile 和 endLeafId 读取并可恢复；非持久 transcript 返回 HISTORY_UNAVAILABLE，不能恢复。记录与结果仍可查询，遗留 job 仍按 run 和祖先 ID 清理。

[返回 agents](index.md)

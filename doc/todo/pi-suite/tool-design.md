# 统一工具设计规范

目标：ask、goal、tasks、jobs、agents 的模型工具使用同一套命名、参数、返回和错误约定，减少模型记忆多种风格的负担。

当前状态：实施中；ask_user 的 timeoutMs 与 goal 工具的 goalId、repeatedTurns、resumeAfterMs 已按本规范改名并通过检查；job_start/list/read/write/stop、共享 wait（含其他对象结算、child 提问与用户插话的提前返回）与 goal_wait 的 waitFor 已实现，见 [执行任务](../../current/jobs/index.md) 与 [目标接口](../../current/goal/operations.md)。task_list/task_edit 的两级查询与原子批次已接入，见 [任务接口](../../current/tasks/index.md)。共享对象 ID、列表分页、读取、停止结果与错误码已抽取到 src/runtime/tools.ts 与 src/runtime/errors.ts，agents 工具尚未实现。

影响范围：src 下各模块的工具注册、共享参数 schema、工具描述、doc/current 的接口文档及上游工具名映射。

约束：同一操作只注册一个工具，不保留上游旧名或旧参数别名；规范只约束模型工具，配置键、命令和快捷键按各自文档维护。

相关当前文档：[公共运行时与配置](../../current/runtime/index.md)、[目标接口与操作](../../current/goal/operations.md)。

## 任务列表

- [x] 把 goal 工具参数改为 camelCase（goalId、repeatedTurns、resumeAfterMs），ask_user 的 timeout 改为 timeoutMs
- [x] goal_wait 增加 waitFor，只在指定 job/agent 结算或期限到达时恢复目标
- [ ] 抽取共享 schema：对象 ID、列表筛选与分页、输出读取、等待和停止结果
- [ ] 按本规范注册 tasks、jobs、agents 工具与共享 wait
- [ ] 统一结果首行、details 结构与错误码
- [ ] 同步 doc/current 接口文档，删除旧名与旧参数描述

## 验收方式

逐个核对已注册工具的名称、参数、默认值和返回结构；相同含义的参数在各模块名称、单位、默认值与互斥规则一致。上游旧工具名不再注册。离线 SDK 检查覆盖共享 schema 的边界：id 与列表参数互斥、分页游标、读取偏移与搜索、等待超时、重复停止。

## 关联计划

- [上游导入方式](upstream-import.md)
- [jobs 输出读取](jobs/output.md)
- [agents 主从交互](agents/interaction.md)
- [两级任务管理](tasks.md)
- [目标状态与续跑](goal.md)

## 命名

工具名为 `<模块>_<动词>`，使用 snake_case。ask_user 保持原名；跨 jobs 与 agents 的等待使用不带前缀的 `wait`。

| 动词 | 含义 | 使用模块 |
| --- | --- | --- |
| start | 创建并启动执行对象 | job、agent |
| list | 列表或按 id 查看单项摘要，不返回长文本 | task、job、agent |
| read | 分页读取长文本：日志、输出、transcript、结果 | job、agent |
| write | 向执行中的程序发送输入 | job |
| send | 向 agent 发送消息：回答提问、引导运行或恢复会话 | agent |
| stop | 明确停止执行，返回真实结算 | job、agent |
| edit | 批量增删改 | task |
| complete / blocked / wait | 目标控制 | goal |
| workflow | 启动编排脚本 | agent |

参数使用 camelCase。时间参数以 Ms 结尾，单位毫秒；字节参数以 Bytes 结尾。布尔参数使用正向名称，例如 includeDone、background。配置文件的键（如 ask.timeout）不在本规范范围内。

## 对象 ID

| 对象 | 格式 | 说明 |
| --- | --- | --- |
| job | job_ + 8 位小写十六进制 | 同一 agentDir 内唯一 |
| agent | agent_ + 8 位小写十六进制 | 稳定引用可恢复的 agent 会话 |
| agent 执行 | run_ + 8 位小写十六进制 | 一次执行；按需指定，默认当前或最近执行 |
| task | 清单内递增数字字符串 | 删除后不复用 |
| goal | UUID | 来自当前目标契约，运行归属校验 |

wait 通过前缀区分 job 与 agent，不需要额外类型字段。agent 的 name 是便于用户 @提及 的句柄；工具的 id 参数同时接受 agent ID 或唯一 name，name 不唯一时报错并列出候选 ID。

## 共享参数

| 参数 | 类型与默认 | 规则 |
| --- | --- | --- |
| id | 字符串 | 查看单项；与 state、scope、cursor、limit 互斥 |
| ids | 字符串数组，1–50 | 仅 wait 使用 |
| state | active、finished、all，agent 另有 queued；默认 active | 列表筛选 |
| scope | session、workspace；默认 session | session 为当前主会话可见集合，与状态栏计数同一口径 |
| cursor / limit | limit 默认 20，最大 100 | 返回 nextCursor；按创建时间倒序，稳定排序 |
| offset / limitBytes | limitBytes 默认 16384，最大 65536 | 按原始字节分页并处理 UTF-8 边界 |
| search / context | search 为正则，可写 /re/flags；context 默认 2，最大 20 | 返回匹配行及前后行 |
| timeoutMs | 各工具注明默认与上限 | 只结束等待或询问，不停止执行对象 |

冲突参数明确报错，不按隐式优先级取舍。所有列表只返回短摘要；长命令、日志、transcript 和结果正文只经 read 读取。

## 返回

文本结果第一行固定为对象摘要，例如：

```text
job_3fa1c2d0 completed · exit 0 · 12.4s · pipe
agent_9b21e4aa waiting(parent) · 3 turns · 41s · 待答 1 题
```

其后是必要的补充行，最后一行给出可执行的后续入口，例如 `read: job_read({"id":"job_3fa1c2d0","stream":"stderr"})`。details 携带同一信息的结构化版本。

状态取值在 jobs 与 agents 间一致：

| 状态 | 含义 | 是否计入活动数量 |
| --- | --- | --- |
| queued | 等待并发槽位，尚未开始 | 否，详情单独显示 |
| starting / running | 启动中、运行中 | 是 |
| waiting | 已开始，等待 user、parent、job 或 host；附 waitingFor | 是 |
| stopping | 已请求停止，等待退出与清理结算 | 是 |
| completed / failed / stopped / timed_out | 已结算 | 否；清理 pending/unconfirmed 时仍计入活动 |

stop 统一返回 `{ requested, state, cleanup, affected[] }`。affected 列出级联涉及的 child 与 job 及各自真实状态；存在 pending/unconfirmed 时摘要行明确写出，不报告“全部停止”。

read 统一返回 `{ text, stream, offset, nextOffset, totalBytes, endOfStream, truncated?, matches? }`。默认读取的截断方式见 [jobs 输出读取](jobs/output.md)，agent_read 使用同一规则。

错误使用稳定代码并在消息中指出可用的下一步：INVALID_ARGS、NOT_FOUND、AMBIGUOUS_NAME、HISTORY_READ_ONLY（只有历史，无当前控制句柄）、NOT_RUNNING、USER_CONTROL（用户接管终端中）、STALE_BINDING、CLOSING、UNSUPPORTED_STREAM。

## 工具清单

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| ask_user | question 或 questions、options、allowMultiple、allowFreeform、defaultAnswer、defaultOptionId(s)、allowComment、timeoutMs | 仅改名 timeout→timeoutMs；在 child 会话中转交父 agent，见 [主从交互](agents/interaction.md) |
| goal_complete | goalId、summary | |
| goal_blocked | goalId、reason、evidence、repeatedTurns | |
| goal_wait | goalId、reason、waitFor?、resumeAfterMs? | waitFor 为 job/agent ID 数组；省略时等待任一已安排的外部事件 |
| task_list | id?、parentId?、includeDone?、detail? | 见 [两级任务管理](tasks.md) |
| task_edit | changes[] | 批量增删改 |
| job_start | command 或 agent、mode?、name?、cwd?、timeoutMs?、taskId?、attach?、monitor?、handsFree? | 见 [执行任务管理](jobs/execution.md) 与 [监视与委派](jobs/monitors.md) |
| job_list | id? 或 state?、scope?、cursor?、limit? | |
| job_read | id、stream?、offset?、limitBytes?、search?、context? | stream：stdout、stderr、output、input、events |
| job_write | id、input?、keys?、paste?、submit?、sensitive? | input/keys/paste 三选一 |
| job_stop | id | |
| agent_start | prompt、description、type?、name?、model?、thinking?、maxTurns?、background?、inheritContext?、taskId?、schedule? | background 默认 true；false 时等待结果，child 提问时提前返回。model/thinking 优先于 TUI 类型配置与 frontmatter，见 [模型与 thinking 配置](agents/models.md) |
| agent_list | id? 或 state?、scope?、cursor?、limit? | id 时返回进度详情 |
| agent_read | id、runId?、stream?、offset?、limitBytes?、search?、context? | stream 为 result 或 transcript |
| agent_send | id、message | 按 agent 状态回答提问、引导运行或恢复会话，返回实际 action |
| agent_stop | id、runId? | 级联停止嵌套 child 及所属 job |
| agent_workflow | script? 或 scriptPath? 或 name?、args?、resumeFromRunId? | 见 [agents 扩展能力](agents/extensions.md) |
| wait | ids、mode?、timeoutMs? | 见下节 |

attach/detach、详情查看、停止确认与清理历史属于用户操作，经 /jobs、/agents 界面和快捷键完成，不注册为模型工具。job_start 的 attach 只在需要用户直接操作程序时立即打开终端视图。

## 共享 wait

| 参数 | 规则 |
| --- | --- |
| ids | 1–50 个 job/agent ID，去重 |
| mode | any 或 all，默认 all |
| timeoutMs | 默认 300000，最大 3600000；更长等待使用 goal_wait 或结束本轮等待通知 |

返回每个 ID 的当前状态、已结算对象的结果摘要（退出码、耗时、结果首段）、pending 列表、timedOut 与返回原因 reason。超时、取消或 Esc 只结束等待，不停止执行对象。job 与 agent 共用这一个 wait，一次调用可混合两类 ID。

wait 是一次阻塞的工具调用，结束条件如下（参照 omp：任一后台结果、消息或用户插话都结束等待；不同处是本包保留 ids 与 mode）：

| 事件 | 处理 | reason |
| --- | --- | --- |
| ids 按 mode 满足（any 任一结算，all 全部结算） | 返回 | condition |
| 当前会话可见的其他 job/agent 结算（不在 ids 中） | 提前返回，结果列在 also 下，pending 列出仍未结算的 ids | other |
| 当前会话任一直接 child 提问，无论是否在 ids 中 | 立即返回该问题，mode 为 all 时同样返回，避免主 agent 等待一个正在等它回答的 child | question |
| 当前会话可见 job 的 monitor 事件或 hands-free 更新，包括 ids 中 job 自己的 | 提前返回，事件摘要列在 also 下并撤销其通知；event/update 分别记录对应编号，job 的结算仍按 ids 判断 | event |
| 用户在等待期间发送插话（steer） | 提前返回，Pi 随后处理该消息；等待开始前已排队未处理的插话使 wait 立即返回 | user |
| 期限到达 | 返回 | timeout |

- mode 为 all 时，ids 中部分对象结算不算返回条件，按 all 继续等待。
- 可见范围与结算通知相同：属于当前会话、启动位置在当前分支上；Esc 后转为下一轮送达的结果不再参与。
- follow-up 消息与本包自己的通知不打断 wait；follow-up 本来就在本轮结束后才处理。
- wait 已返回的结算结果、monitor 事件与 hands-free 更新（包括 also 下的）从统一通知队列撤销，避免同一结果再唤醒一次；已返回的问题不再重复返回。
- 没有 goal 时，后台对象结算后由统一通知在宿主 idle 时请求一次继续；有 goal 时按目标的自动工作许可调度。

## 上游工具映射

| 上游 | 本包 |
| --- | --- |
| Agent | agent_start；resume 改由 agent_send |
| get_subagent_result | agent_list(id) 查看状态；agent_read 读取结果；wait 等待 |
| steer_subagent | agent_send |
| SubagentWorkflow | agent_workflow |
| interactive_shell | job_start(mode pty)、job_list、job_read、job_write、job_stop；attach 与 background 归用户界面 |
| background_job_start/status/logs/wait/stop | job_start(mode pipe)、job_list、job_read、wait、job_stop |
| TaskCreate/TaskUpdate | task_edit |
| TaskList/TaskGet | task_list |
| TaskOutput/TaskStop/TaskExecute | agent_read/wait、agent_stop、agent_start(taskId) |
| goal_id、repeated_turns、resume_after_ms | goalId、repeatedTurns、resumeAfterMs |

[返回扩展包待办索引](index.md)

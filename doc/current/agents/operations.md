# 工具与操作

| 入口 | 当前行为 |
| --- | --- |
| agent_start | prompt、type?、name?、background?、model?、thinking?、maxTurns?、taskId?、inheritContext?、isolated?、schedule?；普通执行 background 默认 true，类型 run_in_background 优先；schedule 登记未来后台任务 |
| agent_list | id 查进度详情、全部已知 run 及其所属活动 jobs，字段见 [进度与通知](progress.md)；列表 state 为 active/queued/finished/all，默认 active；scope 为 session/workspace，默认 session；cursor/limit 分页，默认 20、最多 100 |
| agent_read | id、runId?；活动默认 transcript，结束默认 result；offset/limitBytes/search/context 使用 [共享读取规则](../jobs/index.md) |
| agent_send | id、message；返回 answered、steered、queued 或 resumed，只有直接父级可以发送；停止/清理尚未结束时不能恢复为新 run |
| agent_stop | id、runId?；取消运行子树及其创建的活动 job，返回真实状态和 cleanup |
| agent_workflow | script、scriptPath 或 name 三选一，args?、resumeFromRunId?；始终后台启动，返回 wf_ ID 与保存路径，见 [Workflow 操作](workflow/operations.md) |
| wait | 接受 job、agent 与 workflow ID 的 any/all 等待；结果、问题与其他事件使用统一返回结构，超时或取消只结束调用；同 agent 的旧未读 run 作为其他执行返回 |

模型工具默认返回摘要，完整输入、thinking、工具调用和输出通过 agent_read 或原生 transcript 按需读取。workspace 列表发现当前配置工作区的持久历史并合并本进程记录；session 列表与状态数量使用同一直接子级和分支归属过滤。未知 ID 的 agent_list/read/send/stop 先发现并核对当前配置工作区，发送仍需直接父级与分支准入；分页 more 保留 scope。实际目录与引用范围、读取和合并规则见 [持久历史](history.md)。

## /agents

`/agents` 选择 active、queued、finished 或 all；也可使用 `/agents all` 等直接指定筛选。选择一条 run 后可查看 Transcript、通过 Jobs 查看该 run 子树创建的活动 job、修改该 agent 的 Model / thinking，或选择“Stop child, nested agents and jobs”停止该运行范围。Types · enable / model / thinking 和 `/agents types` 显示全部类型，包括 disabled 类型；Enable、Disable、Use definition 与 Model / thinking 配置类型，写回位置和作用范围见 [类型配置](models.md)。

Workspace records 或 `/agents workspace [active|queued|finished|all]` 查看当前配置工作区的完整记录，默认 all；列表发现保存于默认/当前配置目录及可达引用的其他主会话、分支和 child 历史，按 runId 保持原生选择身份。其他 owner 或当前分支之外的已结算记录提供 Transcript 和只读 Jobs，详情隐藏 Message、Model / thinking、Background 和 Stop subtree，仍可阅读及展开 Tools/Thinking。当前 owner/分支可见的结束记录保留模型覆盖与记录菜单的遗留 job 清理；真实运行句柄沿用既有控制。浏览不切换主会话、不转移归属或通知，发现到的中断运行显示 failed。

Scheduled agents 与 `/agents schedules` 查看当前会话的调度，选择一项后可确认取消；创建使用 agent_start 的 schedule，规则、开关、时间与已触发运行的控制见 [定时调度](schedules.md)。

Workflows 与 `/agents workflows` 查看当前会话与分支的编排、保存资源、阶段、日志和结果，提供暂停/恢复/停止、child 会话和 gate 日志、跳过/重试与 journal 重放；控制条件、开关和按键见 [Workflow 操作](workflow/operations.md)。

查看器复用共享 Transcript 与 DetailsView；Markdown、thinking、工具调用/结果由 Pi 原生组件渲染，使用所选 child 的实际工作目录。工具优先使用对应 child 的渲染定义，持久历史缺少定义时使用 Pi 标准渲染；调用、流式部分输出和最终结果按 toolCallId 配对。稳定消息缓存组件及宽度渲染，每条变化的流式消息和工具部分输出随事件更新；在底部时跟随，向上阅读保留位置。

- ↑↓、PageUp/PageDown、Home/End 滚动；鼠标滚轮滚动。
- `/` 搜索；n/N 查下一个/上一个；搜索内 Esc 退出搜索。
- ←→ 选择当前可用的 Message、Tools、Thinking、Jobs、Model / thinking、Background、Stop subtree 或 Back；Enter 执行动作；Esc 返回。
- 可接收消息的运行默认选中 Message，Enter 打开输入。提交后按 agent_send 返回 answered、steered 或 queued；空输入或取消返回阅读。输入结束时重新检查所选 run，已结束、结算中或同一 agent 的旧 run 不发送，也不隐式恢复。
- x 按两次停止所选 run 及其嵌套 child/所属 job；第一次提示“再按 x 停止”，其他按键取消确认。已结束或结算中的 run 隐藏快捷停止；从操作栏选中 Stop subtree 后 Enter 同样进入确认。
- b 将正在等待真实 agent_start 前台调用返回的顶级普通运行转为后台，立即释放前台调用；排队、停止中、已结束、嵌套、workflow、RPC 和普通恢复运行不提供此操作。后台池已满时仍可转入，后续启动继续按池上限排队。转入后父级 Esc 不停止该 child，最终结果通过统一通知送达。

Message 输入、Model / thinking 选择与 Jobs 在关闭当前详情后打开，返回后保留滚动、搜索和展开状态。搜索框和输入框拥有文字按键，输入 x 或 b 只输入文字。普通消息限当前主会话的直接 child；workflow 查看器只允许回答当前可见且已挂起的问题，普通引导与恢复由 workflow 控制。

记录菜单和 Transcript 的 Jobs 按所选 run 子树查询所属活动 job；选择 job 后复用 [jobs 操作界面](../jobs/index.md#用户操作)，使用该 job 的 cwd，允许详情、各日志通道和单独停止。只读历史隐藏 attach、stop 与 Clear history，仍可阅读详情和日志；返回所属列表时刷新活动集合并保留选择 ID。没有所属活动 job 时明确提示，退出 Jobs 不停止 agent。

进入查看器持有公共通知阻塞令牌；关闭后恢复通知投递，主会话保持原绑定。关闭查看器只结束阅读。

打开会话及其消息输入、模型选择、Jobs 往返期间保留其内存 transcript，阅读期间不会回收。关闭后，结束超过 10 分钟的内存对话内容可以释放，记录、结果与持久会话仍保留；非持久 transcript 释放后不可阅读或恢复，边界见 [执行引用回收](runtime.md#执行引用回收)。

## @handle 提及

TUI 输入 `@explore 消息` 或 `@agent-explore 消息` 可以发送给 Explore 实例；正在执行时引导，排队/创建期间暂存，等待父级回答时作为回答，结束后沿用其会话恢复。直接父级和分支归属与 agent_send 相同。停止中的运行报告不可发送。

顶级 agent 的 handle 从类型名生成小写字母、数字、下划线与短横线标识；同一 owner 会话中重名分配 `-2`、`-3` 后缀。agent_start 的 name 同时生成 alias，与 handle 共用名称空间；补全显示 alias，两种名称均可投递。handle/alias 保存在 run 记录中，恢复保持不变；嵌套 child 使用父级工具操作。

尚无实例的类型使用当前分支、系统提示、模型与 thinking 的内存克隆生成任务。克隆只允许一次 agent_start，使用真实父级的注册工具与归属；其推理和工具调用留在内存克隆中。类型 frontmatter 仍决定执行选项，结果通过统一通知送达，包括选择前台执行的类型。克隆无法启动时明确报错；会话切换、树导航、reload 与 shutdown 取消未完成克隆。

输入框在 `@` 后提供活动实例、结束实例与启用类型的前缀补全，并保留 Pi 的文件与命令补全。补全使用绑定/投递时发现的类型快照，实例状态从 Manager 动态读取；发送时重新发现类型。`@main 消息` 将消息交给主会话并保留附件。裸 handle、文件路径、普通文本中的提及、未知名称和带图片的 agent 提及走主会话输入；print/RPC 与扩展提交的文本采用宿主原有输入流程。agents.mentions 默认 true，设为 false 关闭此入口与 agent 补全。

## 父级回答

child ask_user 使用共享 schema 与 response/details，工具挂起期间为 waiting(parent)。问题只交给直接父级，包含选项 ID、标题和 agent_send 提示；顶级通过统一 Notifications，嵌套通过父 child 的通知边界/共享等待返回。提问与结果请求分别使用 `agent:<agentId>:<runId>:ask`、`agent:<agentId>:<runId>:result`，消费或撤销限定该次 run，恢复后的新执行保留自己的通知。顶层 workflow child 的问题也交给所属主会话，可用 agent_send 回答；普通引导与恢复由 workflow 控制。

message 与选项 ID/标题精确匹配时返回 selection，否则在 allowFreeform=true 时返回 freeform。多选可发送 JSON 字符串数组；批量问题发送对应题数的 JSON 数组，每题元素为文本或选择数组。返回标记 source=parent，不能把父级回答声称为用户直接授权。期限默认使用 ask.timeout，timeoutMs=0 无期限；超时和取消保留非回答状态，并使 child 以 stopped 结算。

## 类型与模型

类型依次加载 Pi 包声明、用户 `<agentDir>/agents`、项目 `.agents/agents`、项目 `.pi/agents`；后加载的同名类型覆盖前者，项目目录与项目包只在父级已信任时参与。精确名称优先，大小写匹配必须唯一；agents.types 中规范类型名的 enabled 覆盖 frontmatter 与默认 true，最终 false 禁止新准入。支持 name、display_name、description、color、tools、disallowedTools/disallowed_tools、model、thinking、max_turns、persist_session、session_dir、allowed_subagents、prompt_mode、extensions/exclude_extensions、skills、inherit_context、run_in_background、isolated、memory 和 enabled。正文为系统提示词；allowed_subagents 默认不开放嵌套，可为 all 或类型名单。字段、包与资源操作见 [类型与资源](resources.md)。

模型与 thinking 分别按调用参数、该 agent 的 individual、agents.types 的对应字段、frontmatter、agents.defaultModel（仅模型）、父级当前值解析。配置逐类型逐字段合并；显式 provider/modelId 在认证目录中不可用时报错指出来源，不跨 Provider 替换；调用参数和 frontmatter 的模糊名仅在匹配唯一时接受。实际 thinking 由 Pi 按模型能力收紧。单独修改从下一次请求生效，结束后的修改用于恢复，详细规则见 [模型配置](models.md)。

外部扩展使用 [跨扩展 RPC](rpc.md) 启动、停止、引导和消费当前会话的顶级结果。指定目标工作目录的 agent 仍按父级工作区显示在 agent_list 和 /agents 中，文件工具使用记录中的实际 cwd。

[返回 agents](index.md)

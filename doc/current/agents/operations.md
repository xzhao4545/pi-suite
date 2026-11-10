# 工具与操作

| 入口 | 当前行为 |
| --- | --- |
| agent_start | prompt、type?、name?、background?、model?、thinking?、maxTurns?、taskId?、inheritContext?、isolated?、schedule?；普通执行 background 默认 true，类型 run_in_background 优先；schedule 登记未来后台任务 |
| agent_list | state 为 active/queued/finished/all，默认 active；scope 为 session/workspace，默认 session；agentId 可组合筛选某 agent 的执行历史；cursor/limit 分页，默认 10、最多 100、约 4 KiB，返回准确 runId |
| agent_get | id、runId?、detail?；查看指定或当前 run 的状态、活动、模型/thinking 和任务，保留完整待答问题；detail:true 增加来源、上下文、用量及所属活动 jobs，字段见 [进度与通知](progress.md) |
| agent_read | id、runId?；活动默认 transcript，结束默认 result；offset/limitBytes/search/context 使用 [共享读取规则](../jobs/index.md) |
| agent_send | id、message；返回 answered、steered、queued 或 resumed，只有直接父级可以发送；停止/清理尚未结束时不能恢复为新 run |
| agent_stop | id、runId?；取消运行子树及其创建的活动 job，返回真实状态和 cleanup |
| agent_workflow | script、scriptPath 或 name 三选一，args?、resumeFromRunId?；始终后台启动，返回 wf_ ID 与保存路径，见 [Workflow 操作](workflow/operations.md) |
| wait | 接受 job、agent 与 workflow ID 的 any/all 等待；结果、问题与其他事件使用统一返回结构，超时或取消只结束调用；同 agent 的旧未读 run 作为其他执行返回 |

模型工具默认返回摘要，完整输入、thinking、工具调用和输出通过 agent_read 或原生 transcript 按需读取。workspace 列表发现当前配置工作区的持久历史并合并本进程记录；session 列表与状态数量使用同一直接子级和分支归属过滤。未知 ID 的 agent_get/read/send/stop 先发现并核对当前配置工作区，发送仍需直接父级与分支准入；分页 more 保留 scope。实际目录与引用范围、读取和合并规则见 [持久历史](history.md)。

工具默认折叠为一行，普通 subagent 以名称为主标识（AgentRecord.name，默认类型 displayName/name），ID 只在展开或 dim 元信息中显示；只有 ID 的调用按进程级 Manager 内存记录查名，可带 runId，未找到时显示 ID，展示不读取磁盘或创建运行时。start 区分后台状态、前台时长、转后台与调度，list 显示数量/范围，get 显示状态或待答问题，read 显示流与字节区间，send 显示真实 action，stop 显示结算/清理与级联数量，并在 details 保存名称供历史回放。展开以名称开头，保留完整 prompt、model/thinking、用量、模型返回摘要、待答问题和本页正文；list 逐项显示名称与状态，ID/runId 为 dim 信息。wait 折叠保留结算比例，展开的普通 agent 摘要与 pending 按内存记录显示名称，未知记录保留 ID；模型正文与通知仍使用 agent_/run_ ID，read/send 参数不改写。taskId 使用 `1.2` 形式的直接父级子任务 ID；child 默认维护私有清单，对分配任务须显式使用 task_get/task_edit 的 `scope:"assigned"`，只允许读取或 start/done/block/unblock，默认 local 下的同名 ID 不指向父级。所有结果使用公共 renderer，主会话工具结果点击切换单项，默认 Ctrl+O 切换全部，错误完整显示；child Transcript 使用实际 run.renderers。

## Dock 键盘进入

Agents 行直接显示主 agent 设置的名称（未设置时使用类型 displayName/name），右侧为 `状态 · 运行时间 · ↑输入 token ↓输出 token · N tools`；先截短名称，再依次省略 token、工具次数，状态优先保留，待父级回答显示 `waiting(parent)`。标题右侧按本分区实际对象状态显示数量，例如 `2 running · 1 queued`，不重复活动摘要行；运行指标随订阅与每秒展示刷新更新，不产生额外会话记录。ID 保留在查看器详情与模型工具正文中。

主会话空编辑器按 ← 进入底部 Dock，↑↓ 选择实际 task、agent、workflow 或 job 行，`[`/`]` 循环切换可选分区，Enter 打开所选 agent 的现有 Transcript 或 workflow 运行详情；Esc 或 → 返回编辑器，其他按键退出选择并交给编辑器。非空编辑器、补全、询问及其他界面不拦截 ←；Tasks 以只读详情参与选择，活动数量摘要不参与。打开后退出 Dock 选择，关闭查看器可再按 ← 进入，保留同一会话绑定内的对象身份；未激活 Dock 选择时优先展开可见 Tasks；按 ← 激活后优先保证所选 agent/workflow/job 可见，Esc/→ 返回编辑器后恢复默认展开策略并保留稳定对象身份。完整历史仍从 `/subagents` 进入。

## /subagents

`/subagents [queued|finished|all|types|schedules|workflows]` 直接打开对应页或筛选；不带参数每次打开 Runs 的 All 记录。顶部标题为 `Subagents ▸ <页名>`，页面标签为 Runs、Types，以及启用时的 Schedules、Workflows；标签按可见顺序编号，数字键或 `[`/`]` 一次切页，不进入 Tab 焦点环。Runs 的 Scope 按 `w` 循环选择 This session 或 Workspace，State 按 `s` 循环选择 All、Queued、Finished 并显示该范围内的数量；Queued 单独计数，Finished 为非活动记录。活动中的 starting/running/waiting/stopping/queued 排在最前，内部按最近更新时间（无则启动或创建时间）倒序；其余按 endedAt（无则最近更新、启动或创建时间）倒序。模型工具 agent_list 的筛选参数与默认值见上表。列表仅包含 run，不含导航或筛选菜单项。

Enter 直接打开所选 run 的 Transcript，排队记录打开 Task details。底部固定导航与动作两行，空列表也列出当前页的全部导航控件；列表为空时正文和动作行显示下一步提示，如 `No queued runs · press s for All (10)`。标题区、列表与底部使用分隔线区分，状态信息位于标题区，样式见 [统一界面配色角色](../ui/index.md#浏览器配色角色)。底部动作行按所选 run 提供 `m message`、`j jobs`、`c model / thinking`、`b background`、`x stop subtree` 或 `x cancel queued`；结束记录存在所属活动 job 时提供 `x cleanup jobs`。Jobs 查看该 run 子树创建的活动 job，Model / thinking 修改所选 run 的覆盖值，从它下一次请求生效；停止和清理按 run 范围执行并保留二次确认。

Types 和 `/subagents types` 显示全部类型，包括 disabled 类型；行内以 ●/○ 标识启用/禁用，并显示模型名称与实际思考强度；来源为 inherited 的字段显示 `not configured`，详情说明执行启动时继承父级当前值，长名称截断时保留状态和思考强度。右侧显示说明、完整模型身份、模型/思考来源、定义路径、字段写入位置、类型参数与系统提示。Enter 或 `c` 打开 Model / thinking，修改类型默认值，只作用于之后新建的执行；底部 `d` 按当前状态执行 Enable 或 Disable，存在 enabled 配置覆盖时提供 `u Use definition`。写回位置和作用范围见 [类型配置](models.md)。

列表先按 `/` 进入过滤后输入文字，检索 ID/runId、名称、类型、状态、模型与 prompt；按当前范围的完整记录筛选，↑↓ 和 PgUp/PgDn 选择。初始焦点在列表，直接输入字符不会过滤；仅保留列表、详情、过滤三个焦点。Tab 从列表进入详情、再次 Tab 或 Esc 返回列表；活动区域标题用 `▸`、accent、粗体和 accent 横线强调，非活动标题为 muted，离开列表时只移除选中背景，保留状态与正文语法颜色。过滤、搜索和消息输入也有独立输入焦点标记及原生光标；焦点由键盘操作切换，不保证阅读 overlay 的嵌套鼠标焦点映射。过滤内 Enter/Tab 保留查询并回到列表，Esc 清空并退出过滤。控件按键直接循环并应用选项，底部动作仅按对应键执行，没有可选中的操作条；详情焦点使用阅读和搜索按键。状态行显示当前页、范围、状态、文本查询、匹配数/范围总数和选中名称/ID，窄屏优先保留当前页与选中对象。Shift+Tab 留给 Pi 的全局思考强度切换；页面动作使用无修饰的字母键，与宿主 Ctrl/Alt 快捷键独立。宽屏右侧显示所选 run 的模型/思考强度及来源、上下文占用与模型窗口、工具调用次数、运行时间和任务说明，窄屏改为上下布局。列表行保留状态与时长，Queued 显示排队时长，已启动记录显示运行时长。Esc 先离开详情焦点或清空筛选，再退出列表；页面、状态/范围切换及从操作返回保留筛选、runId 和各项阅读位置。顶部切换控件保持可达，空结果明确显示。运行统计取所选 run 的 Manager 快照，历史未知上下文显示不可用；统计口径见 [执行与记录](runtime.md)。

Runs 的 Scope → Workspace 或 `/subagents workspace [queued|finished|all]` 查看当前配置工作区的完整记录；workspace 命令默认 all，界面切换范围保留当前状态筛选。列表发现保存于默认/当前配置目录及可达引用的其他主会话、分支和 child 历史，按 runId 保持原生选择身份。其他 owner 或当前分支之外的已结算记录标记 Read only，提供 Transcript 和只读 Jobs，隐藏 Message、Model / thinking、Background、停止与清理，仍可阅读及展开 Tools/Thinking。当前 owner/分支可见的结束记录保留模型覆盖与遗留 job 清理；真实运行句柄沿用既有控制。浏览不切换主会话、不转移归属或通知，发现到的中断运行显示 failed。

Schedules 与 `/subagents schedules` 查看当前会话的调度，右侧显示详情，Enter 打开完整详情，底部 `x Cancel schedule` 确认后取消；创建使用 agent_start 的 schedule，规则、开关、时间与已触发运行的控制见 [定时调度](schedules.md)。

Workflows 与 `/subagents workflows` 查看当前会话与分支的编排、保存资源、阶段、日志和结果；顶部 `s` 一次切换 Runs/Saved，右侧显示运行进度或保存脚本。Enter 打开运行详情或源码，底部按状态提供 `p` 暂停/恢复、`x` 两次停止和 `r` journal 重放，保存资源提供 `n Start`。child 会话、gate 日志和跳过/重试在运行详情操作；控制条件、开关和按键见 [Workflow 操作](workflow/operations.md)。

查看器复用共享 Transcript、DetailsView 和阅读 overlay；首次打开可阅读的活动、已结束、失败、停止或只读历史 run 均显示最后一页，返回子页沿用原 reader 的暂停、搜索与阅读位置，结算不重置。Subagent 阅读链在普通与 fullscreen 主会话模式下均覆盖终端完整列/行，不显示主 footer；Transcript、Details、所属 Jobs 和模型/thinking 选择共用可恢复的全屏作用域，异步子页加载间隙由自有背景 overlay 填行并保持覆盖与输入焦点。正文和子代理底部栏使用同一实际高度预算，不清除主状态、不替换原生/第三方 footer。退出整条阅读链后恢复打开它的列表或提示符、原 footer 实例及最新状态。关闭 overlay 恢复打开它的列表或提示符及主会话视口，不滚动主会话。Markdown、thinking、工具调用/结果由 Pi 原生组件渲染，使用所选 child 的实际工作目录。工具优先使用对应 child 的渲染定义，已回收定义的历史使用 Suite 登记 lookup，未知第三方工具使用 Pi 通用渲染；调用、流式部分输出和最终结果按 toolCallId 配对。稳定消息缓存组件及宽度渲染，每条变化的流式消息和工具部分输出随事件更新；在底部时持续跟随新输出，即使同一组件流式增长也保持最后一页；向上阅读、Home 或搜索离开底部时取消跟随。滚动回到底部或 End 恢复跟随；查看器顶部只保留外边界，不显示运行长标题。所选 run 的名称、状态、耗时、模型/thinking、token、工具次数与阅读状态精简到独立底部信息栏，宽屏尽量一行、普通宽度最多两行；窄屏先省略次要指标，`d` 查看 ID、runId、cwd、完整来源、权限、用量与错误。正文、信息、操作/Editor 区用分隔线区分，预算与原生百分比 overlay 同步缩放，不替换主会话或第三方 footer。暂停阅读期间新输出与 End 恢复提示位于底部，恢复跟随后消失。

- ↑↓、PageUp/PageDown、Home/End 滚动，原生 scrollTop 为唯一偏移；正文按实际预算渲染一次、updateLayout 后切片/补齐，scrollbar:hidden 无滚动条计时器。复杂阅读 overlay 不保证工具单项鼠标操作或 scrollbar 轨道/拖动，鼠标边界见 [终端交互](../ui/terminal.md#原生阅读与鼠标)。
- `o` 切换全部工具展开；Transcript 保留原生消息/工具实例与缓存，展开、流式刷新和 resize 保留组件身份及显式暂停位置，不重放工具执行。
- `/` 搜索；n/N 查下一个/上一个；搜索内 Esc 退出搜索。
- `m` Message、`d` Details、`o` Tools、`h` Thinking、`j` Jobs、`c` Model / thinking；动作按当前可用状态显示，Esc 返回，300ms 内双左退出整个 Subagents/Jobs 浏览链；Enter 不触发消息或停止。
- 可接收消息的运行按 `m` 在查看器底部打开原生多行 Editor，提示为 `Message <名称>` 或 `Answer parent question`。发送/换行键读取宿主 KeybindingsManager，默认 Enter 发送、Shift+Enter/Ctrl+J 换行，支持中文、粘贴、撤销和原生光标。成功后按 agent_send 返回 answered、steered 或 queued，原视图保持打开，following reader 继续跟随，paused reader 不强制跳到底部；失败保留可重试草稿并在本视图反馈。空白提交或 Esc 取消编辑并恢复原焦点，发送中禁止重复发送，Esc 不取消已交给 Manager 的请求。提交前再次检查所选 run；已结束、结算中或同一 agent 的旧 run 不发送，不隐式恢复或转发到后续 run。Runs 列表的 `m` 使用同一 Editor 与提交边界。
- x 按两次停止所选 run 及其嵌套 child/所属 job；第一次提示 `Press x again to stop subtree`，其他按键取消确认。已结束或结算中的 run 隐藏快捷停止。
- b 将正在等待真实 agent_start 前台调用返回的顶级普通运行转为后台，立即释放前台调用；排队、停止中、已结束、嵌套、workflow、RPC 和普通恢复运行不提供此操作。后台池已满时仍可转入，后续启动继续按池上限排队。转入后父级 Esc 不停止该 child，最终结果通过统一通知送达。

Message 使用共享 composer 的原生 Editor，不关闭列表或 Transcript；输入期间文字与方向键只交给 Editor，x/b 和双左不触发控制或退出。Model / thinking 选择与 Jobs 在关闭当前详情后打开，返回后保留滚动、搜索和展开状态。搜索框独占文字按键。普通消息限当前主会话的直接 child；workflow 查看器只允许回答当前可见且已挂起的问题，普通引导与恢复由 workflow 控制。

记录菜单和 Transcript 的 `j Jobs` 按所选 run 子树查询所属活动 job；所属 Jobs 列表同样以 `/` 进入过滤、Tab 进入详情、Enter 直接打开命令/输出查看器，状态行只显示 job 名称；详情与搜索仍保留稳定 ID。选择 job 后复用 [jobs 直接查看界面](../jobs/index.md#用户操作)，使用该 job 的 cwd，允许详情、各日志通道和单独停止。只读历史隐藏 Input、Stop 与 Delete history，仍可阅读详情、各通道和已有终态快照；返回所属列表时刷新活动集合并保留选择 ID。没有所属活动 job 时明确提示，退出 Jobs 不停止 agent。

进入查看器持有公共通知阻塞令牌；关闭后恢复通知投递，主会话保持原绑定。关闭查看器只结束阅读。

打开会话及其消息输入、模型选择、Jobs 往返期间保留其内存 transcript，阅读期间不会回收。关闭后，结束超过 10 分钟的内存对话内容可以释放，记录、结果与持久会话仍保留；非持久 transcript 释放后不可阅读或恢复，边界见 [执行引用回收](runtime.md#执行引用回收)。

## @handle 提及

TUI 输入 `@explore 消息` 或 `@agent-explore 消息` 可以发送给 Explore 实例；正在执行时引导，排队/创建期间暂存，等待父级回答时作为回答，结束后沿用其会话恢复。直接父级和分支归属与 agent_send 相同。停止中的运行报告不可发送。

顶级 agent 的 handle 从类型名生成小写字母、数字、下划线与短横线标识；同一 owner 会话中重名分配 `-2`、`-3` 后缀。agent_start 的 name 同时生成 alias，与 handle 共用名称空间；补全显示 alias，两种名称均可投递。handle/alias 保存在 run 记录中，恢复保持不变；嵌套 child 使用父级工具操作。

尚无实例的类型使用当前分支、系统提示、模型与 thinking 的内存克隆生成任务。克隆只允许一次 agent_start，使用真实父级的注册工具与归属；其推理和工具调用留在内存克隆中。类型 frontmatter 仍决定执行选项，结果通过统一通知送达，包括选择前台执行的类型。克隆无法启动时明确报错；会话切换、树导航、reload 与 shutdown 取消未完成克隆。

输入框在 `@` 后提供活动实例、结束实例与启用类型的前缀补全，并保留 Pi 的文件与命令补全。补全使用绑定/投递时发现的类型快照，实例状态从 Manager 动态读取；发送时重新发现类型。`@main 消息` 将消息交给主会话并保留附件。裸 handle、文件路径、普通文本中的提及、未知名称和带图片的 agent 提及走主会话输入；print/RPC 与扩展提交的文本采用宿主原有输入流程。agents.mentions 默认 true，设为 false 关闭此入口与 agent 补全。

## 父级回答

child ask_user 使用共享 schema 与 response/details，工具挂起期间为 waiting(parent)。问题只交给直接父级，包含选项 ID、标题和 agent_send 提示；顶级通过统一 Notifications，嵌套通过父 child 的通知边界/共享等待返回。提问与结果请求分别使用 `agent:<agentId>:<runId>:ask`、`agent:<agentId>:<runId>:result`，消费或撤销限定该次 run，恢复后的新执行保留自己的通知。顶层 workflow child 的问题也交给所属主会话，可用 agent_send 回答；普通引导与恢复由 workflow 控制。

message 与选项 ID/标题精确匹配时返回 selection，否则返回 freeform，单选与多选同样允许文字回答。多选可发送 JSON 字符串数组；批量问题发送对应题数的 JSON 数组，每题元素为文本或选择数组。返回标记 source=parent，不能把父级回答声称为用户直接授权。期限默认使用 ask.timeout，timeoutMs=0 无期限；超时和取消保留非回答状态，并使 child 以 stopped 结算。

## 类型与模型

类型依次加载 Pi 包声明、用户 `<agentDir>/agents`、项目 `.agents/agents`、项目 `.pi/agents`；后加载的同名类型覆盖前者，项目目录与项目包只在父级已信任时参与。精确名称优先，大小写匹配必须唯一；agents.types 中规范类型名的 enabled 覆盖 frontmatter 与默认 true，最终 false 禁止新准入。支持 name、display_name、description、color、tools、disallowedTools/disallowed_tools、model、thinking、max_turns、persist_session、session_dir、allowed_subagents、prompt_mode、extensions/exclude_extensions、skills、inherit_context、run_in_background、isolated、memory 和 enabled。正文为系统提示词；allowed_subagents 默认不开放嵌套，可为 all 或类型名单。字段、包与资源操作见 [类型与资源](resources.md)。

模型与 thinking 分别按调用参数、该 agent 的 individual、agents.types 的对应字段、frontmatter、agents.defaultModel（仅模型）、父级当前值解析。配置逐类型逐字段合并；显式 provider/modelId 在认证目录中不可用时报错指出来源，不跨 Provider 替换；调用参数和 frontmatter 的模糊名仅在匹配唯一时接受。实际 thinking 由 Pi 按模型能力收紧。单独修改从下一次请求生效，结束后的修改用于恢复，详细规则见 [模型配置](models.md)。

外部扩展使用 [跨扩展 RPC](rpc.md) 启动、停止、引导和消费当前会话的顶级结果。指定目标工作目录的 agent 仍按父级工作区显示在 agent_list 和 /subagents 中，文件工具使用记录中的实际 cwd。

[返回 agents](index.md)

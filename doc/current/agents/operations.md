# 工具与操作

## 模型工具

| 工具 | 参数与返回 |
| --- | --- |
| `agent_start` | 必填 `prompt`；可选 `type`、`name`（最多 80 字符）、`background`、`model`、`thinking`、`maxTurns`、`taskId`、`taskGeneration`、`inheritContext`、`isolated`。见 [前台与后台](runtime.md#前台后台与转后台)、[任务关联](runtime.md#任务关联)。启用调度时还接受 `schedule`，见 [定时调度](schedules.md)。 |
| `agent_list` | `state` 为 `active`（默认）、`queued`、`finished` 或 `all`。`active` 不含排队，`finished` 不含活动和排队。`scope` 默认 `session`，也可选 `workspace`。`agentId` 可与两者组合。用 `cursor`、`limit` 分页，默认 10 条、最多 100 条，正文预算约 4 KiB；`more` 保留筛选参数，列表给出每条记录的 `runId`。 |
| `agent_get` | `id`、可选 `runId` 与 `detail`。查看当前或指定 run，含完整待答问题；`detail:true` 补充来源、上下文、用量和所属活动 job。字段见 [进度与结果通知](progress.md#agent_get-与执行历史)。 |
| `agent_read` | `id`、可选 `runId` 和 `stream`。活动或排队时默认 `transcript`，结束后默认 `result`（错误和结果正文）；可显式指定任一流。`offset`、`limitBytes`、`search`、`context` 见 [输出读取](../jobs/index.md#输出读取)。读取 transcript 可查看输入、thinking、工具调用和输出。 |
| `agent_send` | `id`、`message`。返回 `answered`（答复待答问题）、`steered`（引导执行）、`queued`（暂存消息）或 `resumed`（恢复会话）。仅直接父级可发送，并须符合当前分支的可见范围。 |
| `agent_stop` | `id`、可选 `runId`。等待停止和清理，返回状态和 `cleanup`。范围、重复调用和清理结果见 [停止与 job 清理](runtime.md#停止与-job-清理)。 |
| `agent_workflow` | `script`、`scriptPath` 或 `name` 三选一，可选 `args`、`resumeFromRunId`；后台启动，返回 `wf_` ID 和保存路径。见 [Workflow 操作](workflow/operations.md)。 |
| `wait` | 按 `any` 或 `all` 等待 job、agent 和 workflow ID；结果、问题和其他事件共用返回结构。同一 agent 的其他未读 run 放在 `others`；超时或取消只结束等待。 |

`session` 显示当前分支可见的直接子级，与状态数量使用同一可见性规则；主会话的工具列表还按当前工作目录筛选。`workspace` 按会话工作目录筛选：嵌套调用用父 run 的配置目录 `configCwd`，主会话用当前 `ctx.cwd`。历史发现、未知 ID 查询及其操作限制见 [持久历史](history.md#查询与操作归属)。

### 工具显示

工具结果默认折叠为一行。显示名称，不用 ID 代替名称；只有 ID 的调用按 [进程内查名规则](runtime.md#进程注册与-reload) 回退。模型正文和通知仍用 agent ID 与 run ID，工具参数不改写。

| 结果 | 折叠行 |
| --- | --- |
| `agent_start` | 状态；显式请求前台且有耗时时显示秒数；另标出转后台或调度。 |
| `agent_list` | 条数、状态筛选和范围；有下一页时提示 `more`。 |
| `agent_get` | 状态或待答问题。 |
| `agent_read` | 流、字节区间和总字节数。 |
| `agent_send` | 实际动作。 |
| `agent_stop` | 状态、清理结果和额外受影响的对象数；结果保存名称，供回放使用。 |
| `wait` | 结算比例；展开时按同一进程内查名规则显示普通 agent 的结果及待完成项。 |

展开可查看对应工具的完整输入或本页正文、模型与 thinking、用量、错误和待答问题。列表逐项显示名称与状态，ID 和 run ID 用弱色显示。通用展开键、鼠标和错误显示见 [工具正文](../ui/index.md#工具正文)；child 内工具的显示见下文 [Transcript](#transcript)。

## Dock 键盘进入

Agents 行显示 `名称 (modelId) · 状态 · 耗时 · ↑输入 ↓输出 · N tools`。模型只显示 ID，不带 provider。时长由 `src/ui/format.ts` 的 `elapsedText` 格式化，token 数由同文件的 `countText` 格式化。宽度不足时截短名称和模型，指标可依次省去 token、工具次数和时长；状态优先保留。

分区标题右侧按实际显示的行统计状态，如 `2 running · 1 queued`。行包含当前可见的活动 run、父级可回答的问题，以及尚未消费且仍有内存执行记录的 `failed`、`limited` run。待答显示 `waiting(parent)`。订阅事件和秒级重绘刷新指标，不额外写入会话记录。ID 可在详情和模型工具正文中查看。

空编辑器按 ← 选择 Dock 行，Enter 打开所选 agent 的 Transcript。其余按键、接管条件及选择保留规则见 [Dock 键盘进入](../ui/index.md#dock-键盘进入)。布局默认优先展开可见的 Tasks；选择中优先让所选 agent、workflow 或 job 可见，退出选择后恢复默认布局。完整记录从 [`/subagents`](#subagents) 打开。

## /subagents

| 命令 | 打开 |
| --- | --- |
| `/subagents`、`/subagents all` | Runs，This session，All |
| `/subagents queued`、`/subagents finished` | Runs，This session，指定状态 |
| `/subagents workspace [queued\|finished\|all]` | Runs，Workspace；省略状态时选 All |
| `/subagents types` | [Types](models.md#types-页) |
| `/subagents schedules` | 启用时打开 [Schedules](schedules.md) |
| `/subagents workflows` | 启用时打开 [Workflows](workflow/operations.md#subagents-workflows) |

命令只在 TUI 打开界面；其他模式使用 `agent_list` 和 `agent_read`。标题为 `Subagents ▸ <页名>`，按可见顺序给页签编号。数字键直达页签，`[`/`]` 和方向键切页；Runs 上的 ← 例外：不回绕，300 ms 内连按两次退出整条浏览链。切回 Runs 的那次 ← 不计入；过滤、搜索和消息输入占用焦点时不触发。键盘焦点、分栏、筛选、确认提示与空列表布局见 [BrowserView](../ui/index.md#browserview)；Shift+Tab 仍由 Pi 切换全局 thinking。

### Runs

| 键 | 操作 |
| --- | --- |
| `w` | 切换 This session / Workspace，保留状态筛选。范围与上文工具相同，Runs 的 This session 只按会话和分支筛选。 |
| `s` | 循环 All、Queued、Finished；选项显示当前范围内的条数。 |
| `/` | 在当前范围和状态下过滤；匹配 agent ID、run ID、名称、类型、状态、模型和任务正文。 |
| Enter | 打开 Transcript；排队记录打开任务详情。 |
| `m` / `j` | [消息](#消息) / [所属 Jobs](#所属-jobs)，可用时显示。 |
| `c` | 编辑单个 agent 的 [模型与 thinking 覆盖](models.md#单个-agent)。 |
| `b` | 将仍有前台工具调用等待的顶级普通 run [转为后台](runtime.md#前台后台与转后台)。 |
| `x` 两次 | 停止子树、取消排队，或清理已结束 run 留下的活动 job；均按选定 run 执行。 |

列表只包含 run。活动和排队记录在前，按最近更新、启动、创建时间依次取可用值并倒序。其余先取结束时间，无则用同一规则。行内显示状态和时长：排队显示等待时长，未启动显示 `not started`，其余显示执行时长。预览显示任务正文、模型与 thinking 及其来源、上下文占用与窗口、工具次数、用量和时长；统计口径见 [执行与记录](runtime.md)。页签和子页往返保留查询与阅读位置，范围和状态的每种组合各自保存所选 run ID。

进入 Workspace 时发现持久历史，输入过滤只查已加载记录。其他会话或分支的已结算记录标为 `Read only`，可打开 Transcript 和只读 Jobs；不显示消息、设置、转后台或停止/清理动作。当前会话及分支可见的结束记录仍可修改恢复时使用的模型覆盖或清理活动 job。浏览不切换主会话，也不转移记录或通知。完整限制见 [查询与操作归属](history.md#查询与操作归属)。

### 其他页面

- [Types](models.md#types-页)：含禁用类型；Enter / `c` 改类型默认值，`d` 启用或禁用，`u` 清除存在的启用覆盖。类型预览显示说明、定义路径、配置写入位置、参数和系统提示。
- [Schedules](schedules.md)：列出当前会话的调度；Enter 打开详情，`x` 确认后取消。
- [Workflows](workflow/operations.md)：列出当前会话及分支的执行和保存脚本。切换、启动、暂停、停止、重放和运行详情的键位见该页。

### Transcript

首次打开可读的 run 时，从最后一页开始跟随。活动和结束记录、失败或停止的记录以及只读历史均用这个起始位置。子页返回时保留同一阅读器的跟随、搜索、滚动和展开状态；run 结算也不重置。正文用 child 的实际工作目录渲染。工具优先用该 run 的定义，缺失时查 Suite 登记，再按 [原生 Transcript](../ui/index.md#transcript) 回退。多条工具消息可同时流式更新；即使最后一条未变，较早的流式输出仍刷新。滚动、搜索、新输出提示和鼠标限制见 [ScrollView](../ui/index.md#scrollview) 与 [终端交互](../ui/terminal.md#原生阅读与鼠标)。

Transcript 没有长标题，运行信息在 [底部信息栏](../ui/index.md#查看器底部与退出)。根浏览与全屏阅读的尺寸、切页冻结帧、视口及 footer 恢复见 [阅读 overlay](../ui/index.md#阅读-overlay)。

| 键 | 操作 |
| --- | --- |
| `m` | [消息](#消息)，仅在所选 run 可收消息时显示。 |
| `d` | 详情：ID、工作目录、模型和 thinking 来源、权限、用量及错误。 |
| `o` / `h` | 展开或折叠工具 / 显示或隐藏 thinking。 |
| `j` / `c` | 打开 [所属 Jobs](#所属-jobs) / 编辑模型与 thinking 覆盖。 |
| `b` | [转后台](runtime.md#前台后台与转后台)，可用时显示。 |
| `x` 两次 | 停止所选 run 及其子树，第一次显示确认提示；按其他键取消。已结束或停止中的 run 不显示此操作。 |
| Esc / 300 ms 内连按两次 ← | 返回上一级 / 关闭整条浏览链。关闭只结束阅读。 |

Enter 不发送消息，也不执行停止。查看器保留内存 transcript 的范围见 [执行引用回收](runtime.md#执行引用回收)。`/subagents` 和所属 Jobs 浏览期间暂缓通知，关闭后恢复投递。

### 消息

1. 在 Runs 或 Transcript 按 `m`，在原视图底部打开 Pi 的多行编辑器。提示显示目标名称或待答问题。默认 Enter 发送、Shift+Enter 或 Ctrl+J 换行；实际键位取宿主绑定。支持中文、粘贴、撤销和原生光标。编辑或搜索时，键盘输入不触发查看器动作。
2. 提交时再次检查所选 run。界面只向当前的、已开始且可接收消息的 run 发送；不恢复已结束会话，也不将旧 run 的草稿转给下一次执行。workflow child 的消息仅用于回答当前可见的挂起问题。
3. 成功后显示 `answered`、`steered` 或 `queued`，保持原视图和阅读位置。不在底部时不会跳回底部。空白提交、Esc、草稿重试和发送中的行为见 [输入与选择](../ui/index.md#输入与选择)。

### 所属 Jobs

Runs 和 Transcript 的 `j` 列出所选 run 子树创建的[活动 job](progress.md#所属活动-jobs)，不含同一 agent 其他 run 的 job。列表状态行显示名称；搜索和详情也可用 job ID。没有活动 job 时显示提示；从 job 返回时刷新列表并按 ID 保留选择。

按 `/` 过滤、Tab 预览、Enter 打开 [Jobs 查看器](../jobs/index.md#用户操作)，使用该 job 的工作目录。只读历史可查看详情、各日志通道和已有终态快照，不提供 Input、Stop 或 Delete history。退出 Jobs 不停止 agent。

## @handle 提及

在 TUI 输入 `@explore 消息`，可向当前分支可见的 Explore 实例发送消息。同一实例也可写作 `@agent-explore 消息`：先查完整名称，找不到才去掉 `agent-`。匹配不区分大小写；发送、暂存、回答和恢复与 [`agent_send`](#模型工具) 相同，停止中的 run 拒绝消息。

| 名称 | 分配规则 |
| --- | --- |
| handle（类型名生成的地址） | 只给顶级普通 agent 分配。转小写，非字母、数字、下划线或短横线的连续字符换成 `-`，去掉首尾短横线。基础名最多 64 字符，空名用 `agent`。 |
| alias（启动名称生成的地址） | `agent_start` 的 `name` 非空时用相同规则生成；有 alias 时补全显示 alias，两个地址都可发送。 |

同一主会话的 handle 和 alias 共用名称空间，冲突或遇到保留名 `main` 时试 `-2`、`-3` 等后缀。两者随 run 记录保存，恢复时沿用。嵌套 child 由父级通过工具操作。

类型名未被可见实例占用且该类型启用时，输入 `@类型 消息` 可启动新实例：

1. Pi 在内存中复制当前分支、系统提示、模型和 thinking，用来把消息整理成任务。
2. 副本只有一个工具 `agent_start`，只接收 `prompt`，只允许一次启动尝试。实际调用使用原父会话的上下文，类型配置仍决定执行选项。
3. 推理与调用留在内存副本；真实 child 的结果通过通知送达，前台类型也一样。未启动会显示错误；会话切换、树导航、reload 或关闭会取消尚未完成的副本。

补全接受行首、空白或 `。、？！` 后的 `@`，按前缀列出活动实例、结束实例和启用类型，并合并 Pi 文件与命令补全。实例取当前可见的最新 run，类型取绑定或发送时发现的列表；发送时重新发现类型。

只有 TUI 交互输入中以 `@名称` 开头且带非空消息的文本才会分发。`@main 消息` 发给主会话并保留附件。裸名称、文件路径、正文中间的提及、未知名称和带图片的 agent 提及都走主会话；print、RPC 和扩展提交不走此分发。`agents.mentions` 默认 `true`，设为 `false` 同时关闭分发和 agent 补全。

## 父级回答

child 的 `ask_user` 使用共享的问答参数和返回格式，挂起时显示 `waiting(parent)`。问题只交给直接父级：顶级走主会话通知，嵌套通过父 child 的通知或 `wait` 送达。顶层 workflow child 的待答问题也可由所属主会话回答。通知列出问题、选项 ID、标题和 `agent_send` 用法。

问题请求 ID 为 `agent:<agentId>:<runId>:ask`；消费和撤销只针对该次 run。结果使用独立的请求，见 [结果通知](progress.md#结果通知)。

| 问题 | `agent_send` 的 `message` |
| --- | --- |
| 单题 | 文本精确且唯一匹配选项 ID 或标题时返回 `selection`，否则返回 `freeform`。 |
| 单题多选 | 也可发送选项 ID 或标题组成的 JSON 字符串数组。数组必须非空，每项必须唯一匹配一个选项；重复项合并。 |
| 批量 | 发送与题数相同的 JSON 数组，每题一项，单选用文本，多选可用选择数组。 |

数组形状或选项不符合规则时返回 `INVALID_ANSWER`；JSON 语法错误由解析器报告。返回的 `source=parent` 表示父级回答，不代表用户直接授权。默认等待 `ask.timeout`（600000 ms，10 分钟）；`timeoutMs=0` 不设期限。超时或取消分别返回 `timed_out` 或 `cancelled`，child 以 `stopped` 结算。

## 类型与模型

- 类型发现优先级、项目信任、frontmatter 字段和嵌套白名单见 [类型与资源](resources.md)。内置 Explore 和 Plan 的只读限制见 [内置类型](index.md#内置类型)；两者不是沙箱。
- 模型与 thinking 的来源、认证检查、配置写回与生效时机见 [模型配置](models.md)。
- 外部扩展可用 [RPC](rpc.md) 启动、停止、引导和消费顶级结果。指定不同执行目录时，文件工具使用实际 `cwd`，列表仍按父级配置工作区归类，见 [记录字段](runtime.md#id-与记录)。

[返回 agents](index.md)

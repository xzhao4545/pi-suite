# 工具与原生操作

agent_workflow 仅由主会话使用，参数为 script、scriptPath 或 name 三选一，args?、resumeFromRunId?。工具始终后台启动，初始文件写入后返回 wf_ ID、真实状态、必要日志和 resultPath；本地 details 保留 scriptPath 与恢复来源。使用前提是用户明确要求编排、调用要求编排的技能或指定保存的 workflow；`src/agents/workflow/tool-description.ts` 的约 1 KB 短描述只保留使用前提、参数与后台返回/完成通知语义，并要求编写或编辑脚本前读取 `pi-suite-workflow` skill。完整编排指南位于 [`skills/pi-suite-workflow/SKILL.md`](../../../../skills/pi-suite-workflow/SKILL.md)，保留与 Claude Code 对齐的措辞、模式、并发、结构化结果与恢复指引；工具描述与 skill 不重复维护同一段指南。`package.json` 的 `pi.skills: ["./skills"]` 通过 Pi 的技能发现发布该指南，系统提示仅列名称、说明与路径，正文按需读取。

Workflow 工具折叠为一行，名称/统计、副标题与 tokens/tools/replayed 用量共用公共 toolLine；展开保留阶段、child、尝试、日志与结果全文。调用在结果到达后隐藏，错误完整显示。

`wait({"ids":["wf_…"]})` 使用公共 any/all 等待，问题、其他对象结算、monitor/hands-free 更新和用户插话仍可提前返回。结束后可通过返回的 resultPath 使用 read 读取完整输出。

## /subagents workflows

Workflows 页面标题为 `Subagents ▸ Workflows`，通过顶部 `s View` 一次循环 Runs/Saved，切换当前会话与分支的运行及保存资源；数字键或 `[`/`]` 切换 Subagents 页面。运行按开始时间倒序排列，右侧预览进度；Enter 直接打开完整运行详情，底部按状态显示 `p Pause/Resume`、`x Stop`、`r Replay journal`。Saved 支持 `/` 进入名称筛选、源码预览、Enter 查看源码及 `n Start` 输入 JSON args 后启动；运行和保存资源分别保留筛选、选择与阅读位置，往返其他页面保持当前范围。运行详情展示名称、说明、状态、agent 进度、阶段、实际模型/thinking、尝试原因、用量、提示/结果预览、错误、日志与最终结果。metadata 阶段标题精确匹配；未声明阶段的 agent 保留独立 Agents 分组。

| 动作 | 行为 |
| --- | --- |
| p Pause / Resume | 暂停或释放新启动；暂停期间已有 child 继续结算 |
| x Stop | 首次显示 `Press x again to stop`，再次 x 取消 Worker、child 及所属 job，等待真实清理；其他按键取消确认，Enter 只打开 |
| Enter Open children / gates → Transcript | 使用公共 child Transcript 查看会话 |
| Children / gates → Gate stdout / Gate stderr | 使用公共 job 查询与日志查看器读取当前或持久 gate 输出 |
| Children / gates → Skip | 跳过尚未结算的排队或运行调用，脚本收到 null |
| Children / gates → Retry | 停止当前运行尝试并重跑，脚本继续等待原调用 |
| r Replay journal | 对结束运行使用保存脚本和原 args 创建新运行，复用成功且未改变的前缀 |

Child Transcript 中的 Message 仅用于回答当前主会话可见的挂起问题，回答后普通引导与恢复由 workflow 控制；x 两次停止所选 child run 及其所属运行子树，搜索与输入中的文字按键不触发停止。workflow child 不提供 b 转后台；完整阅读键位及输入/模型选择的状态保留见 [agents 操作](../operations.md#subagents)。

resumeFromRunId 限定当前主会话和分支，目标必须结束并具有 journal。恢复先检查文件，未完成末行的 truncated 前缀在运行日志中明确提示；中间损坏和读取错误拒绝启动。含 child 会话 resume 的 journal 按完整执行规则处理，见 [编排与 journal](index.md)。

查看器复用原生 Text、DetailsView、ScrollView、阅读 overlay 和值选择，正文按共享预算显式切片/补齐，scrollbar:hidden；child Transcript 保留原生消息/工具实例，通过 `o` 展开全部工具、`h` 切换 thinking，复杂阅读 overlay 不保证单项工具鼠标命中或 scrollbar 拖动，见 [终端交互边界](../../ui/terminal.md#原生阅读与鼠标)。gate 日志仍保持独立字节窗口。列表默认列表焦点，`/` 进入过滤、Tab 进入详情、Esc 返回列表；页面标签和筛选不进入焦点环。运行详情与 child Transcript、gate 日志使用同一阅读 overlay，fullscreen 满屏、普通居中 90% 宽；从 Subagent 阅读链进入时沿用全终端覆盖与主 footer 隐藏作用域，正文和 overlay 共用高度上限。↑↓、PageUp/PageDown、Home/End 阅读；`/` 搜索，n/N 查下一/上一项；动作按其显示键直接执行，Enter 打开 Children / gates，Esc 返回。返回 child 会话、gate 日志或控制操作后保留详情阅读与搜索位置。菜单值使用运行 ID 与 agent index，长名称的显示截断不改变选择身份。浏览期间由公共通知阻塞令牌保持阅读。

详情动作随当前运行状态更新：运行结束时移除 Pause、Resume、Stop 并开放 Replay journal，不需要退出详情再打开。

## 开关与冲突

agents.workflows 默认 true，控制 agent_workflow 启动和菜单入口；初始关闭时不注册该工具，绑定时可按配置启用。绑定通过公共工具注册刷新描述，使模型使用当前启用的类型名称列表，不拼接完整类型说明；完整说明与设置可通过 /subagents types 查看。关闭开关后使用 /reload，运行 owner 与保存文件按生命周期保留。agents.packageWorkflows 为 boolean 或包名/source 数组；false 与空数组关闭包 workflow 发现。

默认开启时，检测其他扩展的 agent_workflow、SubagentWorkflow、Workflow 或 workflow 工具；发现冲突后本入口退让并报告来源。用户在配置中显式设置 `"agents": {"workflows": true}` 时保留并列工具；同名注册被 Pi 选择第一项时报告冲突。工具撤销只影响本入口，由本入口撤销的选择可在重新启用时恢复，手动禁用的工具选择保持不变。

[返回 Workflow](index.md)

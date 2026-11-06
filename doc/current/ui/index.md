# 统一界面

Dock 是本包唯一常驻 widget，键为 pi-suite:dock。模块提交稳定 ID、文本、优先级及可选 parentId；Dock 先按优先级为父级/独立摘要分配行，再把剩余预算交给其 child，并保持父子相邻，末行显示隐藏数量。行可提供受保护的 suffix，任务完成比例、状态与隐藏数量优先保留，标题在其余宽度内截断。纯展示截断不会修改原始数据。

## 高度与状态

低于 28 行的终端最多分配 3 行；普通终端最多 6 行且不超过终端高度的 20%。ui.maxRows 可继续收紧预算，并包含本包状态在 Pi 原生 footer 中占用的额外一行；扣除该行后的 Dock 预算可以为 0。原生 footer 自身另有两条基础行。询问与 Dock 共用剩余预算：询问打开时各模块提供压缩摘要，预算大于 1 且存在摘要时最多保留一条 Dock 行，其余用于询问。询问至少保留一条可用回答行；ui.maxRows=1 且 footer 占用预算时，这条最低回答行是明确例外。打开独立详情时收起 Dock，关闭后恢复。

每行使用 Pi 的 ANSI 安全截断与可见字符宽度，不自动换行。展开的 Markdown 详情与字面量日志详情按宽度换行。第三方 widget 或 footer 的高度由其自身控制。

StatusPublisher 是本包 goal 与 pi-suite:runtime 摘要的共享写入方，原生 setStatus 更新/清除摘要。只有本次激活实际创建 GoalManager 时才持有 goal 键的写入/清除权；goal 模块关闭时绑定、重绑、reload 和 quit 均保留其他扩展的 goal 状态。活动 ID 使用集合去重；goal 文本或活动数量变化时更新状态，等数量的 ID 变化只更新集合。setActivities 同时接受必要详情行；相同详情不刷新，问题、清理、选择或状态变化即使数量相同也更新 Dock。status 模式的摘要不在 Dock 重复展示，dock 模式清除状态槽位，hidden 隐藏该类常驻摘要和详情。绑定撤销时清除 pi-suite:runtime，并仅在本次激活持有 goal 键时清除该槽位，同时清除详情及选中执行。agents 按直接子级与分支可见记录计数，queued 不计入；jobs 的 session 列表与数量共用 [会话可见集合](../jobs/index.md#会话可见集合)，只计入当前运行时持有且活动的对象。

必要详情和任务共用同一排序：待父级回答的问题、job 清理待确认优先，其后为未消费失败、停止中、查看入口选中的 agent run/job、选中任务组、doing/blocked 任务，再到普通 agent/job 活动。父级通知已读取而尚未回答的问题继续保留；workflow 可见问题也可提示，但普通 child/gate 数量仍由所属 workflow 承载。已结束的普通执行从常驻行收起，完整记录保留在既有详情与历史中。任务压缩摘要按实际子任务计算完成数/总数、doing 和 blocked，完成任务不计入 blocked；任务组选择使用稳定 ID，详情阅读使用独立快照。

goal 摘要从目标与调度状态派生，图标含义见 [目标操作](../goal/operations.md)；完成反馈显示 5 秒后清除，回调同时校验绑定与目标 ID。暂停、阻塞、请求失败与预算耗尽持续可见。footer 的 pi-suite:runtime 显示 `🤖N · ⚙M`，分别表示活动子代理与 job 数量，零值项隐藏；dock 模式的数量摘要保留 agents/jobs 标签。Pi 原生 footer 读取 goal 键；pi-starship 0.65.2 使用 extension_status 模块读取同一键，其格式和数量上限由外部 footer 配置控制。完整发布入口的 Linux SDK 与 Windows 实际 Pi CLI 检查覆盖 40×24、60×30、120×40 的 goal、tasks、运行 child/job 与实际询问并存。Windows 验收确认数量摘要去重、窄屏换行与询问同时显示；用户实际 format 缺少 `$extension_status` 时摘要不可见，goal.display=dock 仍通过 Pi 原生 Dock 显示，hidden 隐藏常驻摘要。max_statuses 按扩展状态插入顺序截取，较早的第三方状态可能排挤 goal/runtime；disabled 或根 format 缺少 extension_status 会隐藏摘要。extension_status.icons 中省略 goal 的固定覆盖值可保留发布方的动态图标，`icons = { "pi-suite:runtime" = "", fallback = "" }` 保留 goal 图标与数量文本，并隐藏普通状态的默认插头图标。外部模块设置可能报告字段校验警告。窄屏对整体 format 自动换行，公共接口没有可靠的外部 footer 总高度反馈；用户可调整其布局或明确选择 goal.display=dock。目标详情通过 /goal 打开，复用 Markdown 与 ScrollView，并提供搜索和显式翻页操作。

pi-starship 的 `git_status` 使用 Git 上游跟踪分支的缓存差异：默认 `⇡N` 表示本地领先 N 个提交，`⇣N` 表示落后 N 个提交，同时领先和落后表示分叉。`$all_status` 汇总文件改动，`$ahead_behind` 显示提交差异；只移除后者即可隐藏提交数量并保留文件状态。显示依赖已有上游引用，不代表实时查询远端。

简洁布局可使用 `[git_branch]` 的 `symbol = "git "` 和 `[git_status]` 的 `ahead = "↑$count"`、`behind = "↓$count"`、`diverged = "↑$ahead_count ↓$behind_count"`，呈现 `git main ↑7 ↓2`；根 format 同时包含 `$git_branch$git_status`。箭头只在对应数量非零时显示。

活动配置位于 `<getAgentDir()>/pi-starship.toml`；命名配置存放于其同级 `pi-starship/profiles/`，保存或外部编辑 profile 后通过 `/starship` → Profiles → 对应名称 → Apply 应用，profile 与活动配置分别保存。外部修改活动配置后执行 `/reload`，通过 `/starship status` 检查运行时配置告警；配置语法校验不代表当前 footer 已更新。simple 布局的上下文 `[[context.display]]` 使用 `threshold = 0`、`hidden = false` 和对应样式，显示低于 30% 的占用。

## 原生会话查看

Transcript 复用 Pi 的 UserMessageComponent、AssistantMessageComponent、ToolExecutionComponent、CustomMessageComponent 和压缩/分支摘要组件。已知内置工具采用 Pi 提供的 renderers；child 提供其实际渲染定义，使用其实际 cwd，缺少定义的扩展工具使用原生通用工具呈现。稳定消息保留组件与宽度缓存，调用方按每条 entry 的身份检测变化，并只更新变化的流式消息或工具结果。工具调用与部分/最终结果按 toolCallId 配对，不执行工具。thinking 与工具详情可切换展开，输出默认不传输终端图片。

ScrollView 为历史与每个选项详情分别保存滚动位置及搜索内容，支持按行、按页、Home/End、搜索和下一匹配。终端支持的鼠标滚轮通过 Pi 的标准事件增强阅读。尺寸改变不初始化回答草稿或勾选集合。

Windows Pi 1.5.0 实际 CLI 组合验收覆盖三种标准尺寸、27/28 行预算阈值及 ui.maxRows=1 的最低回答行例外；原生键盘焦点、历史与说明的鼠标滚动、阅读位置往返和缩放后草稿/筛选外勾选保持均通过。范围与离线模型控制边界见 [Windows 询问组合](../../finished/pi-suite/ask/windows-combination.md)。

DetailsView 提供统一标题、滚动正文、搜索与可配置操作栏；操作可声明快捷键、动态可用条件、默认选择与二次确认提示。←→ 选择可用动作，Enter 执行；二次确认的动作先显示提示，再按其快捷键执行，其他按键取消确认。搜索期间所有文字键交给搜索框，不触发控制动作。静态 Markdown、tasks 快照、jobs 动态日志与 agents transcript 使用同一框架。ScrollView 支持替换正文并保留阅读状态，调用方可要求下次渲染跟随底部；用户在渲染前滚动或开始搜索会取消该次跟随。日志只缓存当前字节窗口，具体操作见 [执行任务](../jobs/index.md#用户操作) 与 [任务操作](../tasks/operations.md)。

BrowserView 是 agents/jobs 的公共列表框架，组合 Pi Input、fuzzyFilter、SelectList、Text 与 ScrollView；领域模块提供稳定身份、可搜索元数据和详情，筛选不创建独立业务数据源。80 列起使用左右布局，窄屏上下布局；重名、状态变动与显示截断不改变选中身份，每个条目保存独立阅读/搜索位置。事件刷新合并为短期渲染请求，仅可见活动条目使用每秒时钟；dispose 释放订阅及计时器。按键与范围见 [子代理操作](../agents/operations.md) 和 [job 操作](../jobs/index.md#用户操作)。

Pi 全屏文本拖选使用宿主共享剪贴板通道；tmux/SSH 的能力与操作条件见 [终端复制](terminal.md)。

公共 selectValue 复用 Pi 原生 SelectList 与主题，按终端高度限制可见选项，支持按键分页；值和显示标签独立，长行只在显示时截断。agent 模型与 thinking 使用该选择器；临时关闭并重开 DetailsView 时可以沿用同一 ScrollView，保留滚动与搜索状态。

[返回当前文档](../index.md)

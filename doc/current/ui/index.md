# 统一界面

Dock 是本包唯一常驻 widget，键为 pi-suite:dock。来源通过 `register(id, { title, rows })` 注册分区，并可提供单行 summary、标题 subtitle、右对齐标题 aside、尾线 footer 与完成比例 progress。模块提交稳定 ID、文本、优先级及可选 parentId；priority 决定领域行的紧急程度与内部保留顺序；未激活选择且存在可见 Tasks 时优先给 Tasks 入场与额外展开预算，Tasks 不可见时按分区紧急程度分配，激活选择时始终优先所选分区。分区固定按 Goal → Tasks → Agents → Jobs → Workflows 排列，分区内部保持来源顺序。child 连带保留父级，父子相邻。每个多行分区带粗体 accent 标题、树形竖线与尾线，标题与尾线计入预算；单行分区合并标题与正文，预算只有 1–3 行时空闲分区使用单行摘要。宽度小于 40 列省略树形字符。任务分区竖线按全部子任务完成比例沿阅读顺序染 accent，其余为 borderMuted；其他分区为 borderMuted。按保留对象在原列表中的实际位置插入英文折叠提示：`↑ … N more items/groups` 表示前段、`↓ … N more items/groups` 表示后段、`↕ … N more items/groups` 表示两段之间；任务组与子项分别计数，提示不参与选择，仅缺一项且同样占一行时直接显示该对象。预算不足以保留边界提示时，选中对象仍可见，标题用 `↑N ↓N` 表示其前后隐藏数量。行可提供受保护的 suffix，及按省略顺序排列的 compactSuffixes；Dock 为可识别名称保留最多 8 列，再选择能够容纳的指标组合。任务完成比例与状态优先保留，标题在其余宽度内截断，suffix 按可见宽度对齐右侧。纯展示截断不会修改原始数据。

## Dock 键盘进入

来源可提供 `open(rowId, ctx)`，或在分区注册后用 `setOpen(id, open)` 接入现有查看入口；有 open 的实际对象行参与选择，数量摘要用 `selectable: false` 排除；Tasks 使用 `readOnly: true`，Enter 只查看组或子任务详情，不提供编辑、状态、执行引用或删除操作。空编辑器按 ← 进入，↑↓ 按固定分区与来源顺序移动，`[`/`]` 循环切换可选分区，Enter 打开所选任务只读详情、agent transcript、workflow 运行详情或 job 命令/输出查看器；Esc 或 → 返回编辑器，其他按键退出选择并原样透传。编辑器非空、补全占用导航、询问、详情或其他组件拥有焦点时不接管按键；key release 不触发操作。监听随会话 bind/detach 注册与注销，reload、会话和树切换不保留监听或选择。

焦点读取使用宿主公开 getFocusedComponent getter；可替换编辑器按 getText/setText 与 capturesViewportInput 结构识别，不依赖私有焦点字段或 Editor 类身份。选择身份为分区 ID + row ID；刷新重排保持对象，移除时选择原位置的下一项，末项移除则选择前一项。激活时以选中背景和粗体高亮；层级前缀及原空格数、名称起始列与右侧指标预算不随选择改变，不用箭头替换树形缩进，不切换字号。名称、状态与指标保持各自角色，选中分区位置不变，预算优先保留所选行与必要父级，避免 Enter 打开裁剪不可见的对象；未激活时按固定分区顺序显示，不增加提示行。激活标题显示 `↑↓ select · [ ] section · Enter open · Esc back`，Tasks 使用 `Enter view` 表达查看，不追加冗余 `read only` 标签；同时有右侧数量且窄屏空间不足时使用 `[ ] Enter Esc`，优先保留提示和数量、截短分区名称；预算允许时紧凑分区使用标题加所选行，只有一行预算时合并为 `分区 Enter/Esc · 对象`，没有可见预算或可选对象时 ← 透传。打开查看器退出选择，关闭后可再按 ←，在同一绑定中保留上次对象身份。

## 高度与状态

Agents 行以 `AgentRecord.name` 为主，不在常驻行重复 agent ID；右侧为 `状态 · 运行时间 · ↑输入 token ↓输出 token · N tools`，先截短名称，再省略 token、工具次数，极窄空间再只保留状态。待答状态为 `waiting(parent)`；排队与尚未启动记录累计运行时间为 0。Agents 标题 aside 统计本分区实际对象的状态数量（含 queued 与可见 workflow 问题），例如 `2 running · 1 queued`；dock 模式不额外输出重复活动数量行。带 aside 的单对象分区在预算允许时保留标题和对象两行，只有一行预算时将数量和对象合并。运行指标沿用 Manager 快照和订阅，活动期间每秒只刷新展示；计时器不追加会话记录、不投递通知，隐藏或解绑时释放。

记终端高度为 H，原生 footer 估计高度为 F（2 条基础行，本包存在状态时为 3 行）。空闲 Dock 预算为 `clamp(floor(H/2) − 1 − 3 − F, 0, ui.maxRows)`：为 Pi 自带空行、三行编辑器和 footer 留出空间，聊天至少保留一半。ui.maxRows 默认 12、范围 1–30，标题与尾线计入常驻预算。低于 18 行时只输出单行摘要，最多占预算行数。

询问以原生 inline custom 替换编辑器，打开时 Dock 返回空数组，关闭后恢复。Ask 上限为 `max(1, floor(0.7·H) − 1 − F)`，与 ui.maxRows 独立；实际高度取整批题目与 Review 中最高内容并封顶，内容少时不补到上限。打开、缩放或切换展开状态时测量，切题与筛选保持高度并保留空行。上限低于 12 行去掉两条分隔线，低于 5 行使用无外框的一行回答或回答加操作栏；历史与全文阅读使用 80% 高度。正常询问使用圆角 border 色边框，标题、requester、heading、页码与空闲时间嵌入上边框；不足 50 列省略左右竖线，保留上下边框。外框与编辑器边线、Dock 尾线区分不同区域。独立详情同样收起 Dock，关闭后恢复。

编辑器多行输入与第三方 footer 换行的实际高度无法从公共扩展接口获得，预算使用上述估计；fullscreen 模式由 Pi VStack 收缩，inline 模式聊天向上推。原生编辑器和 footer 由 Pi 或其已有扩展负责。

Dock 每行使用 Pi 的 ANSI 安全截断与可见字符宽度，不自动换行；询问展开内容按可见宽度换行。展开的 Markdown 详情与字面量日志详情按宽度换行。第三方 widget 或 footer 的高度由其自身控制。

StatusPublisher 是本包 goal 与 pi-suite:runtime 摘要的共享写入方，原生 setStatus 更新/清除摘要。只有本次激活实际创建 GoalManager 时才持有 goal 键的写入/清除权；goal 模块关闭时绑定、重绑、reload 和 quit 均保留其他扩展的 goal 状态。活动 ID 使用集合去重；goal 文本或活动数量变化时更新状态，等数量的 ID 变化只更新集合。setActivities 同时接受必要详情行与标题 aside；相同详情不刷新，运行指标、状态数量、问题、清理、选择或状态变化即使活动数量相同也更新 Dock。status 模式的摘要不在 Dock 重复展示，dock 模式清除状态槽位，hidden 隐藏该类常驻摘要和详情。绑定撤销时清除 pi-suite:runtime，并仅在本次激活持有 goal 键时清除该槽位，同时清除详情及选中执行。agents 按直接子级与分支可见记录计数，queued 不计入；jobs 的 session 列表与数量共用 [会话可见集合](../jobs/index.md#会话可见集合)，只计入当前运行时持有且活动的对象。

必要详情和任务共用行保留优先级，但默认展开策略与行紧急程度分离，且不改变固定分区顺序：待父级回答的问题、job 清理待确认优先，其后为未消费失败、停止中、激活 Dock 选择的对象与必要父级、选中任务组、doing/blocked 任务，再到普通 agent/job 活动。父级通知已读取而尚未回答的问题继续保留；workflow 可见问题也可提示，但普通 child/gate 数量仍由所属 workflow 承载。已结束的普通执行从常驻行收起，完整记录保留在既有详情与历史中。任务单行摘要保留焦点组当前子任务，组进度统计全部现存子任务；任务组选择与实时浏览器阅读使用稳定 ID，订阅更新不重置选中身份。

稳定对象身份可在同一绑定内保留，但常驻可见选中态只由激活 Dock 持有；领域模块不保留最近查看的 agent/job 优先级。Jobs 名称区及选中摘要只显示清理后的显式或命令/监控派生名称，机器 ID 留在搜索与完整详情；`executionRow()` 统一 Dock、Runs 与 Jobs 的后缀预算。结构化 DisplayField 分隔名称、状态和指标，waiting(parent) 与 cleanup pending/unconfirmed 使用 warning，不按名称中的相同单词染色。

goal 摘要从目标与调度状态派生并附累计有效运行时间，运行中每秒刷新，暂停/等待冻结且释放刷新计时器；图标含义见 [目标操作](../goal/operations.md)；完成反馈显示 5 秒后清除，回调同时校验绑定与目标 ID。暂停、阻塞、请求失败与预算耗尽持续可见。footer 的 pi-suite:runtime 显示 `🤖N · ⚙M`，分别表示活动子代理与 job 数量，零值项隐藏；dock 模式的数量摘要保留 agents/jobs 标签。Pi 原生 footer 读取 goal 键；pi-starship 0.65.2 使用 extension_status 模块读取同一键，其格式和数量上限由外部 footer 配置控制。完整发布入口的 Linux SDK 与 Windows 实际 Pi CLI 检查覆盖 40×24、60×30、120×40 的 goal、tasks、运行 child/job 与实际询问并存。Windows 验收确认数量摘要去重、窄屏换行与询问同时显示；用户实际 format 缺少 `$extension_status` 时摘要不可见，goal.display=dock 仍通过 Pi 原生 Dock 显示，hidden 隐藏常驻摘要。max_statuses 按扩展状态插入顺序截取，较早的第三方状态可能排挤 goal/runtime；disabled 或根 format 缺少 extension_status 会隐藏摘要。extension_status.icons 中省略 goal 的固定覆盖值可保留发布方的动态图标，`icons = { "pi-suite:runtime" = "", fallback = "" }` 保留 goal 图标与数量文本，并隐藏普通状态的默认插头图标。外部模块设置可能报告字段校验警告。窄屏对整体 format 自动换行，公共接口没有可靠的外部 footer 总高度反馈；用户可调整其布局或明确选择 goal.display=dock。目标详情通过 /goal 打开，复用 Markdown、ScrollView 与阅读 overlay，提供按页阅读及搜索。

pi-starship 的 `git_status` 使用 Git 上游跟踪分支的缓存差异：默认 `⇡N` 表示本地领先 N 个提交，`⇣N` 表示落后 N 个提交，同时领先和落后表示分叉。`$all_status` 汇总文件改动，`$ahead_behind` 显示提交差异；只移除后者即可隐藏提交数量并保留文件状态。显示依赖已有上游引用，不代表实时查询远端。

简洁布局可使用 `[git_branch]` 的 `symbol = "git "` 和 `[git_status]` 的 `ahead = "↑$count"`、`behind = "↓$count"`、`diverged = "↑$ahead_count ↓$behind_count"`，呈现 `git main ↑7 ↓2`；根 format 同时包含 `$git_branch$git_status`。箭头只在对应数量非零时显示。

活动配置位于 `<getAgentDir()>/pi-starship.toml`；命名配置存放于其同级 `pi-starship/profiles/`，保存或外部编辑 profile 后通过 `/starship` → Profiles → 对应名称 → Apply 应用，profile 与活动配置分别保存。外部修改活动配置后执行 `/reload`，通过 `/starship status` 检查运行时配置告警；配置语法校验不代表当前 footer 已更新。simple 布局的上下文 `[[context.display]]` 使用 `threshold = 0`、`hidden = false` 和对应样式，显示低于 30% 的占用。

## 原生会话查看

命令/回调注册与实际页面加载分离：Tasks、Goal、Jobs、Subagents 和 Suite 设置的加载入口及绑定撤销规则见 [加载与首次就绪](../runtime/index.md#加载与首次就绪)。工具与历史 renderer 独立于交互查看器，在 factory 提前登记，不等待首次使用或 session_start。

`/tasks`、`/jobs`、`/subagents`、`/goal` 和 `/suite` 的内容块及公共选择器、详情、日志和终端接管视图，上下各有一道随宽度变化的横线，使用 Pi border 主题角色。DetailsView、BrowserView 与 JobView 显式扣除标题、正文、输入和底部栏预算，再用公开 VStack/HStack 组合有界输出；阅读窗口不依赖宿主替嵌套正文补做布局或鼠标分派。传统字符串组件的 frame.ts 复用 Pi `/settings` 的 DynamicBorder，调用方仍为上下边界预留两行并扣除顶部行坐标。

Transcript 以原生 Container 保留完整子组件树，复用 Pi 的 UserMessageComponent、AssistantMessageComponent、ToolExecutionComponent、CustomMessageComponent 和压缩/分支摘要组件，渲染保留实际消息与工具组件，不把全文压成独立字符串窗口；复杂阅读 overlay 的单项工具鼠标命中不作为能力保证。已知内置工具采用 Pi 提供的 renderers；child 提供其实际渲染定义，结束执行释放定义后使用 Suite 登记 lookup，缺少定义的第三方扩展工具使用原生通用工具呈现。稳定消息保留组件与宽度缓存，调用方按每条 entry 的身份检测变化，并只更新变化的流式消息或工具结果。工具调用与部分/最终结果按 toolCallId 配对，不执行工具。thinking 与工具详情可切换展开，输出默认不传输终端图片。

AskView 持有询问状态、焦点与空闲计时，ask/keys.ts 分派选项及页签按键，ask/render.ts 统一题型标记、页签与空闲时间，ask/layout.ts 处理外框、内容折叠、换行与按选项身份映射的物理行窗口。Pi Editor 的 disableSubmit 让 Ask 确认时保留原生文字、光标和撤销状态，文本编辑不占用页签方向键。

ScrollView 为历史与每个选项详情分别保存滚动位置及搜索内容，直接继承官方公开 ScrollView，以原生 scrollTop 为唯一偏移，follow-end 与滚动方法管理跟随。viewport 按实际宽度渲染正文一次，调用 updateLayout 更新内容/视口高度，再按 scrollTop 切片并用 readingWindow 补齐预算；搜索缓存仅索引正文，不维护第二个偏移。支持按行、按页、Home/End、搜索和下一匹配；scrollbar:hidden 不创建滚动条活动计时器。尺寸改变或正文缩短引起的 clamp 保留显式 pause，不因布局重新启用跟随，也不初始化回答草稿或勾选集合。阅读路径不保证复杂嵌套工具的单项鼠标操作或可拖动 scrollbar，不新增模拟鼠标分派；主会话工具与 Ask 表单既有本地鼠标能力见 [终端交互边界](terminal.md#原生阅读与鼠标)。

Linux Pi 1.5.0 实际 CLI 在 24/30/40/60 行与 40/80/120 列组合验证独立高度预算、任务 ID 顺序与溢出、询问覆盖与恢复、切题/筛选高度稳定、边框、展开与全文阅读、多行点击、页签坐标、缩放草稿保持，以及低于 18 行摘要与紧凑回答。平台及验收范围见 [底部布局专项](../../finished/pi-suite/ui/dock-ask-layout.md)。

DetailsView 使用公开 VStack 提供统一标题、滚动正文、搜索与按键驱动的操作说明，按共享 readingRows 预算显式渲染正文 viewport；BrowserView 采用公开 VStack/HStack 组织分栏，组合前各阅读区已按实际宽度和高度限界，避免对同一正文重复测量。每个 DetailAction 必须声明 key，可提供动态可用条件与二次确认。ActionBar 由详情与浏览框架共享，不持有动作光标；按显示键直接执行，确认统一使用英文 `Press <key> again to <action>`，再次同键执行，其他按键取消确认，切换记录也清除确认。搜索期间所有文字键交给搜索框，不触发控制动作。80 列起按键说明按原生宽度换行，窄屏可以截断；TerminalView 的固定底部提示显式使用最多两行的有界换行，优先保留实际离开键。静态 Markdown、安全字面量任务详情、jobs 动态日志与 agents transcript 使用同一框架；showDetails 的 `text` 格式通过 Pi Text 呈现清理后的字面量，不把任务描述解释为 Markdown。ScrollView 使用 Pi 原生 ScrollView 的 `follow: "end"`、isFollowingEnd 与滚动方法，支持替换正文而不改变持续跟随状态；首次打开任何可阅读的 Subagent run（活动、终态或只读历史）均定位最后一页，只在新 reader 建立时跟随。返回子页、搜索、暂停和刷新沿用原 reader，结算不重置位置。用户向上滚动、Home 或搜索离开底部取消跟随，滚动回到底部或 End 恢复；活动 Transcript 的 following/paused、阅读位置和新输出提示位于底部信息栏，普通有标题的详情仍在标题位置显示提示。尺寸变化本身不触发新输出提示。日志字节窗口仍由日志查看器管理，f 与 End 复用相同跟随状态。日志只缓存当前字节窗口，具体操作见 [执行任务](../jobs/index.md#用户操作) 与 [任务操作](../tasks/operations.md)。

公共 reading.ts 的 openReading 使用 Pi `ctx.ui.custom` 的 focused overlay，不创建第二套终端渲染器，也不切换或复制主会话 layout root。以当前 `tui.mode` 和阅读链作用域判断：fullscreen 或 Subagent 全屏阅读链为 top-left、width: "100%"、maxHeight: "100%"、margin: 0，其他普通阅读为 center、width: "90%"、maxHeight: "70%"、margin: 0。Pi 在打开时求值配置回调，百分比由原版 TUI 在每次渲染时按终端尺寸解析；readingRows 与 overlay 共用高度上限，DetailsView 从实际上限扣除标题、边界、底部信息与按键说明。原版 overlay 按组件输出行数覆盖画面，Suite 的 readingWindow 显式切片/填行，openReading 为全屏组件补足整个阅读预算，包括短正文、模型选择和主 footer 所在行；不依赖 overlay.height 或原生 compositor 补齐。showAgent、workflow 运行详情、Jobs 命令/输出查看器、直接 PTY attach、showJobLog 与 showDetails 统一调用，导出入口和参数保持一致；done 关闭自有 overlay、调用组件 dispose 并恢复原焦点与主会话视口。DetailsView 与 BrowserView 声明 capturesViewportInput，Pi fullscreen 将 PgUp/PgDn 等视口键交给焦点组件；浏览列表使用同一阅读 overlay，不替换主编辑器。模块身份与宿主入口见 [宿主加载边界](../runtime/index.md#宿主加载边界)。

Subagents 根导航通过 withReadingSession 贯穿页签、列表、消息历史、所属 Jobs、详情和选择器；消息阅读内部的 withReadingScreen 只管理全屏尺寸，不另建导航作用域。旧页结束时在 done 前安装自有最后一帧的冻结 overlay，删除光标标记并吞掉输入；新页 onHandle 确认挂载后释放冻结帧，不保留旧组件资源或第二份正文滚动状态。冻结帧 resize 使用已完成页的高度策略补齐，不暴露主 footer，也不复制主 layout root。构造失败由最外层导航退出释放帧与作用域；正常退出同样恢复原焦点和最新主状态，不清除状态、不替换 footer 实例或伪造底层 TUI 模式。旧 DetailsView dispose 仅在仍拥有共享 reader 回调时释放 reader，不覆盖新 owner 的布局/滚动回调。

BrowserView 是 agents/jobs/tasks 的公共列表框架，组合 Pi Input、fuzzyFilter、SelectList、Text 与 ScrollView；领域模块提供稳定身份、可搜索元数据和详情，筛选不创建独立业务数据源。标题统一为 `<命令> ▸ <页名>`，BrowsePage 提供共享页面标签栏，各页保留独立 BrowseState；数字键或 `[`/`]` 一次切页，标签不进入 Tab 焦点环。BrowseControl 必须声明 key，按键立即循环应用选项，没有独立候选光标。默认列表焦点，只有 list/details/filter：活动区域标题使用 `▸`、accent、粗体及 accent 横线，非活动标题为 muted、横线为 borderMuted；列表选中背景只在列表拥有焦点时显示，离开列表保留对象身份和状态颜色，不整块灰化正文。过滤、详情搜索和内联消息输入分别以 `▸ Filter:`、`▸ Search`、`▸ Input` 标示输入焦点，原生输入组件持有唯一光标；保留的非活动过滤查询不显示光标。键盘操作明确切换区域焦点，无详情时不进入详情焦点；阅读 overlay 不承诺嵌套区域的鼠标焦点映射。Tab 进入详情，Tab/Esc 返回列表，`/` 进入过滤，过滤内 Enter/Tab 保留查询回到列表、Esc 清空退出，直接输入字符不过滤。Enter 固定解析选中身份执行“打开”，不触发消息或停止；动作沿用共享 ActionBar。页面通过 selection 提供选中名称/ID、通过 total 提供范围内筛选前总数，scope 可提供固定范围（如 Run subtree）；状态行显示页名、范围/状态、查询、匹配数/总数与选中对象，80 列以下优先保留页名和名称/ID。SelectList 原生 layout/truncatePrimary 能力用于保留记录状态/时长，以及类型启用状态、模型名称和 thinking，完整身份与数据不被截断。80 列起使用左右布局，窄屏上下布局；重名、状态变动与显示截断不改变选中身份，每个条目保存独立阅读/搜索位置，往返时保留焦点。空结果的列表正文与底部动作行显示同一下一步提示；框架根据文本过滤、All 选项及其计数、范围或其他页面生成，例如 `No queued runs · press s for All (10)`。标题区包含状态行，列表/详情标题线随焦点强调，列表与底部使用 borderMuted 分隔线。列表正文补齐可用高度，底部始终固定两行：导航行按当前页列出数字键 / `[ ]` 切页、范围/状态等控件、`/ filter · Tab details · Esc close`，动作行显示 `Enter open` 与可用动作或空状态提示；无记录时仍显示全部导航控件，Tab 在无详情时不移动焦点。两行各自按可见宽度截断，不换行；窄屏导航优先保留切页与筛选键。事件刷新合并为短期渲染请求，仅可见活动条目使用每秒时钟；dispose 释放订阅及计时器。任务行先清理字面量数据，再由浏览框架在原生 truncatePrimary 布局之后应用公共记录角色与完成删除线。按键与范围见 [子代理操作](../agents/operations.md)、[job 操作](../jobs/index.md#用户操作) 和 [任务操作](../tasks/operations.md)。

tool-render.ts 是 Suite 工具公共正文层：调用尚无结果时显示调用摘要，部分/最终结果接管后隐藏调用正文；背景、执行外壳与单层 outputPad 由 Pi 默认 Box 负责，工具正文不自绘上下横线。统一字面量清理、宽度、完整错误与结构化字段/code/command 展开。明确语言的普通代码使用原生高亮，显式命令使用共享 [命令结构高亮](command-highlighting.md)，普通日志保持字面量，敏感字段在染色前隐藏。共享组件区分 code/command 用途并缓存源码区间/语言/宽度/主题；内置模型 bash/powershell 的增强只装饰原生调用 renderer，并由 ui.highlightBuiltinCommands 控制，Jobs 与 Suite command 字段独立默认高亮。Ask History、实际 child 和收集后 Transcript 复用同一登记 renderer，规则见 [工具契约](../runtime/tools.md)。

公共 InlineInput 复用 Pi Input 与可选原生 Editor，DetailAction 通过 input 提供当前提示和异步提交函数；BrowserView 与 DetailsView 在底部打开输入，不关闭原视图、不改变原阅读焦点。Subagents 的消息使用 Editor，多行原文、光标、粘贴和撤销状态在成功发送或显式取消前保留；失败可重试，等待期间不能重复发送或用另一次打开替换请求。注入的 KeybindingsManager 处理发送/换行，原生组件持有文字和方向键；Esc 取消编辑，空白提交不发送，已经交给 Manager 的请求不因 Esc 被取消。结果/错误在本视图底部显示，下一次操作清除；领域提交函数再次核对归属与所选 run。字段与反馈先清理字面量再配色，成功发送不会把 paused reader 强制跳到底部。

## 查看器底部与退出

DetailsView 的可选 bottom/title 布局使 Subagents 会话直接从正文开始，底部最多两行显示所选 run 的名称、状态、运行时间、模型/thinking、token、工具次数与阅读状态；`d` 保留完整 ID、权限、来源和错误。信息区按实际一/两行与分隔线分配高度，余行归还正文，不保留信息栏内部空行。正文只测量一次，updateLayout 结算跟随/钳制后更新位置元信息；行数发生变化时最多再校正一次预算，不重复渲染整份 Transcript。全文输出仍填足 readingRows，正文/信息/操作区各有分隔线，编辑与底部栏优先计入实际高度，长 Editor 围绕光标显示有界窗口。此布局不调用 setFooter，也不复制或重建第三方 footer。

ViewerNavigation 通过显式 `back`/`close` 结果贯穿列表、会话、所属 Jobs、模型/调度/workflow 与详情。Esc 逐层返回，300ms 内两次无修饰 Left 关闭整个 Jobs/Subagents 浏览链；每个组件拥有自己的待判按键，其他按键或关闭重置，不继承 Dock 进入按键。可识别的 repeat/release 不计第二次，传统终端不保证识别所有长按。文字编辑/搜索优先，其后是明确接管的 PTY，最后是浏览导航；关闭只释放本视图的订阅、计时器与焦点，不停止执行。

## 展示文本精简

标题、导航、状态摘要和折叠工具正文通过公共展示层按实际焦点/动作生成；Tasks 的 Dock 选择与详情标题不重复只读标签，`Enter view` 保留查看语义。名称、状态、必要数量与操作优先，机器 ID 和完整配置留在可读详情中；工具摘要采用调用/结果接替，不重复输出。workspace 历史权限、危险动作确认、错误全文及用户/工具原文继续完整保留，精简不会修改协议结果、任务数据或控制准入。

界面说明当前操作、状态、数据、权限和错误；完整功能要求、渲染预算、实现保证与模型控制规则放在模块文档和必要注释中。文案在具体展示生成点收敛，不按长度、数字或英文术语机械过滤，不使用全局过滤器。快捷键、设置范围与来源、协议版本告警、日志、工具结果与模型专用 description/promptGuidelines 保留；用户主动查看的 agent 定义、系统提示词和 workflow 脚本不因界面精简而改写。

## 浏览器配色角色

browser-chrome.ts 统一定义 BrowserView 与 DetailsView 的语义角色，领域页面只提供状态和内容；使用回调传入的 Pi Theme，颜色随主题改变，不在页面生成 ANSI。SelectList 保持原生身份与滚动，通过 getSelectListTheme 的 selectedText 回调为完整可见选中行添加背景，并在原生 layout/truncatePrimary 后处理状态样式；字面量清理先于可信配色。

| 角色 | 位置 | Pi 主题样式 |
| --- | --- | --- |
| 标题 | 命令 ▸ 页名、详情标题 | accent + bold |
| 活动区域 | List/Details 标题与 Filter/Search/Input 提示 | ▸ + accent + bold，标题横线 accent；非活动标题 muted |
| 当前页签 | 选中页面标签，无方括号 | selectedBg 背景 + bold |
| 可切换项 | 未选中页签、筛选其他选项 | muted |
| 筛选当前值 | Scope/State 等当前值，无方括号 | accent + bold |
| 按键 | 导航/动作键、页签编号、控件标签中的键 | warning + bold |
| 按键说明文字 | 键后的英文动作名 | dim |
| 选中行 | 当前记录 | 列表拥有焦点时 selectedBg + bold、行首标记 accent；非活动时只保留 muted 标记及记录原色 |
| 记录状态 | running/starting；waiting/stopping/queued；failed/limited/timed_out；completed/stopped | success；warning；error；dim |
| 类型与任务状态 | enabled/disabled；todo/doing/blocked/done | success/dim；accent/success/warning/dim，done 删除线 |
| 危险动作 | x 与二次确认 | error，其他二次确认 warning |
| 状态行 | 页面及选中名称；范围/筛选/计数/ID | text；muted |
| 内联反馈 | 消息提交结果/发送中；错误；新输出提示及 End 键 | muted；error；dim + warning/bold |
| 内部分隔线 | 非活动标题线、列表与底部、左右分栏 | borderMuted |

正文过滤和详情搜索独占文字输入，说明随焦点切换；DetailsView 的阅读与动作提示复用相同按键角色，80 列起可按原生宽度换行。BrowserView 的底部两行独立截断，空结果不隐藏导航。



Pi 全屏文本拖选使用宿主共享剪贴板通道；tmux/SSH 的能力与操作条件见 [终端复制](terminal.md)。

公共 selectValue 复用 Pi 原生 SelectList 与主题，按终端高度限制可见选项，支持宿主注入 keybindings 的选择和分页，并声明 capturesViewportInput；可选过滤模式组合 Pi Input 与 fuzzyFilter，输入焦点交给原生光标，resize 保留查询和选择。值和显示标签独立，长行只在显示时截断。agent 模型与 thinking 使用该选择器；临时关闭并重开 DetailsView 时可以沿用同一 ScrollView，保留滚动与搜索状态。

[返回当前文档](../index.md)

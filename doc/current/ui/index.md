# 统一界面

`src/ui` 提供各模块共用的界面组件。领域模块只提交数据（行、状态、详情正文、动作），布局、配色与按键由这些组件处理。

| 组件 | 文件 | 用途 |
| --- | --- | --- |
| `Dock` | dock.ts、dock/ | 唯一常驻 widget，键为 `pi-suite:dock` |
| `StatusPublisher` | status.ts | 写入 footer 状态槽位，提交 Agents/Jobs 的 Dock 行 |
| `PresentationTicker` | ticker.ts | Dock 运行时间的每秒刷新 |
| `elapsedText`、`countText` | format.ts | 运行时间与 token 数的紧凑格式 |
| `openReading` 等 | reading.ts | 阅读 overlay 的尺寸与页面交接 |
| `DetailsView` | details.ts | 标题、滚动正文、底部信息与动作 |
| `BrowserView` | browser.ts、browser-chrome.ts | 列表加详情的浏览器 |
| `ScrollView` | scroll.ts | 继承 Pi ScrollView 的阅读窗口与搜索 |
| `ActionBar`、`InlineInput` | actions.ts、inline-input.ts | 按键动作、二次确认与底部输入 |
| `selectValue` | select.ts | 值选择器 |
| `TerminalView` | terminal.ts | PTY 屏幕视图，操作见 [执行任务](../jobs/index.md#终端视图) |
| `Transcript` | transcript.ts | 用 Pi 原生组件显示会话记录 |
| `toolRenderers` | tool-render.ts | Suite 工具的调用与结果显示 |
| 命令高亮 | rendering/ | 见 [命令结构高亮](command-highlighting.md) |
| 主题 | `themes/oh-my-pi.json` | 见 [Oh My Pi 参考主题](themes.md) |

## Dock

### 分区与行

模块用 `dock.register(id, source)` 注册分区。`DockSource` 的字段：

| 字段 | 作用 |
| --- | --- |
| `title` | 分区标题，粗体 accent |
| `rows(selectedId?)` | 返回本分区的行。Dock 处于选择状态且选中行属于本分区时传入该行 ID，来源可以围绕它展开 |
| `gapHints` | 默认 true。false 时 Dock 不生成折叠提示行，来源自己提供溢出行（Tasks 使用） |
| `summary` | 单行摘要的正文；缺省时用优先级最高的行 |
| `subtitle` | 标题后的 dim 文字，选择提示出现时让位 |
| `aside` | 标题右侧对齐的文字，例如状态计数 |
| `footer` | 尾线后的 dim 文字 |
| `progress` | 0–1 的完成比例，用于树形线配色 |
| `open(rowId, ctx)` | Enter 打开对象；也可以注册后用 `setOpen(id, open)` 接入 |
| `readOnly` | 选择提示显示 `Enter view` 而不是 `Enter open` |

`DockRow` 的字段：

| 字段 | 作用 |
| --- | --- |
| `id` | 稳定 ID；选择身份为分区 ID 加行 ID |
| `text` | 名称 |
| `priority` | 空闲时的保留顺序，也用于分区排序 |
| `parentId` | 父行。保留子行时连带保留父行，父子相邻 |
| `suffix` | 右对齐的完整指标 |
| `compactSuffixes` | 按省略顺序排列的较短指标 |
| `selectable` | false 时不参与选择，用于数量摘要和溢出提示 |

各分区的行：

| 分区 | 行内容 | 出现条件与优先级 |
| --- | --- | --- |
| Goal | 目标摘要，格式见 [目标操作](../goal/operations.md#状态显示) | 仅 `goal.display=dock`，优先级 90 |
| Tasks | 任务组与子任务，只展开焦点组，见 [任务操作](../tasks/operations.md#常驻摘要) | 自带溢出行（`gapHints:false`） |
| Agents | 每个 agent 一行，取其最新 run（含父级可见的待答问题）；被新 run 取代的旧失败 run 不占行。`名称 (modelId)`，modelId 为 `provider/` 之后的部分；右侧 `状态 · 运行时间 · ↑输入 ↓输出 · N tools`，窄时依次退为 `状态 · 运行时间 · N tools`、`状态 · 运行时间`、`状态`。待父级回答时状态为 `waiting(parent)`；等待自动恢复的排队 run 在状态后附 dim 的 `retry N/M`；排队与未启动的运行时间为 0 | 最新 run 为活动记录（queued、starting、running、waiting、stopping）或未消费的 failed/limited。优先级：待答问题 100，失败 80，stopping 75，其他 25，queued 15 |
| Jobs | job 显示名；右侧 `状态 · exit N（或 signal） · 运行时间 · 模式`，按需追加 `cleanup pending/unconfirmed`、`events N`；窄时退为状态加 cleanup，再只留 cleanup 或状态 | 活动 job、cleanup pending/unconfirmed、未通知的 failed/timed_out。优先级：cleanup 100，失败 80，stopping 75，其他 20 |

Agents 标题右侧按本分区对象统计状态数量，顺序为 starting、running、waiting、waiting(parent)、stopping、queued、failed、limited，例如 `2 running · 1 queued`；当前父级可见的 workflow 问题也计入。机器 ID 只出现在查看器详情和模型工具正文中。名称、状态和指标是分开的 `DisplayField`（`browser-chrome.ts` 中带 `state` 或 `tone` 的文本片段），状态色只作用于状态字段，名称中出现相同单词不会被染色。

### 布局

1. 收集有行的分区，按 Goal → Tasks → Agents → Jobs → Workflows 排列，未列出的分区排在最后；分区内保持来源给出的顺序。
2. 分配行数：首选分区是选择状态下的选中分区，否则是可见的 Tasks；其余分区按各自最高的行优先级排序。排序后前 N 个分区（N 为预算行数）各得 1 行，首位分区再得到剩余的全部行，排在 N 之后的分区不显示。
3. 每个分区按得到的行数 L 选择形式：
   - 选中行在本分区且 L=1：一行 `标题 [ ] Enter/Esc ↑N ↓N · 选中行`，空间不足时截短标题。
   - 未选中、只有一行、有 aside 且 L≥2：标题行加对象行。
   - 未选中且只有一行或 L≤3：单行摘要 `标题 · 摘要`，aside 右对齐。
   - 其他：标题行、窗口内的行，L≥4 时末尾加尾线 `└─────` 及 footer。标题与尾线计入 L。
4. 窗口选行（`dock/rows.ts` 的 `dockWindow`）：未选择时按 priority 从高到低加入；选择时按与选中行的距离由近到远加入。加入子行时连带父行，加入后超出容量就撤回。
5. 折叠提示：`gapHints` 未关闭时，在被省略的同级片段原位插入 `↑ … N more items`（片段在开头）、`↓ … N more items`（在结尾）或 `↕ … N more items`（在中间），提示不可选、显示为 muted。片段只有一行时直接显示该行，因为提示也占一行。选中行连同父行和提示放不下时只显示选中行，标题右侧显示 `↑N ↓N`，即其前后隐藏的行数。

宽度不小于 40 列时绘制树形线：根行前缀 `├─ `，子行前缀 `│    `，尾线 `└─────`；小于 40 列不画。来源提供 `progress` 时，按阅读顺序前 `round((显示行数 + 1) × progress)` 段树形线为 accent，其余为 borderMuted。

每行不换行，按 Pi 的可见宽度截断。右侧指标由 `dock/line.ts` 的 `executionRow` 布局：有 `compactSuffixes` 时先为名称保留 `min(8, 名称宽度) + 1` 列，再从完整指标起选第一个放得下的版本，都放不下时截断最短的版本；名称在剩余宽度内以 `…` 截断。截断只影响显示，不改动数据。

## Dock 键盘进入

| 按键 | 行为 |
| --- | --- |
| ← | 进入选择，选中上次的对象或第一项 |
| ↑ / ↓ | 在所有可选行间按显示顺序移动，到两端停止 |
| `[` / `]` | 跳到上一个/下一个有可选行的分区的第一行，循环 |
| Enter | 退出选择并打开所选对象：任务只读详情、agent Transcript、workflow 运行详情或 job 命令/输出查看器 |
| Esc / → | 退出选择，按键不传给编辑器 |
| 其他按键 | 退出选择，按键照常交给编辑器 |

- 可选行：来源提供 `open` 且 `selectable` 不为 false 的行。Tasks 为 `readOnly`，Enter 只打开查看，见 [任务操作](../tasks/operations.md)。
- 以下情况 Dock 不接管按键并退出选择：编辑器非空、焦点不在编辑器、补全菜单打开、询问或详情打开、Dock 预算为 0。没有可选行时 ← 照常交给编辑器。
- 焦点通过宿主公开的 `getFocusedComponent` 读取。具有 `getText`/`setText` 方法的组件视为编辑器，所以可替换的编辑器也能识别；编辑器的 `capturesViewportInput` 为 true 表示补全占用导航。
- 按键释放事件不触发操作；按住产生的重复事件照常移动。
- 监听在会话绑定时注册、解绑时注销；reload、会话切换和树切换都清除选择。
- 刷新重排时保持所选对象。所选行消失时选中原位置的下一项，原来是末项则选前一项；选中行因此移到另一组时，Dock 用新的选中 ID 重新取行再绘制。
- 选中行使用 selectedBg 背景和粗体，树形前缀、名称起始列和指标宽度与未选中时相同。
- 选择时标题显示 `↑↓ select · [ ] section · Enter open · Esc back`（只读分区为 `Enter view`）；放不下时显示 `[ ] Enter Esc` 并截短标题，aside 保留。未选择时不显示提示。
- Enter 先退出选择，再异步调用 `open`；打开失败以错误通知显示。会话已经切换时不再打开。关闭查看器后再按 ← 回到上次的对象，同一绑定内一直保留。

## 高度与状态

### Dock 预算

记终端高度为 H，footer 估计高度为 F：基础 2 行，本包写入了 footer 状态时为 3 行。空闲 Dock 的预算为：

```
clamp(floor(H/2) − 1 − 3 − F, 0, ui.maxRows)
```

即为 Pi 的空行、三行编辑器和 footer 留出位置，聊天区至少保留一半高度。`ui.maxRows` 默认 12，范围 1–30。例如 H=24、F=2 时预算为 6；H 低于 18 时预算不超过 2 行，未选择时各分区都显示单行摘要；预算为 0 时 Dock 不显示。

编辑器多行输入和第三方 footer 换行后的实际高度无法从公开扩展接口获得，所以预算使用上述估计。fullscreen 模式下 Pi 的 VStack 压缩其他区域，inline 模式下聊天向上推。

询问或独立详情打开时 Dock 不输出任何行并退出选择，关闭后恢复。

### 询问高度

询问的高度上限为 `max(1, floor(0.7·H) − 1 − F)`（`Dock.askBudget`），与 `ui.maxRows` 无关。实际高度取整批题目与 Review 中最高的内容，不补到上限。History 与全文阅读使用 `max(4, floor(0.8·H))`。正常询问为圆角 border 色外框，标题、requester、heading、页码与空闲时间嵌在上边框中。其余布局规则见 [询问操作](../ask/index.md#操作)。

### 状态发布

`StatusPublisher` 通过 `ctx.ui.setStatus` 写两个 footer 槽位：`goal` 与 `pi-suite:runtime`。`goal.display`、`agents.display`、`jobs.display` 各自取下列值：

| 值 | footer 状态 | Dock |
| --- | --- | --- |
| `status`（默认） | goal 写目标摘要；agents/jobs 的数量合并写入 `pi-suite:runtime`，格式 `🤖N · ⚙M`，为 0 的项省略 | 显示该分区的详细行；Goal 不进 Dock |
| `dock` | 不写 | Goal 显示目标摘要行；Agents/Jobs 有活动对象且分区没有 aside 时增加一行不可选的 `N active`（优先级 70） |
| `hidden` | 不写 | 不显示 |

- Agents 数量统计当前会话可见的执行中记录，不含 queued；Jobs 数量使用 [会话可见集合](../jobs/index.md#会话可见集合) 中的活动 job。
- 只有本次激活创建了 GoalManager（goal 模块启用）时才写入和清除 `goal` 槽位；goal 模块关闭时，绑定、重绑、reload 和 quit 都不动其他扩展写入的 goal 状态。
- footer 状态只在文本变化时重写。数量不变但行内容或 aside 变化（运行指标、状态计数、问题、清理状态）时只重绘 Dock。
- 解绑时清除 `pi-suite:runtime`、本次持有的 `goal` 槽位和全部 Dock 行。
- 目标摘要的内容、图标和计时由 goal 模块生成，见 [目标操作](../goal/operations.md#状态显示)。

### 计时刷新与格式

Agents 与 Jobs 各用一个 `PresentationTicker`：存在活动对象且该分区不是 hidden 时，每秒用内存中的 Manager 快照重新发布 Dock 行。刷新不读历史文件或日志，不追加会话记录，不投递通知；分区隐藏、解绑或没有活动对象时停止。运行指标的其余更新来自 Manager 订阅。

`format.ts` 的格式都向下取整，计时器不会提前进位：

| 函数 | 规则 | 示例 |
| --- | --- | --- |
| `elapsedText` | 只显示已完成的单位，最多两段 | `45s`、`12m05s`、`3h07m`、`2d04h` |
| `countText` | 千、百万、十亿用 k、M、B，最多一位小数 | `999`、`1.2k`、`12k`、`999.9k`、`3.4M`、`1B` |

`elapsedText` 用于 Dock 的 Agents/Jobs 行、Runs 列表（排队记录显示 `<时间> wait`）、job 列表与查看器状态行，以及 Subagent 底部信息栏；`countText` 用于 Dock Agents 行与 Subagent 底部信息栏。模型工具正文、详情与通知使用精确 token 数和一位小数秒。

### pi-starship footer

Pi 原生 footer 读取 `goal` 槽位。`@narumitw/pi-starship` 0.65.2 通过 `extension_status` 模块读取同一槽位，格式和数量上限由其配置决定：

- 根 `format` 缺少 `$extension_status` 或该模块 disabled 时看不到摘要；可以改用 `goal.display=dock`，或用 hidden 隐藏。
- `max_statuses` 按扩展状态的插入顺序截取，较早的第三方状态可能挤掉 goal/runtime。
- `extension_status.icons` 中不给 goal 固定值即保留本包的动态图标；`icons = { "pi-suite:runtime" = "", fallback = "" }` 保留 goal 图标与数量文本，并隐藏普通状态默认的插头图标。外部模块设置可能报告字段校验警告。
- 窄屏时整个 format 自动换行，公开接口拿不到外部 footer 的总高度。

pi-starship 自身的用法：

- `git_status` 使用 Git 上游跟踪分支的缓存差异：`⇡N` 为本地领先 N 个提交，`⇣N` 为落后，两者同时出现表示分叉。`$all_status` 汇总文件改动，`$ahead_behind` 显示提交差异，只移除后者即可隐藏提交数量。显示依赖已有上游引用，不实时查询远端。
- 简洁布局：`[git_branch]` 设 `symbol = "git "`，`[git_status]` 设 `ahead = "↑$count"`、`behind = "↓$count"`、`diverged = "↑$ahead_count ↓$behind_count"`，根 format 包含 `$git_branch$git_status`，显示为 `git main ↑7 ↓2`，箭头只在数量非零时出现。
- 活动配置为 `<getAgentDir()>/pi-starship.toml`，命名配置在同级的 `pi-starship/profiles/`。保存或外部编辑 profile 后，经 `/starship` → Profiles → 名称 → Apply 应用。外部修改活动配置后执行 `/reload`，用 `/starship status` 查看运行时配置告警；语法校验通过不代表 footer 已更新。
- simple 布局的 `[[context.display]]` 使用 `threshold = 0`、`hidden = false` 和对应样式，可显示低于 30% 的上下文占用。

## 原生会话查看

`/tasks`、`/jobs`、`/subagents`、`/goal`、`/suite` 及其详情、日志和终端视图使用本节的公共组件。各命令的加载时机见 [加载与首次就绪](../runtime/index.md#加载与首次就绪)；工具与历史 renderer 在 factory 中提前注册，不等首次使用。

### 阅读 overlay

`reading.ts` 的 `openReading` 通过 `ctx.ui.custom` 打开 focused overlay，不另建终端渲染器，也不替换主会话的 layout root。`showDetails`、`browse`、agent 查看器、workflow 运行详情、job 命令/输出查看器、PTY attach 与 job 日志都经由它打开。

| 条件 | overlay 选项 | 高度上限 `readingRows` |
| --- | --- | --- |
| `tui.mode` 为 fullscreen，或处在 `withReadingScreen` 范围内 | top-left、width 100%、maxHeight 100%、margin 0 | 终端行数 |
| 其他 | center、width 90%、maxHeight 70%、margin 0 | `max(1, floor(0.7 × 终端行数))` |

- Pi 只在打开时求值选项回调；百分比由 TUI 每次渲染时按终端尺寸换算，所以 resize 后 overlay 与 `readingRows` 一致。
- overlay 按组件输出的行数覆盖画面。组件用 `readingWindow` 自行切片并补空行；全屏时 `openReading` 把输出补足到 `readingRows`，覆盖模型选择和主 footer 所在的行。
- 关闭时释放 overlay、调用组件的 `dispose`，恢复原焦点与主会话视口。
- DetailsView、BrowserView、TerminalView 与 selectValue 声明 `capturesViewportInput`，fullscreen 下 PgUp/PgDn 等视口键交给它们。

页面交接：Subagents 根命令用 `withReadingSession` 包住整个浏览链（页签、列表、消息历史、所属 Jobs、详情、选择器）；消息阅读用 `withReadingScreen` 在同一会话内改为全屏尺寸。会话内切页时：

1. 旧页结束前，先用其最后一帧（去掉光标标记）装一个吞掉全部输入的冻结 overlay，再调用 `done`。冻结帧 resize 时沿用旧页的高度策略，不露出主 footer。
2. 新页构造并挂载后（`onHandle`），移除冻结帧。
3. 工厂在返回组件前已经结束时，由 `openReading` 调用该组件的 `dispose`。
4. 最外层退出或构造失败时释放冻结帧与作用域，恢复原焦点、原 footer 实例和最新状态。

selectValue 在阅读会话中也经 `openReading` 打开，否则会落在冻结帧之下。

### 公共框架

每个视图上下各有一道 border 色横线（`frame.ts` 的 `commandFrame` 复用 Pi `/settings` 的 DynamicBorder），调用方在高度预算中扣除这两行。DetailsView、BrowserView 与 JobView 先扣除标题、输入和底部栏的行数，再用公开的 VStack/HStack 组合已限高的输出，不依赖宿主替嵌套正文布局或分派鼠标。

DetailsView（`details.ts`）：

- 结构自上而下：边框、可选标题行、正文、可选底部信息（分隔线加 1–2 行）、分隔线、按键说明或输入、边框。
- 标题行显示标题、阅读位置 `行/总行` 和新输出提示。`title:false` 时省略标题行。
- 按键说明：`←← close`（有 `navigation` 时）`· Esc back ·` 可用动作 `· ↑↓ PgUp PgDn Home/End scroll · / search · n/N next`。宽度不小于 80 列时按宽度换行，更窄时截断为一行。
- 正文每次渲染只测量一次；`updateLayout` 结算跟随与边界后重新读取底部信息，行数变化时最多再校正一次。
- `showDetails(ctx, dock, title, content, format)`：content 为字符串时，`markdown`（默认）用 Pi Markdown 显示，`text` 用 Pi Text 显示清理后的字面量；为 [结构化详情](#结构化详情) 时按角色着色。非 TUI 模式改为通知，结构化详情转为无色文本。打开期间 Dock 让位。BrowserView 预览的 `details` 回调同样可返回结构化详情。

ActionBar（`actions.ts`）由 DetailsView、BrowserView 与 TerminalView 共用：

- 每个 `DetailAction` 声明 key 和 label，可带 `available` 条件和 `confirm`。按显示的键直接执行，没有动作光标。
- 多个动作可以共用一个键，前提是同时只有一个可用（例如 Pause/Resume）。
- 需要确认的动作第一次按键只显示 `Press <key> again to <action> · any other key cancels`，同一键再按一次才执行；其他按键、切换记录或焦点离开列表都取消确认。`x` 的提示为 error 色，其他为 warning 色。
- 搜索与输入期间文字键交给输入框，不触发动作。

### ScrollView

`scroll.ts` 的 `ScrollView` 继承 Pi 公开的 ScrollView（`follow: 'end'`、`scrollbar: 'hidden'`、`overscroll: 'contain'`），原生 `scrollTop` 是唯一的偏移。隐藏滚动条不创建滚动条计时器。

- `viewport(width, height)` 按宽度渲染正文一次，`updateLayout` 更新内容与视口高度，再按 `scrollTop` 切片并补足行数。搜索只索引渲染出的行，不保存第二个偏移。
- 默认从顶部开始且不跟随；构造时传入 `following=true` 则从底部开始跟随。Subagent 查看器的初始位置见 [子代理操作](../agents/operations.md)。
- 布局变化（resize、正文变短）引起的边界收缩保留用户的暂停，不会重新开启跟随。
- `setContent` 替换正文组件时保留跟随状态和位置。

| 按键 | 行为 |
| --- | --- |
| ↑ / ↓ | 滚动一行 |
| PageUp / PageDown | 滚动一屏 |
| Home | 到顶部并停止跟随 |
| End | 到底部并恢复跟随，清除新输出提示 |
| `/` | 停止跟随并打开搜索框，Enter 提交，Esc 退出 |
| n / N | 下一个/上一个匹配，不区分大小写，循环查找 |

离开底部（向上滚动、Home、搜索）即停止跟随，回到底部或按 End 恢复。来源报告新输出且未跟随时显示 `↓ new output · End to follow`，窄时缩为 `↓ End`。只有新输出才触发提示，尺寸变化或展开工具不触发。job 日志的字节窗口由日志查看器管理，`f` 与 End 使用同一跟随状态，见 [日志视图](../jobs/index.md#日志视图)。

### BrowserView

`browser.ts` 的 `BrowserView` 是 agents、jobs、tasks 的列表框架，由 Pi Input、fuzzyFilter、SelectList、Text 与 ScrollView 组成。领域模块提供 `BrowseItem`（稳定 value、显示文字、可搜索文本、状态、详情），筛选在这份数据上进行。

页面结构自上而下：

1. 边框。
2. 标题行 `<命令> ▸ <页名>`，多页时后接页签 `1 名称  2 名称`；放不下时页签只留数字，再放不下就省略页签。
3. 控件行：每个 `BrowseControl` 显示为 `标签 (键): 选项 · 选项`，一行放不下时每个控件一行，再放不下时只显示当前值和 ` ›`。
4. 过滤行 `▸ Filter:`（过滤中或有保留的查询时）。
5. 状态行：页名、范围、控件当前值、`/查询`、`匹配数/总数`、选中对象 `名称 (ID)`。窄于 80 列时页名和选中对象移到最前。
6. 正文：不小于 80 列时左右分栏，列表宽 `min(52, floor(0.45 × 宽度))`，中间为 `│` 分隔；更窄时上下排列，详情有焦点时列表只占 2 行，否则占一半。
7. 分隔线、导航行、动作行、边框。底部这两行各自按宽度截断，不换行。

焦点只有 list、details、filter 三种，默认 list：

| 焦点 | 按键 |
| --- | --- |
| list | ↑↓/PgUp/PgDn 选择；Enter 打开所选对象；Tab 进入详情（无详情时不动）；`/` 进入过滤；控件键循环并立即应用该控件；数字键 1–9、`[`、`]`、→ 切页，非首页时 ← 也切到上一页；Esc 先清空查询，没有查询时关闭或返回；其他字符不进入过滤 |
| details | 滚动与搜索同 ScrollView；Tab/Esc 回到列表；Enter 打开 |
| filter | 输入文字即筛选；↑↓ 仍选择；Enter/Tab 保留查询回到列表；Esc 清空并回到列表 |

- 活动区域的标题为 `▸`、accent、粗体并带 accent 横线；非活动标题为 muted，横线为 borderMuted。选中背景只在列表有焦点时显示；离开列表后保留对象身份和状态色，正文不变灰。
- 过滤、详情搜索和底部输入分别以 `▸ Filter:`、`▸ Search`、`▸ Input` 标示，原生输入组件持有唯一光标；保留但未激活的查询不显示光标。
- 导航行按焦点显示：list 为 `←← close`（有 `navigation` 且在首页时）、Esc 动作、切页键、控件键、`/ filter`、`Tab details`；details 为 `Tab/Esc list · ↑↓ PgUp PgDn scroll · / search · n/N next`；filter 为 `Type to filter · ↑↓ select · Enter keep · Esc clear`。窄屏从右侧截断。
- 动作行：有待确认动作时显示确认提示；没有记录时显示空状态提示；否则为 `Enter open`（页面可改动作名）和当前记录的可用动作。
- 空状态提示由框架生成，依次尝试：有查询时 `No matches · press Esc to clear filter`；有带 All 选项且未选 All 的控件时 `No <当前值> <页名> · press <键> for All (<数量>)`，例如 `No queued runs · press s for All (10)`；有多选项控件时提示下一个选项；有其他页面时提示该页数字键；否则 `press Esc to close`。列表正文与动作行显示同一提示，导航行照常列出全部控件。
- 页面可通过 `selection` 提供状态行的名称与 ID，通过 `total` 提供领域筛选前的总数，通过 `scope` 提供固定范围标签（如 Run subtree）。
- 选中身份为 `BrowseItem.value`，重名、状态变化和显示截断都不改变它；每条记录保存独立的阅读与搜索位置。每页有自己的 `BrowseState`，往返时保留查询、选中对象和焦点。
- SelectList 的 `layout`/`truncatePrimary` 用于保留记录的状态与时长、类型的启用状态、模型名与 thinking；完整数据不被截断。
- 订阅事件在 40 ms 内合并为一次渲染；页面提供 `ticking` 时每秒重绘以更新时长。`dispose` 释放订阅、计时器和各记录的 reader。
- 浏览期间 Dock 让位。
- 各页的按键与范围见 [子代理操作](../agents/operations.md)、[job 列表](../jobs/index.md#jobs-列表) 和 [任务操作](../tasks/operations.md)。

### 输入与选择

`InlineInput`（`inline-input.ts`）在 BrowserView 或 DetailsView 底部打开输入，不关闭原视图，也不改变原阅读焦点。`DetailAction.input` 提供提示文字和异步提交函数。

- 单行请求用 Pi Input，提交前去掉首尾空白；多行请求用 Pi Editor（`viewer/editor.ts` 的 `ViewerEditor`，高度受限时围绕光标显示可见行）。
- 发送与换行键读取注入的 KeybindingsManager（`tui.input.submit`、`tui.input.newLine`），提示行为 `<键> send · <键> newline · Esc cancel`。
- 空白提交直接关闭输入，不发送。发送期间显示 `Sending…`，不能重复发送，重新打开只显示进行中的请求。
- 成功后关闭输入并在底部显示返回文字；失败时保留原文、光标与撤销状态，错误显示在提示行前，可以重试。下一次按键清除反馈。
- Esc 关闭输入；已经提交的请求不会因 Esc 取消。
- 字段与反馈先清理字面量再配色。

`selectValue`（`select.ts`）是 Pi SelectList 加可选 `Filter:` 输入的值选择器：

- 可见行数为可用高度减 6（有过滤再减 1），可用高度在阅读会话中为 `readingRows`，否则为终端行数；resize 后保留查询与选中项。
- 确认、取消、上下（循环）与翻页键读取注入的 KeybindingsManager，底部提示显示实际键位。没有匹配时显示 `No matching items`。
- 过滤匹配值、标签与说明。值与显示标签分开，长行只在显示时截断。
- 有 `navigation` 且没有过滤框时，←← 关闭整个浏览链。
- agent 模型与 thinking 选择使用它；临时关闭再重开 DetailsView 时可传入原 ScrollView，保留滚动与搜索。

### Transcript

`transcript.ts` 的 `Transcript` 是一个原生 Container，用 Pi 的 UserMessageComponent、AssistantMessageComponent、ToolExecutionComponent、CustomMessageComponent、BashExecutionComponent 和压缩/分支摘要组件显示会话记录，不把全文转成字符串。

- 工具 renderer 依次取调用方提供的 lookup（child 的实际定义或 Suite 登记的 renderer）、Pi 内置工具（read、write、edit、bash、powershell、grep、find、ls）；都没有时使用 Pi 通用工具显示。
- 调用与结果按 toolCallId 配对，不执行工具。结果所在分支的调用已被压缩时，单独为结果建立工具组件。
- 未变化的 entry 复用组件及其宽度缓存；ID 以 `stream:` 开头的流式 entry 更新已有的消息与工具组件，保留各自的展开状态。
- custom message 使用宿主登记的消息 renderer（如 `pi-suite:notification`、`pi-suite:job-screen`）；custom entry 有登记的条目 renderer 时由它渲染，没有时不显示。两者都随展开状态切换。renderer 来源由调用方以 `TranscriptRenderers`（宿主的 getMessageRenderer/getEntryRenderer 加 Theme）传入。
- `toggleTools` 切换全部工具、摘要与 custom 内容的展开，`toggleThinking` 切换 thinking 显示。工具输出不显示终端图片，outputPad 为 0。

## 查看器底部与退出

DetailsView 的 `bottom` 回调提供 1–2 行底部信息，DetailsView 按实际行数分配高度，多余的行归还正文；不调用 `setFooter`，不替换原生或第三方 footer。Subagent 会话使用 `title:false` 与 `viewer/agent-information.ts` 生成的信息：

- 第一部分：`名称 · 状态 · 运行时间 · ↑输入 ↓输出`，只读时追加 ` · read only`。宽度不足时先去掉 token 与只读标记，再只留状态。
- 第二部分：`模型 · thinking <级别> · N tools · 位置 · following|paused`，有新输出时追加新输出提示。宽度不足时先去掉工具次数，再截断模型名。
- 两部分放得下时合并为一行。完整 ID、权限、来源和错误在 `d` 详情中。
- 多行 Editor 打开时，编辑区与底部栏优先计入高度，正文让出剩余行。

退出导航（`viewer/navigation.ts`）：

- `ViewerNavigation` 记录一条浏览链的结果，`back` 返回上一层，`close` 关闭整条链（列表、会话、所属 Jobs、模型/调度/workflow、详情）。
- Esc 逐层返回。300 ms 内两次无修饰的 ← 关闭整条 Jobs/Subagents 浏览链（`DoubleLeft`）；每个组件单独计算，进入子页不继承上一页的第一次 ←，其他按键或关闭都会重置。按键释放与可识别的重复事件不计为第二次，传统终端不保证能识别所有长按。
- 按键优先级：文字编辑与搜索、已接管的 PTY、浏览导航。关闭只释放本视图的订阅、计时器与焦点，不停止任何执行。

## 工具正文

`tool-render.ts` 的 `toolRenderers(view)` 为 Suite 工具生成 `renderCall`/`renderResult`：

- 结果到达前显示调用摘要行（`view.call`）。第一个部分或最终结果到达后隐藏调用行，只显示结果摘要（`view.collapsed`）。
- 背景、外壳与 outputPad 由 Pi 默认 Box 负责，正文不画横线。主会话中的单项鼠标展开与默认 Ctrl+O 全部展开由 Pi 管理。
- 展开内容由 `view.expanded` 返回，可以是字符串（字面量）、`ToolLine`、`ToolField`（`标签: 值`）、`ToolCode`、`ToolCommand` 或组件；未提供时显示结果全文。
- `ToolCode` 用给定 language 或从 path 推断的语言调用 Pi 原生高亮，推断不出语言时按字面量显示；`ToolCommand` 使用 [命令结构高亮](command-highlighting.md)。
- 错误时摘要为 `✘ <调用标题>`：折叠时附诊断首行，展开时在下方以 error 色显示完整诊断，摘要只保留 `view.error` 提供的标签。`view.error` 可给出独立于模型正文的诊断。`view.redact` 在展开和错误显示前替换敏感字段。
- `toolRenderers(view, {timing})` 在摘要行右侧以 dim 显示时长：执行开始后每秒刷新实时计时，结束后显示宿主记录的执行时长。wait 使用 `elapsedText`。
- 所有字段先经 `sanitizeText` 清理再配色；状态图标见 [模型工具契约](../runtime/tools.md)。

内置 bash/powershell 调用区的高亮装饰原生 renderer，受 `ui.highlightBuiltinCommands` 控制，见 [命令结构高亮](command-highlighting.md#入口与范围)。

## 界面文本

- 界面只显示当前操作、状态、数据、权限和错误；功能要求、渲染预算和实现保证写在模块文档与注释中。
- 名称、状态、必要数量与操作优先显示；机器 ID 和完整配置放在可读详情中。工具结果由调用摘要接替，不重复显示。
- 框架生成的提示使用英文；用户与工具的原文（标题、说明、错误全文、确认、workspace 历史权限）完整保留。
- 文案在各展示生成点收敛，没有全局过滤器。快捷键、设置范围与来源、协议版本告警、日志、工具结果与模型专用 description/promptGuidelines 不属于精简对象；用户主动查看的 agent 定义、系统提示词和 workflow 脚本按原文显示。

## 浏览器配色角色

`browser-chrome.ts` 定义 BrowserView 与 DetailsView 的语义角色，使用渲染回调传入的 Pi Theme，颜色随主题变化；领域页面只提供状态与内容，不生成 ANSI。SelectList 保持原生选中与滚动，选中行背景通过 `getSelectListTheme` 的 `selectedText` 回调加到整行，状态样式在原生 `truncatePrimary` 之后应用；字面量先清理再配色。

| 角色 | 位置 | Pi 主题样式 |
| --- | --- | --- |
| 标题 | 命令 ▸ 页名、详情标题 | accent + bold |
| 活动区域 | List/Details 标题与 Filter/Search/Input 提示 | ▸ + accent + bold，标题横线 accent；非活动标题 muted |
| 当前页签 | 选中页面标签，无方括号 | selectedBg 背景 + bold |
| 可切换项 | 未选中页签、筛选其他选项 | muted |
| 筛选当前值 | Scope/State 等当前值，无方括号 | accent + bold |
| 按键 | 导航/动作键、页签编号、控件标签中的键 | warning + bold；`x` 为 error |
| 按键说明文字 | 键后的英文动作名 | dim |
| 选中行 | 当前记录 | 列表有焦点时 selectedBg + bold、行首 `→` 为 accent；无焦点时只保留 muted 标记及记录原色 |
| 记录状态 | running/starting；waiting/waiting(parent)/stopping/queued/paused/cleanup pending/cleanup unconfirmed；failed/limited/timed_out；completed/stopped | success；warning；error；dim |
| 类型与任务状态 | enabled/disabled；todo/doing/blocked/done | success/dim；accent/success/warning/dim，done 加删除线 |
| 危险动作 | `x` 与其二次确认 | error；其他二次确认 warning |
| 状态行 | 页名及选中名称；范围/筛选/计数/ID | text；muted |
| 内联反馈 | 提交结果/发送中；错误；新输出提示及 End 键 | muted；error；dim + warning/bold |
| 内部分隔线 | 非活动标题线、列表与底部、左右分栏 | borderMuted |

记录状态只在字段边界上着色（行首、` · ` 之间，或紧跟 job/workflow ID 之后），名称里出现相同单词不着色。

### 结构化详情

`structured-details.ts` 的 `StructuredDetails` 是 Details 面板与预览共用的数据形式：页面只给出行与片段的角色，配色由组件决定。`rows` 的每项为字符串、片段数组、`null`（分组空行）或 `undefined`（省略的可选行）；`field(label, value, ...suffix)` 生成 `标签 值` 行。

| 片段角色 | 用途 | Pi 主题样式 |
| --- | --- | --- |
| heading | 对象名标题 | accent + bold |
| label | 字段标签 | muted |
| id | agent ID、run ID 等 | accent |
| meta | 来源标记、时间戳、路径 | dim |
| number | 数字、token 与费用 | toolOutput |
| error | 错误 | error |
| state（`statePart`） | 状态值 | 与记录状态同一 `stateTone`，另有 success/error |

- 片段先清理再按单词着色，空白处复位样式，避免 Pi 换行在长单词之间多出空行。
- 使用方：agent 详情、Types、Schedules、Workflows 进度、Jobs 与 Tasks 的详情。

## 复制与鼠标

Pi 全屏文本拖选使用宿主的剪贴板通道；tmux/SSH 下的条件见 [终端复制](terminal.md)。阅读 overlay 的鼠标能力见 [原生阅读与鼠标](terminal.md#原生阅读与鼠标)。

## 验证范围

Linux Pi 1.5.0 实际 CLI 在 24/30/40/60 行与 40/80/120 列下验证了 Dock 与询问的独立预算、溢出、询问覆盖与恢复、低于 18 行的摘要与紧凑回答，范围见 [底部布局专项](../../finished/pi-suite/ui/dock-ask-layout.md)。pi-starship 与原生 footer 的组合验收见 [验收记录](../validation.md)。

[返回当前文档](../index.md)

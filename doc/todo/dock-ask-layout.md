# 底部布局：Dock、询问与输入区

## 目标

- 放宽 Dock（tasks 等常驻摘要）与询问的高度限制，大屏能看到完整的任务进度与足够多的询问选项。
- 询问打开时直接覆盖 Dock 所在区域，不再与 Dock 争抢同一份高度预算。
- tasks 区、询问区、输入框与状态栏在同时出现时能一眼区分。
- 问题、背景、选项标题与说明在折叠显示时必须提供展开方式，保证用户始终可以看到全部信息。
- 体验优先，参考 oh-my-pi（omp）的实现；聊天内容在任意尺寸下仍保持可见。

## 当前状态

### tasks 只显示两行

- `src/tasks/index.ts` 的 `rows()` 只输出组行，以及 doing、blocked、处于完成反馈或作为当前子任务的子行。普通进度下只有“组 + 当前子任务”两行，与终端剩余高度无关。
- `src/ui/dock.ts` 的 `heightBudget` 规定：低于 28 行的终端上限 3 行，其他情况取 `min(6, 20%)`，再扣除本包在原生 footer 中的状态行。Dock 因此最多 5 行；`ui.maxRows` 的范围也只有 1–6（`src/runtime/config.ts`）。
- Dock 先按 priority 排序再输出，父级下的子行也沿用 priority 顺序，子任务不按任务顺序显示。

### 询问只显示一行选项

- 询问打开时，`dockAllowance()` 仍为 Dock 保留最多 2 行；存在任务时 `askBudget = budget − 2`。
- 询问的标题行与操作栏各占一行，剩余高度才给选项。

| 终端行数 | 空闲 Dock 上限 | 询问总高（存在任务时） | 选项行 |
| --- | --- | --- | --- |
| 24 | 2 | 1 | 0（只有回答行） |
| 30 | 5 | 3 | 1 |
| 40 | 5 | 3 | 1 |
| 60 | 5 | 3 | 1 |

### 区域分不清

- Dock 行是纯文本，没有标题、竖线或边界。
- AskView 通过 inline `ctx.ui.custom` 挂进 Pi 的 `editorContainer`，替换掉编辑器，也就替换掉了编辑器的上下边线。询问内容上接 Dock 行、下接 footer，中间没有任何分隔。

### 折叠信息的可见性

- 问题文本与 requester、heading、题型、页码挤在同一行，长问题被截断。
- 问题背景 `context` 不在 inline 视图中显示，只能通过 `d` 详情看到。
- 选项标题被截断为一行；窄屏下选项说明完全不显示，只能按 `d` 查看。
- 宽屏右侧预览固定为列表高度，长说明被截断且没有提示。
- Review 每题一行“题干: 答案”，长题干与长答案被截断，Review 中没有查看全文的入口。
- 现有 `d` / View details 打开的阅读视图包含问题、背景与当前选项的标题和说明（`src/ask/view.ts` 的 `openDetails`），不包含 requester 与 heading。

## 参考：omp 实现要点

来源为 can1357/oh-my-pi 的 main 分支。

| 区域 | omp 做法 | 位置 |
| --- | --- | --- |
| Todo | 无边框、无背景。先空一行，再写粗体 accent 的 `TODO` 标题；用 `├─`/`│` 树形竖线，以 `└─────` 收尾，竖线按完成比例染 accent。当前阶段之后最多再列 4 个阶段，当前阶段最多列 5 个未完成项和 1 个最近完成项，溢出显示 `… n more`；如果摘要只会藏掉 1 项，就直接显示这一项。低于 18 行时折叠为一行摘要；全部完成后延迟隐藏。 | `packages/coding-agent/src/modes/interactive-mode.ts`（`#renderTodoList`、`#formatTodoLine`）、`packages/tui/src/tools/todo.ts`（`selectCollapsedTodos`） |
| Ask 挂载 | 替换编辑器槽位，不使用浮层。源码注释说明了原因：贴底的浮层会遮住解释问题的聊天内容（“one anchored at the bottom covered the transcript rows that explain the question”）。 | `packages/tui/src/overlays/ask-dialog.ts`、`packages/coding-agent/src/modes/controllers/extension-ui-controller.ts` |
| Ask 外框 | 圆角框 `╭ ╮ ╰ ╯`，`border` 色；title 为粗体 accent，嵌在上边框中（`╭─ Ask ─╮`）；左右各留 2 列内边距；标题区、选项区、提示行之间用 `├┤` 分隔，无背景色。 | `packages/tui/src/chrome/overlay-box.ts` |
| Ask 高度 | 最多占终端 70%，至少 12 行；高度按最高的一页测量一次，只在终端缩放时重算；选项区在框内滚动。 | `ask-dialog.ts` 的 `DIALOG_HEIGHT_RATIO`、`MIN_DIALOG_ROWS` |
| Ask 折叠 | 问题文本最多 4 行并以 `…` 结尾；每个选项的说明以 muted 内联显示最多 2 行；expand 键取消这些上限。 | `ask-dialog.ts` 的 `MAX_HEADER_ROWS`、`MAX_DESC_ROWS` |
| 编辑器与状态栏 | powerline 状态带（`statusLineBg`），编辑器边线按 thinking 级别着色。 | `packages/tui/src/status-line/component.ts` |

## 方案

### 1. 高度预算

记终端行数为 H，F 为原生 footer 行数（2 条基础行，存在扩展状态时再加 1 行状态行）。Pi 在 aboveEditor widget 前固定插入 1 行空行；编辑器按两条边线加 1 行输入估计为 3 行。

```
Dock(空闲)  = clamp(floor(H/2) − 1 − 3 − F, 0, ui.maxRows)
Ask 上限    = floor(0.7·H) − 1 − F
Ask 实际高  = min(Ask 上限, 当前询问所有页中最高的内容)
```

- 空闲时，Dock、编辑器与 footer 合计不超过一半，聊天内容至少保留一半。`ui.maxRows` 默认 12、范围 1–30，用于封顶常驻区域：Dock 常驻屏幕，而 agent 工作时用户主要看聊天，60 行终端按一半能给 23 行，过多。12 行与 omp TODO 区的实际最大高度（约 14 行）相当。
- 询问是临时、抢焦点的界面，上限取 70%（与 omp 一致），但按内容取高，常见的 3–5 个选项只占 8–12 行，内容少时不补空行。
- Ask 实际高度在打开时测量一次，之后只在终端缩放和用户切换展开/折叠时重算。切换页签、输入筛选词时高度保持不变，避免整块上下跳动；筛选结果变少时保留空行。
- 测量内容包括：页签行、折叠状态的问题区、分隔线、全部选项（含折叠状态的内联说明）、操作栏与边框。宽屏取选项列表与右侧预览两者中较高的一方；Review 页按题目行数计算。
- Ask 上限小于 12 行时去掉两条分隔线，多出 2 行给选项；Ask 上限小于 5 行时不画外框，沿用现有的紧凑布局（一行回答或回答加操作栏）。
- 删除“低于 28 行取 3 行”和“20%”两条规则。H 小于 18 时 Dock 预算自然降到 1–2 行，只显示单行摘要，效果相当于 omp 在 18 行以下的折叠。
- 历史与说明的阅读模式保持 80% 终端高度不变。
- 编辑器多行输入与 pi-starship 换行的实际高度无法从扩展获得，公式使用估计值。超出时，fullscreen 模式由 Pi 的 `VStack` 按比例收缩；inline 模式聊天内容被上推。这属于既有的外部布局边界。

以下数值按 F = 3 计算。单题选项行 = Ask 上限 − 6（上边框、问题 1 行、两条分隔线、操作栏、下边框）。

| 终端行数 | 空闲 Dock 上限（旧值） | Ask 上限（旧值） | 单题选项行上限（旧值） | Ask 满高时聊天剩余行数 |
| --- | --- | --- | --- | --- |
| 24 | 5（2） | 12（1） | 6（0） | 8 |
| 30 | 8（5） | 17（3） | 11（1） | 9 |
| 40 | 12（5） | 24（3） | 18（1） | 12 |
| 60 | 12（5） | 38（3） | 32（1） | 18 |

多题询问多一行页签，选项行相应减 1。

### 2. 询问覆盖 Dock

- AskView 继续以 inline custom 挂进 `editorContainer`，替换编辑器。
- 询问打开时 `Dock.render()` 返回空数组，整块 Dock 区域让给询问；关闭后恢复。
- 删除 `dockAllowance` 和各来源的 `compact` 压缩摘要分支，以及“询问期间保留最多两条 Dock 行”“ui.maxRows=1 时最低回答行例外”这两条契约。
- 不使用 `custom({ overlay: true })`：
  - Pi 浮层不支持 `blocked` 程序状态（`ExtensionUIContext.custom` 的类型说明：“Only applies to inline components, not overlays”）。
  - 贴底浮层会遮住 footer 与问题上方的聊天内容，omp 也因此放弃浮层。
  - 浮层需要重新处理焦点与鼠标坐标。

### 3. 区域区分

空闲时：

```
… 聊天内容 …
                                                   ← Pi 自带空行
Tasks  3/7                                         ← 粗体 accent 标题，dim 汇总
├─ ⟳ 3 修复登录流程                          2/5
│    ☑ 3.1 复现问题
│    ⟳ 3.2 定位 token 刷新
│    ☐ 3.3 补充回归测试
│    … 还有 1 项                                   ← muted 溢出行
├─ ☐ 5 文档同步                              0/3
└───── ☑ 已完成 2 组                              ← 尾线收束 tasks 分区
Workflows · wf-12 review-flow      running · 2/4   ← 只有一行内容的分区合并为一行
──────────────────────────────────────────────── ← Pi 编辑器上边线（thinking 色）
> 输入…
────────────────────────────────────────────────
~/proj (main)                    ↑12k ↓3k claude   ← 原生 footer / pi-starship
🎯 0:12 · 🤖2 · ⚙1
```

询问时（Dock 已让位，询问替换编辑器）：

```
… 聊天内容（至少约 30%）…

╭─ Ask · main · Q1/2 ─────────────────── idle 9:41 ─╮  border 色框，标题粗体 accent
│ Q1✓  Q2  Review                                   │  仅多题询问
│ 部署前需要确认目标环境。staging 会复用当前数据库，│  问题与背景折叠时最多 4 行
│ production 需要额外审批……               e 展开    │  被截断时末尾显示 … 与展开提示
├───────────────────────────────────────────────────┤
│ ❯ ◉ staging (Recommended)                         │
│       复用当前数据库，部署约 2 分钟               │  窄屏内联说明，muted，折叠时最多 2 行
│   ○ production                                    │
│       需要审批，会触发完整回归，并通知值班……      │
│   ✎ Type your own answer                          │
├───────────────────────────────────────────────────┤
│ [Submit] Cancel Expand · Tab 焦点 · d 全文        │
╰───────────────────────────────────────────────────╯
~/proj (main)                        ↑12k ↓3k claude
🎯 0:12 · 🤖2 · ⚙1
```

#### Dock 分区

- 每个来源（tasks、workflows、goal、agents、jobs）注册时提供 `title`，接口改为 `register(id, { title, rows })`。
- 每个分区依次渲染：粗体 accent 标题与 dim 汇总、`├─`（顶层行）与 `│`（子行）竖线、`└─` 尾线。标题与尾线计入预算。
- 只有一行内容的分区把标题与内容合并为一行，不画竖线与尾线。
- tasks 分区的竖线与尾线按完成比例在阅读顺序上染 accent，未完成部分为 `borderMuted`；其他分区的竖线为 `borderMuted`。
- 预算只有 1–2 行时，每个分区只输出一行摘要（如 `Tasks 3/7 · ⟳ 3.2 定位 token 刷新`），按分区优先级排列，最多输出预算行数。
- 宽度小于 40 列时省略竖线字符，保留分区标题。
- 任务状态颜色沿用 `presentation.taskStyle`：待办默认前景色、进行中 accent、阻塞 warning、完成 dim 加删除线。

#### 询问外框

- 圆角框 `╭ ╮ ╰ ╯ ─ │`，`border` 色；上边框嵌入粗体 accent 的 `Ask`，随后是 requester、heading、页码，右侧是 idle 倒计时。原来单独占一行的标题信息移入上边框，不额外占行。上边框放不下时依次截断 heading、requester，倒计时与页码始终保留。
- 左右各留 2 列内边距。宽度小于 50 列时去掉左右竖线，只保留上下边框与分隔线，避免窄屏损失 4 列。
- 选项区超出可见高度时，在右边框上显示滚动位置；去掉竖线时在操作栏显示 `n/m`。
- 询问打开时编辑器已被替换，询问边框与编辑器边线不会同时出现，颜色不会混淆。

#### 编辑器与 footer

- 保持 Pi 原生实现。用 `setEditorComponent` 替换编辑器会与其他扩展的编辑器冲突；footer 由原生 footer 或 pi-starship 负责。
- 视觉分隔依靠 Dock 尾线、询问下边框与编辑器自带的 thinking 色边线。

### 4. 询问内容的折叠与展开

原则：inline 视图可以折叠，但每一处折叠都必须有可见提示，并且至少有两条查看全文的途径：inline 展开与完整阅读视图。完整阅读视图在任何焦点状态下都能通过操作栏到达。

#### 折叠规则

| 内容 | 折叠显示 | 折叠提示 |
| --- | --- | --- |
| 问题文本与背景 `context` | 问题区合计最多 4 行，问题在前，背景以 muted 跟随 | 第 4 行末尾为 `…`，右侧 dim 提示 `e 展开` |
| 选项标题 | 一行 | 末尾 `…` |
| 选项说明（窄屏，宽度小于 100 列） | 每个选项下方 muted 内联显示，缩进对齐标题，最多 2 行 | 第 2 行末尾 `…` |
| 选项说明（宽屏，宽度 100 列及以上） | 右侧预览栏，与列表同高；不再内联显示，避免同一段说明出现两次 | 预览栏底部 dim 提示 `↓ 更多` |
| Review 每题 | 一行“题干: 答案” | 末尾 `…` |
| 上边框中的 requester、heading | 按宽度截断 | 末尾 `…` |

#### 展开方式

- **inline 展开**：新增 `e` 键与操作栏动作 Expand/Collapse，在当前询问内切换展开状态，展开状态对整批题目生效，直到用户再次折叠或询问结束。
  - 展开后，选项标题与说明完整换行显示；问题区上限放宽到 `Ask 上限 − 外框与操作栏 − 3 行选项`，至少保留 3 行选项。问题区仍放不下时继续以 `…` 结尾并提示 `d 全文`，由完整阅读视图显示全文。
  - 展开与折叠会重新测量 Ask 实际高度，这是用户主动操作，高度变化符合预期。
  - Review 页展开后每题的题干与答案完整换行。
  - `e` 只在选项列表与 Review 焦点下生效；搜索、评论、自由输入时文字键交给输入框，此时通过 Tab 进入操作栏执行 Expand。
  - 只有当前页存在被折叠的内容时，操作栏才提供 Expand；展开后改为 Collapse。
- **完整阅读**：沿用 `d` 与操作栏 View details，打开 ScrollView 阅读视图，支持滚动、搜索与鼠标滚轮。
  - 内容扩展为：requester、heading、完整问题、完整背景、当前选项的完整标题与说明；无选项题或光标位于 ✎ 自由输入项时只显示问题部分。
  - Review 页的 `d` 打开当前行对应题目的完整问题、背景、完整答案与 comment。
  - 无选项文本题的 `d` 会作为文字输入，通过 Tab 进入操作栏执行 View details。
- **宽屏预览滚动**：鼠标滚轮位于预览栏列范围内时滚动预览，位于列表范围内时继续移动当前选项。
- 这些按键与操作栏动作要同步写入 `doc/current/ask/index.md` 的操作一节。

#### 其他常驻摘要的全文入口

Dock 中被截断的任务、workflow、agent、job 行沿用既有入口查看全文：`/tasks` 共享浏览器、workflow 菜单、agent transcript 与 job 视图。本方案不新增 Dock 内的展开操作。

### 5. tasks 内容选择

- 焦点组按以下顺序选取：选中组 > doing > blocked > 最近更新。
- 焦点组的子任务全部提交给 Dock，按任务 ID 顺序显示。预算不足时按以下优先级保留：当前子任务 > doing/blocked > 当前项之后的待办 > 最近 1 个已完成项（作为上下文，与 omp 一致）> 其余。
- 被裁掉的子任务显示为 muted 的 `… 还有 N 项`；如果只会藏掉 1 项，就直接显示这一项。
- 其他未完成组只显示组行，超出部分显示 `… 还有 N 组`。
- 部分组已完成时，已完成数量并入尾线 `└───── ☑ 已完成 N 组`，不额外占行。所有组都完成时，5 秒完成反馈结束后整个 tasks 分区隐藏；任务数据不删除，仍可通过 `/tasks` 查看。
- Dock 的 priority 只决定保留哪些行，不再决定显示顺序：分区之间按各分区最高 priority 排序，分区内部保持来源给出的顺序。父子连带保留与稳定 ID 选择保持不变。

### 6. 配置

- `ui.maxRows`：默认 12，范围 1–30，只限制空闲 Dock 的行数，不再影响询问高度。
- `/suite` 的字段说明与 `doc/current/runtime/index.md` 中的范围同步更新。

## 影响范围

- `src/ui/dock.ts`：预算公式、分区注册、分区渲染（标题、竖线、尾线、单行摘要）、显示顺序与 priority 分离、询问打开时返回空数组，删除 `dockAllowance` 与 `compact`。
- `src/tasks/index.ts`：重写 `rows()`；`src/tasks/presentation.ts` 的子任务缩进改由 Dock 竖线承担。
- `src/agents/workflow/index.ts`、`src/ui/status.ts`：注册时提供 title。
- `src/runtime/config.ts`、`src/runtime/settings/`：`ui.maxRows` 默认值、范围与说明。
- `src/ask/view.ts`、`src/ask/render.ts`、`src/ask/keys.ts`：外框、问题区与背景、内联说明、展开状态、高度测量、`e` 键与 Expand 动作、详情内容扩展、Review 详情、预览滚动。`view.ts` 已有 326 行，外框与问题区渲染应拆入 `render.ts` 或新文件，保持单文件不超过 500 行。
- 测试：`tests/runtime/coordinator.test.ts` 中 `askBudget(40) === 1` 是旧预算的固定值，删除；`tests/ask/view.test.ts` 的“总高度不超过预算、每行不超过宽度”契约保留。

## 约束

- 继续复用 Pi 原生 widget、inline custom、ScrollView、Markdown 与主题色，不新增并行的布局系统。
- 不替换 Pi 原生编辑器与 footer。
- 每行使用 Pi 的 ANSI 安全截断与可见宽度；折叠只影响显示，不修改原始问题、选项与答案。
- 尺寸变化与展开切换不初始化草稿、勾选集合、阅读位置与筛选内容。

## 风险

- 鼠标映射：选项变为多行后，`listRegion` 需要从“一行对应一个选项”改为按行映射到选项；外框带来 y+1、x+2 的偏移，`handleMouse` 中页签点击的 `event.y === 0` 判断与阅读模式的 `event.y < this.height - 2` 判断都要随之调整。
- 高度稳定：筛选与切题保持高度不变，展开切换重新测量；需要确认终端缩放时不会丢失展开状态与滚动位置。
- 编辑器与第三方 footer 的实际高度只能估计，见第 1 节的外部布局边界。

## 验收

- 在实际 Pi CLI 中，按 24、30、40、60 行与 40、80、120 列组合检查：
  - 空闲 Dock 行数符合公式；tasks 焦点组子任务按 ID 顺序显示，溢出行与“只藏 1 项则直接显示”规则正确。
  - 询问打开时 Dock 完全让位、关闭后恢复；单题、多题、Review 的高度符合公式且按内容取高，切题与筛选时高度不跳动。
  - tasks 分区、询问外框、编辑器、footer 能一眼区分；窄屏去掉竖线后仍有上下边框。
  - 长问题、长背景、长选项标题、长说明、长答案在折叠时都有 `…` 与提示；`e` / Expand 与 `d` / View details 都能看到全文；无选项文本题与 Review 页同样可以查看全文。
  - 鼠标点击多行选项、点击页签、滚轮移动选项与滚动宽屏预览都正确。
  - 尺寸变化与展开切换后，草稿、勾选、筛选与阅读位置保持不变。
- 低于 18 行时 Dock 只输出单行摘要；Ask 上限小于 5 行时回退到无外框的紧凑布局，仍可回答、提交与跳过。

## 相关文档

- [统一界面](../current/ui/index.md)：高度与状态、DetailsView、ScrollView。
- [询问](../current/ask/index.md)：操作一节需同步新增按键与动作。
- [任务操作与显示](../current/tasks/operations.md)：常驻摘要一节。
- [运行时配置](../current/runtime/index.md)：`ui.maxRows` 范围。

## 任务列表

- [ ] Dock 预算公式改为半屏共享，`ui.maxRows` 默认 12、范围 1–30
- [ ] Dock 分区注册与渲染：标题、竖线、尾线、单行摘要、显示顺序与 priority 分离
- [ ] 询问打开时 Dock 让位，删除 `dockAllowance` 与 `compact`
- [ ] tasks 焦点组完整子任务、裁剪优先级、溢出行与全部完成后隐藏
- [ ] workflows、goal、agents、jobs 分区标题
- [ ] 询问外框、70% 上限、按内容取高与高度稳定
- [ ] 问题区显示问题与背景，窄屏内联选项说明
- [ ] `e` / Expand 展开折叠内容，`d` / View details 扩展为完整阅读，Review 详情
- [ ] 宽屏预览滚轮、多行选项鼠标映射与外框坐标偏移
- [ ] 更新 current 文档（统一界面、询问操作、任务显示、运行时配置）与 `/suite` 字段说明
- [ ] 实际 Pi CLI 多尺寸验收

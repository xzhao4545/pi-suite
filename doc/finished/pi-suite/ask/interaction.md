# Ask 空闲计时、题型标记、多题切换与跳过语义

状态：已完成。空闲计时、自动提交、题型标记、循环页签/Review 与 skipped 语义均已实施。ask_user 的工具调用显示（renderCall/renderResult）归入 [工具调用显示](../../../todo/pi-suite/tool-display.md)，本文件只处理询问界面与结果语义。

## 原始需求

- [x] 1. 用户在询问界面操作时重置计时；只有用户持续一段时间不操作才超时。
- [x] 2. 单选、多选、输入三种题型的选项标记一眼可区分。
- [x] 3. 多个问题时能用左右方向键切换上一个、下一个问题。
- [x] 4. Esc 跳过回答时不能同时停止模型回答。
- [x] 5. 超时后参照 OMP 自动选择推荐项并提交（用户确认）。
- [x] 6. 多题切换到头后循环（用户确认）。

## 实施前原因

| 需求 | 根因位置 |
| --- | --- |
| 1 | `src/ask/view.ts` 第 206–216 行只在首次 render 设置一次 `deadline` 与 `setTimeout`；`handleInput`（134–183）与 `handleMouse`（184–189）都不触碰计时。`doc/current/ask/index.md` 的“超时与结果”明确写着查阅历史或说明不重置期限、整批共用一个期限 |
| 2 | 列表行（`view.ts` 244–251）与单行 `answerLine`（195–205）对单选和多选都画 `[x]`/`[ ]`，光标是无颜色的 `>`；自由输入没有任何标记，只在操作栏有 Freeform 或按 `f` 进入；推荐标记 `(Recommended)` 无颜色 |
| 3 | 选项列表焦点下 ←/→ 没有任何分支处理；切题只能 Tab 进入操作栏 → ←/→ 选 Previous/Next question → Enter（`act()` 118–120），每次切题后操作栏索引归零 |
| 4 | Esc 本身没有触发 Pi 的 `session.abort()`：询问打开时焦点在 AskView，宿主的中断处理 `defaultEditor.onEscape` 收不到按键。真正原因是 `src/ask/index.ts` 第 69–71 行对非 answered 结果返回 `terminate: true`；Pi 1.5.0 的 `shouldTerminateToolBatch` 在整批工具都 terminate 时结束本轮循环，模型拿不到下一轮。同时 `AskManager.onResult(false)` 调用 `GoalManager.askResult`（`src/goal/manager.ts` 204–207），把目标置为 waiting_user 并关闭 automatic |

相关的同类问题与边界：

- job 启动确认曾把非 answered 结果转成 `LAUNCH_NOT_CONFIRMED` 并返回 `terminate: true`，Esc 因此结束本轮。这条授权与确认链路已删除，普通 command、CLI 预设与 monitor 直接启动；实现与验收见 [删除 job 启动确认](../jobs/launch-confirmation.md)，本方案只处理 ask_user 路径。
- 嵌套状态下 Esc 需要连按多次才能关闭询问（搜索/评论/操作栏 → 选项，自由输入 → 选项，最后才取消），用户连按时最后一次 Esc 可能落到宿主输入框。[INFERENCE] 宿主仍在 streaming 时这次 Esc 会调用 `session.abort()`，未实际观察到。

## OMP 参考结论

阅读 [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) 提交 `f2b795ba747b23d42052184d822b41e3d01357cc`：

| 位置 | 设计 | 本方案处置 |
| --- | --- | --- |
| `packages/tui/src/chrome/countdown-timer.ts`、`packages/tui/src/overlays/ask-dialog.ts` 700–704 | 空闲计时：任何按键、页签/行点击、Enter、备注都调用 `CountdownTimer.reset()`，重新开始完整时长；编辑自定义回答时到期延后到编辑结束 | 采用空闲计时；输入框中的每次按键本身就是操作，会重置计时，不需要额外的延后逻辑 |
| `packages/coding-agent/src/modes/settings.ts` 1430–1458，`ask-dialog.ts` 1748 `#handleTimeout` | `ask.timeout` 默认 0（关闭），单位秒；到期时每个未回答题目选择推荐项，没有有效推荐时选第一项，标记 `timedOut` 后提交；结果显示 “auto-selected after timeout — not a user choice” | 采用自动选择并提交；Suite 额外优先保留用户当前草稿，见第 2 节 |
| `packages/tui/src/tools/ask.ts` 208–211 `optionMarker` | 单选 `○`/`◉`，多选 `☐`/`☑`，光标 `❯`；勾选标记为 success 色、未勾选为 dim，光标行 accent | 采用同一组符号与配色；自由输入另加 `✎`，OMP 的 “Other” 行沿用题型标记，无法区分输入 |
| `ask-dialog.ts` 1277–1281、1483–1486，`packages/tui/src/chrome/selector-helpers.ts` `handleTabSwitchKey` | 多题时顶部页签栏（每题一个 + Submit 页），Tab/→ 下一题，Shift+Tab/← 上一题，循环切换；单选 Enter 选中即进入下一题，最后进入 Submit 页 | 采用页签栏、←/→ 循环切题与 Review 页；Tab 保留给操作栏 |
| `packages/coding-agent/src/tools/ask.ts` 772–776 `cancelAsk` | 取消时 `context.abort()` 并抛出 `ToolAbortError`，测试 “aborts the turn when the user cancels selection” 固定该行为 | 不采用：用户明确要求 Esc 跳过时模型继续，改为返回正常的 skipped 结果 |

## 方案

### 1. 结果状态与 Esc 跳过

`AskResult.status` 由 `answered | timed_out | cancelled` 改为 `answered | skipped | timed_out | cancelled`：

| 状态 | 触发 | terminate | goal | 模型可见含义 |
| --- | --- | --- | --- | --- |
| answered | 用户提交 | 否 | 转为 running（现状） | 返回答案 |
| skipped | 顶层 Esc、操作栏 Skip | 否 | 不改变状态，不设置 waiting_user | 用户未回答就跳过；不得视为同意，继续不依赖该答案的工作，或之后再问 |
| timed_out | 空闲超过期限，自动选择后提交 | 否 | 转为 running（同 answered） | 返回自动选择的答案，每项带 `autoSelected` 标记；不是用户的明确选择 |
| cancelled | signal 中止、会话切换/reload、队列中被撤销 | 是（现状） | waiting_user（现状） | 系统取消 |

- `src/ask/view.ts`：`abort` 只用于 signal；新增 `skip = () => this.finish({ status: "skipped", responses: [] })`，顶层 Esc 与 Skip 动作调用它。操作栏 `Cancel` 改名 `Skip`。
- `src/ask/index.ts`：`terminate` 改为 `result.status === "cancelled"`；`askDetails` 的兼容字段 `cancelled` 改为 `status === "skipped" || status === "cancelled"`。工具描述与 promptGuidelines 改为：skipped 表示用户未回答；timed_out 的答案是自动选择，可作为推荐方案继续，但不得作为破坏性或需要用户同意操作的授权，这类操作需要再次询问。
- `AskManager` 的 `onResult` 回调改为传入 status；`GoalManager.askResult` 在 answered/timed_out 时转为 running，skipped 不改变目标状态，只有 cancelled 进入 waiting_user。
- 子代理向父级提问的 `src/agents/child.ts` 与 `src/agents/questions.ts` 由父级模型回答，不经过用户 Esc，保持现状。
- Esc 分层不变：搜索、评论、操作栏、详情、历史、带选项题的文字输入各退一层；只有回到题目的选项列表（或无选项题的输入框）时 Esc 才跳过整个询问。底部提示行显示 `Esc skip`，用户能预知下一次 Esc 的效果。
- 跳过后焦点回到宿主输入框，模型继续生成；此时再按 Esc 是 Pi 原生的中断，这是用户主动停止模型的入口，写入 current 文档。

### 2. 空闲计时

- `AskView` 新增 `touch()`：已开始计时且未结束时，把 `deadline` 设为 `Date.now() + timeout`，清除并重新设置 `setTimeout`。
- 调用点：`handleInput` 通过 closed 检查后的每次输入（含粘贴、搜索、阅读历史与详情）；`handleMouse` 实际处理的滚轮与点击。终端缩放不算操作。
- 首次 render 时开始计时、排队期间不计时、整批共用一个计时器、`timeoutMs: 0` 不计时，均保持现状。
- 倒计时显示改为 `idle 9:35`（分:秒），提示这是剩余空闲时间；每次操作后回到完整时长。
- `src/ask/schema.ts` 的 `timeoutMs` 描述改为 “Milliseconds of user inactivity before expiry. Omit for configured default (600000); 0 disables expiry. On expiry each question submits the user's current draft, else recommended options, else the first option.”；`ask.timeout` 配置含义同步改为空闲时长。
- 默认值由 120000 改为 600000（10 分钟，用户确认）：`src/runtime/config.ts` 的 `defaults.ask.timeout`、`/suite` 显示的默认值与 `doc/current/ask/index.md`、`doc/current/runtime/index.md` 的配置示例同步修改。

#### 到期自动提交

到期时逐题决定答案，整批一次提交，status 为 timed_out：

| 题型 | 答案来源（按顺序取第一个可用项） |
| --- | --- |
| 单选 | 用户当前草稿的选中项（含 defaultOptionId 预选）→ 第一个 `recommended` 选项 → 第一个选项 |
| 多选 | 用户当前草稿的勾选集合（含 defaultOptionIds 预勾选，非空时）→ 全部 `recommended` 选项 → 第一个选项 |
| 有选项且在自由输入 | 草稿文字非空时提交文字；否则按上两行规则选选项 |
| 无选项文字题 | 草稿文字（含 defaultAnswer）非空时提交；否则该题记为 `unanswered`，不编造答案 |

- 用户已动过的草稿优先于推荐项：用户空闲前的选择比模型的推荐更接近其意图。
- `Response` 增加可选 `autoSelected: true`；批量结果中无法自动作答的题目返回 `{ status: "unanswered" }`。单题无选项且无文字时，结果为 timed_out 且 responses 为空。
- 不受 `allowComment` 影响；评论草稿非空时随答案提交。
- 设计变更：当前契约 “timed_out 不提交默认值、不视为同意” 改为 “timed_out 提交自动选择的答案，但不作为授权”，同步修改 current 文档。

### 3. 题型标记

`src/ask/view.ts` 列表行改为 `<光标> <标记> <标题>[ (Recommended)]`，单行 `answerLine` 使用同一函数：

| 元素 | 未选 | 已选 | 颜色 |
| --- | --- | --- | --- |
| 单选 | `○` | `◉` | 已选 success，未选 dim |
| 多选 | `☐` | `☑` | 已选 success，未选 dim |
| 自由输入行 | `✎` | `✎`（已有文字时在行尾显示文字预览） | 有文字时 success，否则 dim |
| 光标 | `❯ `（非光标行为两个空格） | | accent，光标行标题同为 accent |
| 推荐 | ` (Recommended)` | | accent |

- 题目标题行带题型标签：`○ Single choice`、`☐ Multiple choice · 2 selected`、`✎ Text`，同一行显示 `Q2/3` 与空闲倒计时。
- 有选项且 `allowFreeform` 为 true 时，列表末尾固定一行 `✎ Type your own answer`；Enter 进入文字输入，Esc 退回列表并保留文字。`f` 快捷键保留，操作栏的 Freeform 动作删除。无选项题直接显示输入框，输入框左侧加 `✎ ` 前缀。
- 所有符号经 pi-tui `visibleWidth` 计为 1 列（`○ ◉ ☐ ☑ ✎ ❯` 已核对），截断与对齐沿用现有 `truncateToWidth`。

### 4. 按键与多题切换

| 按键 | 单选 | 多选 | 文字输入 |
| --- | --- | --- | --- |
| ↑/↓、PageUp/PageDown | 移动光标 | 移动光标 | 编辑器内移动 |
| Space | 选中 | 勾选/取消 | 输入空格 |
| Enter | 选中并确认本题 | 确认本题（至少勾选一项，否则提示 `Space to select`） | 确认本题 |
| ←/→ | 上一题/下一题 | 上一题/下一题 | 移动光标（编辑器原生） |
| Tab | 进入/离开操作栏（现状） | 同左 | 同左 |
| Esc | 跳过询问 | 跳过询问 | 有选项时退回列表；无选项题跳过询问 |

#### 多选

现状（`src/ask/form.ts` `choose`，`view.ts` 175–181）：↑/↓ 移动光标，Space 或 Enter 切换当前项勾选，不前进；勾选集合保存在 `Draft.selected`，`/` 搜索筛选不改变勾选，被筛掉的项保留真实状态；defaultOptionIds 预勾选；至少勾选一项才有回答，确认要 Tab 到操作栏选 Confirm（多题为 Next question，最后 Submit all）。各项只显示 `[x]`/`[ ]`，与单选外观相同。

修改后：

- Space 切换当前项勾选，Enter 确认本题；Enter 不再切换勾选，避免“想确认却把当前项取消”。
- 标记 `☐`/`☑`，题目标题行显示 `☐ Multiple choice · 2 selected`，用户能看到当前勾选数。
- 勾选为空时 Enter 不前进，标题行提示 `Space to select`。
- 有 `✎ Type your own answer` 行时，文字回答与勾选互斥（`Draft.freeform` 现有语义）：输入非空文字后提交文字，勾选保留但不提交；回到列表勾选任一项后改为提交勾选。
- 搜索筛选、隐藏项保留勾选、预勾选规则不变。

#### 确认与切题

- “确认本题”：单题询问直接提交；多题询问进入下一题，最后一题之后进入 Review 页。这是对现状的修改：当前 Enter/Space 只选择、不前进，需要 Tab → Confirm。
- 多题询问在题目上方显示页签栏：`Q1 ✓  Q2  Q3  Review`。当前页签 accent；已有回答的页签加 success 色 `✓`，未回答为默认色。鼠标点击页签切换到该题。
- ←/→ 在页签间循环：第一题按 ← 到 Review 页，Review 页按 → 回到第一题。切题保留各题草稿、光标、筛选与文字（`AskForm.drafts` 现有能力）。单题询问没有页签，←/→ 不起作用。
- 文字输入中 ←/→ 必须留给编辑器移动光标（pi-tui 的 Ctrl/Alt+←/→ 也已被单词移动占用），所以输入中切题使用 Enter 确认并前进，或 Esc 退回列表后再按 ←/→。
- Review 页列出 `1. 问题摘要: 答案`，未回答项为 warning 色 `Unanswered`；全部回答后 Enter 提交，否则提示未回答数量并停留。←/→ 返回各题。
- 操作栏删除 Confirm、Previous question、Next question、Freeform，保留 Submit（Review 页）、View details、History、Search、Comment（allowComment 时）、Skip。
- 历史与详情阅读器内的按键（现有 ←/→ 选择阅读器动作）不变。

## 影响范围

- `src/ask/view.ts`（276 行，改动后预计超过 300 行）：按职责拆出 `src/ask/render.ts`（标记、行、页签栏、Review 页渲染）与 `src/ask/keys.ts`（按键分派），`view.ts` 保留状态、计时与焦点。
- `src/ask/form.ts`：增加 `answered(index)` 供页签与 Review 页使用（复用 `response(index)`）。
- `src/ask/index.ts`、`src/ask/schema.ts`：skipped、terminate 条件、描述文本。
- `src/goal/manager.ts`：`askResult` 按状态分支。

## 测试调整

- `tests/ask/view.test.ts`：现有 “timeout starts at first render” 用例改为验证空闲计时：操作后期限后移，停止操作满期限后只结算一次 timed_out；到期答案按“草稿 → 推荐 → 第一项”选择并带 `autoSelected`，无选项且无文字的题为 unanswered。
- `tests/ask/contracts.test.ts`：status 增加 skipped；断言只有 cancelled terminate，skipped/timed_out 不 terminate。
- `tests/ask/coordination.test.ts`：goal 在 skipped 时状态不变，timed_out 时转为 running，cancelled 时进入 waiting_user。
- 题型标记、页签外观等显示细节不新增永久测试，在实际 CLI 中验收。

## 实施与验证结论

- `Draft.editing` 与 `freeform` 分开，退出文本编辑只切换焦点，不丢弃答案模式或保留的勾选。确认使用 Pi Editor.disableSubmit，文本、光标与撤销状态在再次确认和切题后保持。
- `keys.ts` 分派列表和页签按键，`render.ts` 统一选项行、页签、Review 与空闲时间；原生编辑器与阅读器按键仍各自处理。
- 三行的批量询问把题型/题干与当前答案合并显示，页签与空闲时间共用一行；较高终端显示完整标签，Review 可按行或滚轮查阅。最低回答行仍遵循 Dock 预算，不扩大常驻高度。
- 类型检查与全量 168 项检查通过，无失败、跳过或取消项，日常耗时在 5 分钟内；新增 1 项公共结果/terminate 契约检查，其余修改既有用例。
- Linux 实际 Pi 1.5.0 CLI 在 40×24、60×30、120×40 的 PTY 验收题型/配色、单选与多选确认、文字光标、键盘/鼠标循环切题与 Review、筛选外勾选、按键/滚轮空闲重置、自动答案和模型继续，以及跳过后的原生再次 Esc 中断，退出码均为 0。自由输入行与 Esc 后保留文字、勾选草稿和超时提交文字，以及 Review 未回答时拒绝提交、补齐后整批提交，另在 40×24 通过。
- 本次实际 CLI 验收为 Linux 受控离线模型范围，Windows 未重复进行实际交互验收。稳定接口与操作见 [当前 Ask 文档](../../../current/ask/index.md)，goal 恢复边界见 [当前生命周期](../../../current/goal/lifecycle.md)。

## 验收

- [x] 实际 Pi CLI PTY 40/60/120 列：单选、多选、输入三种题型标记可区分；推荐、光标、已选颜色正确。
- [x] 持续按键或滚动时倒计时不断回到完整时长；停止操作后到期自动提交：有草稿用草稿，否则推荐项，否则第一项；结果为 timed_out 且模型继续。
- [x] 3 题询问：←/→ 循环切题（含 Review 页）、页签状态、草稿保留、Review 页提交；文字输入中 ←/→ 只移动光标。
- [x] 模型生成中调用 ask_user，按 Esc 跳过后模型继续本轮并收到 skipped；再按 Esc 才中断模型。
- [x] 完成后更新 `doc/current/ask/index.md`（超时、结果状态、操作）与 goal 操作文档中 waiting_user 的触发条件。

[返回已完成专项](../../index.md)

# ask 接口与操作

`ask_user` 向用户展示一题或一批问题，用户作答、跳过、空闲到期或询问被取消后返回结果。工具按顺序执行（`executionMode: "sequential"`），同时发起的多个询问排队，逐个展示。

## 运行条件

| 调用方 | 行为 |
| --- | --- |
| 主会话 TUI | 在输入区展示询问表单 |
| 主会话 print 或 RPC 模式 | 报错 `ask_user needs the interactive Pi terminal …`，询问不展示 |
| 调用时绑定的会话已不是当前会话 | 直接返回 `cancelled` |
| subagent | 问题交给直接父级回答，期限由父级回答单独计算，见 [父级回答](../agents/operations.md#父级回答) |

`modules.ask` 为 `false` 时主会话不注册 `ask_user`。

## 参数

| 参数 | 说明 |
| --- | --- |
| `question` | 单题题干。批量时作为整批标题（heading），显示在上边框 |
| `questions` | 批量询问，2–4 项。每项包含 `question`，可选 `title`、`options`、`allowMultiple` 和默认值 |
| `title` | 批量页签标题，1–60 字符；省略时取题干。只用于页签，题干照常完整显示，答案结构不变 |
| `options` | 字符串，或 `{id?, title, description?, recommended?}` |
| `allowMultiple` | 是否多选，默认 `false` |
| `defaultAnswer`、`defaultOptionId`、`defaultOptionIds` | 预填文字、单选预选、多选预勾选；三者互斥 |
| `allowComment` | 为 `true` 时操作栏提供 Comment 输入，作用于所有题目 |
| `timeoutMs` | 空闲期限，见 [超时](#超时与结果) |

批量时 `options`、`allowMultiple` 和默认值只能写在 `questions` 各项内。题目没有 `context` 字段，选项说明放在 `description`，完整保留。没有 `allowFreeform` 参数：每题都接受自定义文字。

## 选项与默认值

- 未指定 `id` 的选项按列表位置生成 `option-1`、`option-2` 等 ID。默认值按选项 ID 引用。
- 每题末尾都有一个自定义文字项（无选项的题只有这一项）。单选时它与预设项互斥；多选时可与预设项同时选中。自定义项没有选项 ID，不会与模型提供的 ID 冲突。
- `recommended` 只显示 `(Recommended)` 标记，不预选，也不写进答案标题；空闲到期时作为自动答案的候选。
- `defaultAnswer` 预填文字并选中自定义项，光标停在该项；`defaultOptionId` 只用于单选，`defaultOptionIds` 只用于多选。
- 默认值只在表单创建时写入一次。搜索筛选、切题、打开历史或详情、终端缩放都不重置用户的编辑；被筛选隐藏的选项保留勾选状态。
- 取消选中自定义项后保留文字草稿，但不提交这段文字。

参数在展示前校验，下列错误直接报给模型：

| 错误 | 原因 |
| --- | --- |
| `No question supplied. …` | 两者都缺，或 `question` 为空白 |
| `With questions, put options, allowMultiple and default* settings inside each questions entry …` | 批量时在顶层写了选项、题型或默认值 |
| `Duplicate option IDs. …` | 同一题内选项 ID 重复 |
| `Use only one of defaultAnswer, defaultOptionId and defaultOptionIds per question` | 同一题给了多个默认值参数 |
| `defaultOptionId requires single choice; defaultOptionIds requires allowMultiple: true` | 单选用了 `defaultOptionIds`，或多选用了 `defaultOptionId` |
| `Default references an unknown option ID. …` | 默认值引用了不存在的 ID |

## 超时与结果

`timeoutMs` 是用户连续不操作的毫秒数。省略时使用配置 `ask.timeout`（默认 600000，即 10 分钟），`0` 不设期限，最大 2147483647。

- 计时从询问第一次渲染开始；排队等待期间不计时。整批共用一个计时器。
- 每次按键、粘贴，以及被询问处理的鼠标点击和滚轮都把期限重置为完整时长；在历史或详情里的操作同样重置。终端缩放不重置。
- 上边框显示剩余时间 `idle 分:秒`，无期限时显示 `no timeout`。

### 状态

| `status` | 触发 | 答案 | 后续 |
| --- | --- | --- | --- |
| `answered` | 用户提交 | 每题都有答案 | 模型继续；进行中的 goal 回到 `running` |
| `skipped` | 顶层 Esc 或操作栏 Skip | 已有的选择和文字，未答题为空 | 模型继续；goal 状态不变 |
| `timed_out` | 空闲到期 | 自动答案，每项带 `autoSelected: true` | 模型继续；进行中的 goal 回到 `running` |
| `cancelled` | 工具 signal 中止、会话切换或 reload、排队中被撤销 | 无 | 工具返回 `terminate: true` 结束本轮；进行中的 goal 进入等待用户并暂停，见 [暂停原因与恢复](../goal/lifecycle.md#暂停原因与恢复) |

`skipped`、`timed_out` 和 `cancelled` 都不是用户同意，不能作为破坏性操作或需要授权操作的依据。每次询问只结算一次；输入、到期和中止在同一时刻到达时以先到者为准。

### 到期自动答案

每题按以下顺序取第一个可用的答案：

1. 当前已选中的答案，包括预选、预填，以及多选中已选的预设项与非空自定义文字。
2. 推荐项：单选取第一个，多选取全部。
3. 第一个选项。

未选中的文字草稿不参与。没有选项、也没有已选文字的题保持未回答，不编造文字。非空的 comment 随答案一起提交，与 `allowComment` 是否显示输入入口无关。

跳过只收集已有答案，不取推荐项或首项，也不加 `autoSelected`。

### 返回给模型的文本

`content` 由 `askToolResult` 生成，只含状态和答案，不回显未选项和选项说明：

```text
timed_out (not consent)
1. 数据库选型 → PostgreSQL (auto-selected)
2. 是否加缓存 → custom: 先不加
   comment: 之后评估
3. 部署区域 → unanswered
```

| 部分 | 格式 |
| --- | --- |
| 首行 | 状态；`timed_out` 和 `skipped` 追加 ` (not consent)`；`cancelled` 只有这一行 |
| 题干 | 压缩空白后最多 24 个 Unicode 码点，超出以 `…` 结尾 |
| 预设答案 | 选项标题，多个用 `, ` 连接；同一题有同名选项时加 `#N `（N 为原列表位置） |
| 自定义文字 | 只有文字时为 `custom: …`；多选混合时追加 ` + custom: …` |
| 其他 | 自动答案追加 ` (auto-selected)`；未答为 `unanswered`；comment 单独一行；subagent 末尾追加 `source: parent` |

答案和 comment 不截断。

### details

`details` 供本地渲染和历史展开使用，不作为模型正文发送。

| 形态 | 字段 |
| --- | --- |
| 单题 | `status`、`cancelled`、`question`、`options`、`response`（无答案时为 `null`） |
| 批量 | `status`、`cancelled`、`kind: "batch"`、`heading`、`questions`、`answers` |

- `cancelled` 在 `skipped` 和 `cancelled` 时为 `true`。
- 批量 `answers` 按题目顺序排列，每项为 `{status: "answered", response}` 或 `{status: "unanswered"}`；`cancelled` 时为空数组。
- subagent 结果另带 `source: "parent"`。

`response` 有两种：

| `kind` | 字段 |
| --- | --- |
| `selection` | `selections`（预设标题）、`optionIds`；多选同时选了自定义项时另有 `text` |
| `freeform` | `text`，只提交了自定义文字 |

两者都可带 `comment`，自动答案带 `autoSelected: true`。

## 操作

### 布局

询问显示在输入区，替换编辑器；Dock 在询问期间不输出任何行。聊天区和终端回滚仍可查看。

高度取整批题目与 Review 中最高的内容，上限见 [询问高度](../ui/index.md#询问高度)；切题和筛选时高度不变，终端缩放或切换展开时重算。按可用行数选择外框：

| 可用行数 / 宽度 | 外框 |
| --- | --- |
| 行数 < 5 | 无外框，只显示当前答案行和操作栏；只有 1 行时只显示答案行 |
| 行数 ≥ 5 | 圆角外框，上边框左侧为 `Ask · requester · heading`，右侧为 `页码 · 剩余时间` |
| 行数 ≥ 12 | 另在题干、列表和操作栏之间加分隔线 |
| 宽度 < 50 列 | 省略左右边线 |

页码为 `当前/总数` 加题型：`○` 单选、`☐N` 多选（N 为已选数）、`✎` 文本题；Review 页为 `Review`。

### 标记

| 标记 | 含义 |
| --- | --- |
| `○` / `◉` | 单选未选 / 已选 |
| `☐` / `☑` | 多选未选 / 已选 |
| `✎` | 自定义文字项（跟在选择标记后）；无选项的题只有 `✎` |
| `❯` | 当前项 |
| `(Recommended)` | 推荐项 |

空的自定义项显示 `Type your own answer`，有文字后直接显示文字。已选标记为 success 色，未选为 dim，当前项和推荐标记为 accent。

### 按键

| 按键 | 列表 | 自定义项 |
| --- | --- | --- |
| ↑ / ↓ | 移动当前项 | — |
| PageUp / PageDown | 按可见高度翻页；展开模式下按物理行滚动 | — |
| 空格 | 单选选中，多选切换勾选 | 有文字时选中或取消；无文字时进入编辑 |
| Enter | 单选：选中并确认；多选：只确认，不切换勾选 | 进入编辑；编辑中再按 Enter 确认并前进 |
| `f` | 进入编辑 | 进入编辑 |
| `/` | 搜索（按标题和说明模糊筛选）；Enter 返回列表，筛选不改变勾选 | — |
| `e` | 切换展开 | — |
| `d` | 打开详情 | — |
| ← / → | 批量时切题 | — |
| Tab | 进入或离开操作栏；操作栏内 ←/→ 或 ↑/↓ 选择，Enter 执行 | — |
| Ctrl+H | 打开或关闭历史（`ask.historyKey`） | — |

- 进入编辑时，单选清除预设选择，多选保留已有勾选。编辑器设为 `disableSubmit`（Pi Editor 不自行提交），编辑中的 Enter 由询问处理：确认并前进，同时退出编辑。编辑中 Esc 退出编辑，保留文字、光标和选中状态；Shift+Enter 等换行键由编辑器处理。返回某题时保留草稿、光标和撤销记录。
- 无选项的题和带预填文字的题打开时停在文字项，按 Enter 才进入编辑；未编辑时可用 ←/→ 切题。
- 编辑、搜索和评论输入中，`e`、`d`、`f`、`/` 和 ←/→ 都是普通输入，需通过 Tab 进入操作栏执行对应动作。
- 确认时当前题没有答案，状态行提示 `Answer required`；多选未勾选任何项时提示 `Space to select`。
- 操作栏：View details、Expand/Collapse、History、Search（有选项时）、Comment（`allowComment` 时）、Skip；Review 页为 Submit、View details、Expand/Collapse、History、Skip。Comment 输入按 Enter 保存并回到操作栏。

### 鼠标

终端支持鼠标时：

- 点击页签切题。
- 点击选项等同于移到该项后按空格；点击被折叠的续行归属其所在选项。点击 Review 行选中该行。
- 滚轮在选项区移动当前项，在 Review 区移动当前行；滚轮不勾选、不提交，也不改变键盘焦点。

历史、详情和右侧说明预览只用键盘阅读，见 [原生阅读与鼠标](../ui/terminal.md#原生阅读与鼠标)。

### 折叠、展开与详情

- 题干最多显示 4 行；选项标题显示一行；选项说明以 muted 色缩进显示，最多 2 行。被截断处以 `…` 结尾，操作栏右侧提示 `e expand` 和 `d full text`。
- `e` 或 Expand 展开整批：选项标题、说明和 Review 内容完整换行，问题区至少为选项留 3 行，仍放不下时题干以 `… d full text` 结尾。只有当前页有被截断内容时才提供 Expand，展开后提供 Collapse。
- `d` 或 View details 打开详情，显示 requester、heading、完整题干和当前选项的标题与说明；当前项为自定义项时显示 `✎` 加完整文字。Review 页显示当前行的题干、答案和 comment。
- 终端宽度 ≥ 100 列时列表占左半边，右侧预览当前选项的标题与说明，此时说明不再内联显示；预览放不下的内容用 `d` 阅读。
- 内容超出窗口时，状态行前显示 `当前/总数`。

### 批量与 Review

1. 批量询问在题干上方显示页签（可用行数 ≥ 6 时），末尾为 Review。页签取 `title` 或题干，压缩空白后最多 22 列；已答题带 `✓`。宽度不足时依次缩短最宽的标签；仍放不下时只显示当前页和空间允许的 Review，鼠标只命中可见页签，←/→ 仍按完整题序切换。
2. 列表或 Review 焦点下 ←/→ 循环切题：第一题向左进入 Review，Review 向右回到第一题。
3. 每题 Enter 确认后进入下一题，最后一题之后进入 Review。
4. Review 列出每题的题干与答案（预设标题加 `✎ 文字`），未答题显示 `Unanswered`；↑/↓ 或滚轮移动。
5. 全部回答后 Enter 或 Submit 提交整批；有未答题时提示 `N unanswered` 并停留。

单题没有页签和 Review，确认即提交。

### Esc 与跳过

- 在搜索、评论、操作栏、历史、详情和文字编辑中，Esc 返回上一级。
- 在选项列表、Review 或未编辑的文字项上，Esc 跳过整个询问；操作栏 Skip 相同。已有的选择和文字随 `skipped` 发给模型。
- 状态行显示 `Esc back` 或 `Esc skip` 表示当前 Esc 的作用。
- 跳过后焦点回到 Pi 输入框，模型继续生成；此时再按 Esc 是 Pi 原生中断。

### 历史

Ctrl+H 或 History 打开历史：上方为当前会话分支的 transcript，下方为当前题干和答案行。高度见 [询问高度](../ui/index.md#询问高度)。正文复用主会话的 [Transcript](../ui/index.md#transcript) 消息与工具组件及其缓存，滚动与搜索共用 [ScrollView](../ui/index.md#scrollview) 的同一个偏移。

| 按键 | 作用 |
| --- | --- |
| Tab | 在历史、答案行和操作栏之间切换 |
| ↑ / ↓、PageUp / PageDown、Home / End | 阅读 |
| `/`，`n` / `N` | 搜索，下一个 / 上一个匹配 |
| `t` / `i` | 展开或折叠工具结果 / thinking |
| Esc 或 Ctrl+H | 返回询问 |

详情使用相同的阅读按键（不含 `t`/`i`），操作栏为 Previous page、Next page、Back。打开历史或详情不改变草稿。

### 配置与通知

- `modules.ask`、`ask.timeout` 和 `ask.historyKey` 在 [`/suite`](../runtime/settings.md#suite) 中设置；`ui.maxRows` 不影响询问高度。
- 询问期间 job 完成、subagent 问题等通知暂不投递；询问结束并到达可投递边界后，与 goal 继续请求合并为一条消息投递，见 [通知投递](../runtime/index.md#通知投递)。

## 工具显示

| 位置 | 内容 |
| --- | --- |
| 调用行 | 标题 `Ask`（subagent 为 `Ask parent`）；单题显示题干前 60 列，批量显示 `N questions` |
| 折叠结果 | 单题为 `题干 → 答案`（题干前 40 列）；批量为 `N answered`；`skipped` 前加 `skipped · `；`cancelled` 只显示状态 |
| 折叠标签 | `auto-selected`、`not consent`（`timed_out` 和 `skipped`）、`N unanswered`、`source: parent` |
| 展开结果 | 状态、consent、source、heading，以及每题的题干、带标记的选项和说明、自定义文字、comment、自动答案标记和未答标记；已选项为 success 色 |

询问期间的历史与主界面使用同一 renderer。主会话工具结果的单项点击与 Pi 默认 Ctrl+O 由宿主管理；历史中用 `t`/`i` 切换，不提供主会话的鼠标操作。较早记录中的题目若带 `context`，展开时按该记录显示；当前参数与新结果不含 `context`，旧记录不被改写。

[返回当前文档](../index.md)

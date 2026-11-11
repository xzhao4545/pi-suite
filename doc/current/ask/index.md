# ask 接口与操作

ask_user 是顺序执行工具，等待用户作答或空闲期限结算。单题使用 question；批量使用 2–4 项 questions，顶层 question 只作为整批标题。批量各题可提供 `title`（1–60 个字符），作为简短页签标题；省略时从该题题干派生。标题仅用于导航，完整题干与回答结构保持不变。题目不提供 context；批量题型、options 和默认值必须放在各题内部，顶层批量题型参数会报告错误。

## 选项与默认值

options 支持字符串或 `{id?, title, description?, recommended?}`。未指定 ID 时生成 option-1 等 ID；预选值按原始选项 ID 引用。description 为选项说明，完整保留，不是题目背景字段。

allowMultiple 默认 false。所有题目始终允许自由回复，单选与多选列表末尾均提供独立自定义项；单选与预设项互斥，多选可与预设项同时勾选。工具参数不包含 allowFreeform。推荐标记在人工操作时只用于展示，不预勾选，也不进入答案标题；空闲到期时作为自动作答的候选。defaultAnswer 预填并选中自定义项，defaultOptionId 预选单选，defaultOptionIds 预勾选多选。题型不匹配、默认值冲突和未知 ID 在展示前报错。

默认值仅初始化一次；筛选、切题、查看历史、说明和终端缩放都保留用户编辑。多选按实际勾选集合提交；隐藏的选项继续保留真实勾选状态。自定义项取消选择后保留文字草稿，但不提交该文字；自定义项没有预设选项 ID，不占用模型提供的 ID。allowComment 为 true 时提供可选评论输入。

## 超时与结果

timeoutMs 单位为毫秒，表示用户持续不操作的空闲时长；省略使用配置 ask.timeout 的默认 600000（10 分钟），0 不设期限。计时从第一次展示开始，排队期间不计时，整批共用一个计时器。每次按键、粘贴和实际处理的鼠标点击/滚轮重置完整时长，历史与说明阅读也计为操作；终端缩放不重置计时。倒计时显示 idle 分:秒。

返回 status 为 answered、skipped、timed_out 或 cancelled：

| 状态 | 结果与执行 |
| --- | --- |
| answered | 用户提交答案，模型与目标继续运行 |
| skipped | 顶层 Esc 或 Skip；返回已有选择与文字草稿，未答题保持未回答，模型继续，目标自动许可保持；不得当作整批确认或同意 |
| timed_out | 空闲到期自动提交，可作为推荐方案继续；每个答案带 autoSelected: true，不能作为破坏性或需要同意操作的授权 |
| cancelled | signal 中止、会话切换/reload 或队列撤销；无答案，通过 terminate 结束本轮，当前目标进入 waiting_user 并停止自动工作 |

到期优先保留用户当前选中答案（含预选/预填）；多选的预设项与已选非空自定义项一并保留。没有已选答案时，单选取第一项推荐，多选取全部推荐；没有推荐时取第一个选项。未选中的文字草稿不参与答案；无选项文本题无草稿时保持未回答，不编造文字。非空评论随选择或文字提交，不受 allowComment 是否展示输入入口影响。

content 为共用格式化函数生成的文本：首行状态，单题与批量统一逐题输出编号、最多 24 个 Unicode 码点的题干摘要与所选答案，不回显未选项或选项说明。预设答案使用原始标题；同名选项按原列表位置加 `#N` 消歧，其余不重复 optionId。多选自定义文字追加 ` + custom: …`，仅自由文字使用 `custom: …`；未答位置为 `unanswered`。comment 放在对应答案下的 `comment: …` 行，child 追加 `source: parent`。timed_out 和 skipped 首行明示 `not consent`，自动作答的对应答案加 `auto-selected`；取消为 `cancelled`。答案与评论不因回执预算截断。

details 保留 status、单题 question/options/response/cancelled 和批量 kind/heading/questions/answers/cancelled 字段，供本地渲染与历史展开；child 另带 source: parent。官方 Responses 使用 content 构造工具回传，不自动把本地 details 序列化成模型正文；模型自己的工具调用参数与回传是不同消息。cancelled 标记仅在 skipped/cancelled 时为 true。批量到期与跳过的答案按题目原顺序返回，未答题为 {status: "unanswered"}；单题无答案时 response 为 null。跳过只收集已有答案，不自动选择推荐或首项，也不添加 autoSelected 标记。

selection 响应保留 selections 原始预设标题和 optionIds，多选同时选中自定义项时以独立 text 字段保存原始文字；仅提交自定义项时返回 freeform 与原始 text。两者可带 comment 与自动作答的 autoSelected 标记。Review、工具摘要与历史展示保留预设选择及带 ✎ 的文字。人工多题回答需要 Review 整批确认。回答、跳过、超时和取消只结算一次。

## 操作

- 默认 inline 询问位于输入区域，覆盖 Dock 并替换编辑器，保留主聊天与终端历史查阅。实际高度按整批内容测量并以终端 70% 为上限，切题与筛选时保持高度；缩放或展开切换时重算。圆角框区分询问与 footer，窄于 50 列省略侧边线，小于 12 行预算省略分隔线，小于 5 行预算使用紧凑回答。
- 单选用 ○/◉，多选用 ☐/☑；自定义项在相同选择标记后始终带 ✎，无选项文本题使用 ✎。空自定义项显示 Type your own answer，输入后直接显示文字，不添加提示前缀。已选为 success 色，未选为 dim，光标 ❯ 和推荐为 accent。题目带题型与当前页信息，小终端保留当前答案行并压缩标签。
- ↑/↓ 移动选项，空格选择/勾选；单选预设项 Enter 选中并确认，多选预设项 Enter 只确认、不切换勾选，空集合提示 Space to select。自定义项 Enter 进入编辑，再按 Enter 确认并前进；已有文字时空格按题型选择/取消该项，空文字时空格进入编辑。Shift+Enter 等原生换行按键继续交给编辑器。Tab 进入/离开操作栏，←/→ 选动作，Enter 执行。
- `/` 搜索单选或多选；Enter 返回列表，筛选不修改勾选。PageUp/PageDown 翻页。
- 终端支持的鼠标滚轮在选项区移动当前选项、在 Review 区选择阅读项；滚轮不勾选、不提交，也不改变当前键盘焦点。点击页签切题，点击列表选择当前项；空自定义项点击进入编辑，已有文字时点击按题型选择/取消，Enter 或 f 再次编辑。History 和全文使用键盘阅读，不保证正文滚轮或嵌套工具单项鼠标操作；说明预览的超出内容通过 `d` 全文查看。
- 题干折叠为最多 4 行；选项标题折叠为一行，窄屏说明以内联 muted 文字显示最多 2 行。被折叠的内容以 `…` 标记，操作栏提示展开与全文入口。
- `e` 或操作栏 Expand 切换整批 inline 展开，展开后提供 Collapse；只有当前页存在折叠内容时提供 Expand。选项标题、说明和 Review 题干/答案完整换行，问题区至少为选项预留 3 行，仍超出时显示 `… d full text`。展开列表的 PageUp/PageDown 按物理行滚动，可阅读高于窗口的选项。`e` 只在列表与 Review 回答焦点下生效；搜索、评论和自由输入的文字键交给原生输入组件，使用 Tab 进入操作栏执行展开或全文动作。
- `d` 或操作栏 View details 打开 requester、heading、完整问题与当前选项的完整标题/说明；自定义项及无选项文本题同时显示带 ✎ 的完整文字草稿。自定义项长文字同样支持 e 展开与 d 全文。Review 页读取当前行的完整问题、答案与 comment。文本编辑中的 `d` 属于文字输入，通过 Tab → View details 阅读全文。
- 宽度达到 100 列时提供右侧选项预览，说明不重复内联显示；预览按显式窗口预算显示，超出内容通过 `d` 全文阅读，不保证预览列滚轮。列表范围内的滚轮移动当前选项，continuation 行点击映射到所属选项，页签坐标包含外框偏移；操作栏在内容超出窗口时显示当前位置/总数。
- `f` 或自定义项上的 Enter 进入自由输入并选中该项；单选取消预设选择，多选保留已有勾选。Esc 退出编辑，保留文本、光标与选中状态。无选项题与预填文字题默认停留在文字入口，Enter 才进入编辑，非编辑时允许左右切题。文本确认复用 Pi Editor 的 disableSubmit，由 Ask 前进并退出编辑，返回题目时保留草稿、光标及撤销状态。
- History 操作或默认 Ctrl+H 打开上方历史、下方问题与草稿的独立视图；Tab 在历史、回答和操作栏间切换，Ctrl+H 返回 inline。
- 历史/详情用 ↑/↓、PageUp/PageDown、Home/End 阅读；`/` 搜索，n/N 查下一/上一匹配。操作栏提供 Previous page、Next page、Back。历史中的 t/i 切换工具/thinking 展开；正文使用公开 ScrollView 的唯一 scrollTop 与显式 viewport 切片/补齐，scrollbar:hidden 无滚动条计时器，clamp 保留显式暂停。Transcript 保留原生消息与工具实例及缓存，滚动和搜索保持一份偏移，不初始化回答草稿；阅读能力与主会话工具鼠标的区别见 [终端交互边界](../ui/terminal.md#原生阅读与鼠标)。
- 批量以各题短标题显示页签与 Review，不使用 Q1/Q2 标签；标题先清理字面量并压缩空白，再按最多 22 个可见列截断，已有答案的页签带 ✓。窄屏按预算缩短标题，无法同时容纳所有页签时保留当前页及空间允许的 Review，鼠标只命中实际可见标签；切页仍沿用完整页序。选项与 Review 焦点下 ←/→ 循环切页，第一题向左进入 Review，Review 向右回到第一题。文本编辑中的 ←/→ 留给光标移动；Enter 确认前进，最后一题进入 Review。Review 显示问题摘要与答案，↑/↓ 或滚轮查看，全部回答后 Enter 或 Submit 整批提交；有未回答题时提示数量并停留。单题确认直接提交，没有页签。
- Esc 返回搜索、评论、操作栏、历史/详情及文本编辑的上一级；处于选项列表、Review 或未编辑的文本题时 Esc 跳过整个询问，操作栏 Skip 同样跳过，并将已有选择和文字发送给模型。底部提示 Esc back 或 Esc skip。跳过后焦点回到宿主输入框，模型继续生成，此时再按 Esc 是 Pi 原生中断。关闭说明或历史只结束查看。
- /suite 显示当前询问开关、超时与空闲 Dock 行数；ui.maxRows 不限制询问高度。

询问期间公共通知协调器暂存 job 完成和 child 父级问题，直到原生询问结束并到达可投递边界，和 goal 继续请求合并为一条消息；只有系统取消进入 waiting_user 后须由新的用户输入或 /goal resume 恢复；跳过保持自动许可，空闲到期继续运行。child 提问交给直接父级的协议期限独立管理，父级实际调用的原生询问从展示开始计时，排队不消耗期限。草稿不会因查看历史而初始化，历史操作重置空闲倒计时。

ask_user 调用中只显示题干摘要或题目数；结果折叠为“题干 → 答案”或批量 answered 数，timed_out 带 auto-selected 与 unanswered 数，skipped 同时显示已有答案或 answered 数，cancelled 显示实际状态。展开保留每题题干、选项标记、自由文字和 comment；已选项使用 success。历史记录若含 context，renderer 按该记录展示；当前工具参数与新回执不含题目 context，不重写历史记录。子代理标题为 Ask parent。询问期间的 History 与主界面使用同一 Suite renderer；主会话工具结果的鼠标单项点击与 Pi 默认 Ctrl+O 由宿主管理，History 用 t 切换工具明细、i 切换 thinking，不将主会话鼠标能力泛化到历史阅读。

[返回当前文档](../index.md)

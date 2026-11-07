# ask 接口与操作

ask_user 是顺序执行工具，等待用户作答或空闲期限结算。单题使用 question；批量使用 2–4 项 questions，顶层 question 只作为整批标题。批量题型、context、options 和默认值必须放在各题内部；顶层批量题型参数会报告错误。

## 选项与默认值

options 支持字符串或 `{id?, title, description?, recommended?}`。未指定 ID 时生成 option-1 等 ID；预选值按原始选项 ID 引用。description 为选项说明，context 为问题背景；二者完整保留。

allowMultiple 默认 false，allowFreeform 默认 true。推荐标记在人工操作时只用于展示，不预勾选，也不进入答案标题；空闲到期时作为自动作答的候选。defaultAnswer 预填自由输入，defaultOptionId 预选单选，defaultOptionIds 预勾选多选。题型不匹配、默认值冲突和未知 ID 在展示前报错。有选项的 defaultAnswer 需要 allowFreeform。

默认值仅初始化一次；筛选、切题、查看历史、说明和终端缩放都保留用户编辑。多选按实际勾选集合提交；隐藏的选项继续保留真实勾选状态。allowComment 为 true 时提供可选评论输入。

## 超时与结果

timeoutMs 单位为毫秒，表示用户持续不操作的空闲时长；省略使用配置 ask.timeout 的默认 600000（10 分钟），0 不设期限。计时从第一次展示开始，排队期间不计时，整批共用一个计时器。每次按键、粘贴和实际处理的鼠标点击/滚轮重置完整时长，历史与说明阅读也计为操作；终端缩放不重置计时。倒计时显示 idle 分:秒。

返回 status 为 answered、skipped、timed_out 或 cancelled：

| 状态 | 结果与执行 |
| --- | --- |
| answered | 用户提交答案，模型与目标继续运行 |
| skipped | 顶层 Esc 或 Skip；无答案，模型继续，目标自动许可保持；不得当作同意 |
| timed_out | 空闲到期自动提交，可作为推荐方案继续；每个答案带 autoSelected: true，不能作为破坏性或需要同意操作的授权 |
| cancelled | signal 中止、会话切换/reload 或队列撤销；无答案，通过 terminate 结束本轮，当前目标进入 waiting_user 并停止自动工作 |

到期优先保留用户当前草稿（含预选/预填），否则单选取第一项推荐，多选取全部推荐；没有推荐时取第一个选项。自由输入模式中非空文字优先，空文字则按选项规则作答；无选项文本题无草稿时保持未回答，不编造文字。非空评论随选择或文字提交，不受 allowComment 是否展示输入入口影响。

保留单题 question/context/options/response/cancelled 和批量 kind/heading/questions/answers/cancelled 字段；cancelled 兼容标记仅在 skipped/cancelled 时为 true。批量到期答案按题目原顺序返回，不能自动作答的题为 {status: "unanswered"}；单题无选项且无文字时 response 为 null。

selection 响应保留 selections 原始标题和 optionIds；freeform 响应保留原始 text；两者可带 comment 与自动作答的 autoSelected 标记。人工多题回答需要 Review 整批确认。回答、跳过、超时和取消只结算一次。

## 操作

- 默认 inline 询问位于输入区域，保留主聊天与终端历史查阅。
- 单选用 ○/◉，多选用 ☐/☑，文字输入用 ✎；已选为 success 色，未选为 dim，光标 ❯ 和推荐为 accent。题目带题型与当前页信息，小终端保留当前答案行并压缩标签。
- ↑/↓ 移动选项，空格选择/勾选；单选 Enter 选中并确认，多选 Enter 只确认、不切换勾选，空集合提示 Space to select。自由输入 Enter 确认；Shift+Enter 等原生换行按键继续交给编辑器。Tab 进入/离开操作栏，←/→ 选动作，Enter 执行。
- `/` 搜索单选或多选；Enter 返回列表，筛选不修改勾选。PageUp/PageDown 翻页。
- 终端支持的鼠标滚轮在选项区移动当前选项，在历史、说明或 Review 区滚动阅读；滚轮不勾选、不提交，也不改变当前键盘焦点。点击页签切题，点击列表选择当前项；文字输入行点击进入编辑。
- `d` 或操作栏 View details 打开完整问题、背景与选项说明；宽度达到 100 列时另提供选项预览。
- `f` 或列表末尾的 ✎ Type your own answer 进入自由输入；Esc 返回列表，保留文本、光标和提交模式；再次勾选选项才改为提交勾选。无选项题直接进入文本编辑。文本确认复用 Pi Editor 的 disableSubmit，由 Ask 前进，保留草稿、光标及撤销状态。
- History 操作或默认 Ctrl+H 打开上方历史、下方问题与草稿的独立视图；Tab 在历史、回答和操作栏间切换，Ctrl+H 返回 inline。
- 历史/详情用 ↑/↓、PageUp/PageDown、Home/End 阅读；`/` 搜索，n/N 查下一/上一匹配。操作栏提供 Previous page、Next page、Back。历史中的 t/i 切换工具/thinking 展开。
- 批量显示每题页签与 Review；已有答案的页签带 ✓。选项与 Review 焦点下 ←/→ 循环切页，第一题向左进入 Review，Review 向右回到第一题。文本编辑中的 ←/→ 留给光标移动；Enter 确认前进，最后一题进入 Review。Review 显示问题摘要与答案，↑/↓ 或滚轮查看，全部回答后 Enter 或 Submit 整批提交；有未回答题时提示数量并停留。单题确认直接提交，没有页签。
- Esc 返回搜索、评论、操作栏、历史/详情及带选项文本编辑的上一级；处于选项列表、Review 或无选项文本题时 Esc 跳过整个询问，操作栏 Skip 同样跳过。底部提示 Esc back 或 Esc skip。跳过后焦点回到宿主输入框，模型继续生成，此时再按 Esc 是 Pi 原生中断。关闭说明或历史只结束查看。
- /suite 显示当前询问开关、超时和高度配置。

询问期间公共通知协调器暂存 job 完成和 child 父级问题，直到原生询问结束并到达可投递边界，和 goal 继续请求合并为一条消息；只有系统取消进入 waiting_user 后须由新的用户输入或 /goal resume 恢复；跳过保持自动许可，空闲到期继续运行。child 提问交给直接父级的协议期限独立管理，父级实际调用的原生询问从展示开始计时，排队不消耗期限。草稿不会因查看历史而初始化，历史操作重置空闲倒计时。

ask_user 调用中只显示题干摘要或题目数；结果折叠为“题干 → 答案”或批量 answered 数，timed_out 带 auto-selected 与 unanswered 数，skipped/cancelled 显示实际状态。展开保留每题题干、context、选项标记、自由文字和 comment；已选项使用 success。子代理标题为 Ask parent。询问期间的 History 与主界面使用同一 Suite renderer；鼠标点击单项或 Pi 默认 Ctrl+O 可展开工具，历史内 t 切换工具明细。

[返回当前文档](../index.md)

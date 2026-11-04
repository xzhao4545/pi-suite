# ask 接口与操作

ask_user 是顺序执行工具，等待用户明确提交。单题使用 question；批量使用 2–4 项 questions，顶层 question 只作为整批标题。批量题型、context、options 和默认值必须放在各题内部；顶层批量题型参数会报告错误。

## 选项与默认值

options 支持字符串或 `{id?, title, description?, recommended?}`。未指定 ID 时生成 option-1 等 ID；预选值按原始选项 ID 引用。description 为选项说明，context 为问题背景；二者完整保留。

allowMultiple 默认 false，allowFreeform 默认 true。推荐标记只用于展示，不勾选或提交，也不进入答案标题。defaultAnswer 预填自由输入，defaultOptionId 预选单选，defaultOptionIds 预勾选多选。题型不匹配、默认值冲突和未知 ID 在展示前报错。有选项的 defaultAnswer 需要 allowFreeform。

默认值仅初始化一次；筛选、切题、查看历史、说明和终端缩放都保留用户编辑。多选按实际勾选集合提交；隐藏的选项继续保留真实勾选状态。allowComment 为 true 时提供可选评论输入。

## 超时与结果

timeout 单位为毫秒，省略使用配置默认 120000；0 不设期限。计时从第一次展示开始，排队期间不计时，查阅历史或说明不重置期限，整批问题共用一个期限。

返回 status 为 answered、timed_out 或 cancelled。超时与取消均不返回答案，不把默认值或推荐当作同意。非回答结果通过工具 terminate 结束当前宿主循环；归属当前目标时持久化 waiting_user，等待新的用户输入或 /goal resume。保留单题 question/context/options/response/cancelled 和批量 kind/heading/questions/answers/cancelled 字段；非回答结果的 cancelled 兼容标记为 true，具体原因以 status 为准。

selection 响应保留 selections 原始标题和 optionIds；freeform 响应保留 text。多题需要整批最终确认。回答、超时和取消只结算一次。

## 操作

- 默认 inline 询问位于输入区域，保留主聊天与终端历史查阅。
- ↑/↓ 移动选项，空格或 Enter 明确选择/勾选；Tab 到操作栏，←/→ 选动作，Enter 执行 Confirm。自由输入 Enter 确认当前题。
- `/` 搜索单选或多选；Enter 返回列表，筛选不修改勾选。PageUp/PageDown 翻页。
- `d` 或操作栏 View details 打开完整问题、背景与选项说明；宽度达到 100 列时另提供选项预览。
- `f` 或 Freeform 进入自由输入；Esc 返回选项，保留文本。
- History 操作或默认 Ctrl+H 打开上方历史、下方问题与草稿的独立视图；Tab 在历史、回答和操作栏间切换，Ctrl+H 返回 inline。
- 历史/详情用 ↑/↓、PageUp/PageDown、Home/End 阅读；`/` 搜索，n/N 查下一/上一匹配。操作栏提供 Previous page、Next page、Back。历史中的 t/i 切换工具/thinking 展开。
- 批量题目通过 Previous question/Next question 切换；最后一题确认后进入整批复核，Submit all 才提交。
- Esc 返回当前输入或详情的上一级；处于选择列表或无选项文本题时 Esc 取消询问；操作栏 Cancel 明确取消。关闭说明或历史只结束查看。
- /suite 显示当前询问开关、超时和高度配置。

询问期间公共通知协调器暂存完成消息；草稿及倒计时不会因查看历史而初始化。

[返回当前文档](../index.md)

# 模型工具契约

模型工具由唯一扩展入口按模块准入注册，同一操作使用一个工具名。参数采用 camelCase，时间以 Ms、字节以 Bytes 标注；配置键、命令和界面快捷键按对应模块文档维护。

## 共享参数与返回

runtime/tools.ts 提供 objectId、listFields、paginate、readFields、WAIT_ID_PATTERN、StopOutcome 和 textResult；jobs/agents 的列表、读取、停止及共享 wait 复用这些定义。领域状态与业务字段保留在对应模块，不另建通用对象注册表。

| 契约 | 当前规则 |
| --- | --- |
| 对象 ID | job_/agent_/run_ 后接 8 位小写十六进制，wf_ 后接 12 位；task 组为递增数字字符串、子任务为 `组.序号`（如 `1.2`），执行工具只接受子任务 ID，goal 使用当前目标契约的精确 goalId |
| 单项与列表 | task/job/agent 使用 list 与 get 独立入口；列表没有单项 id，agent_list.agentId 可与历史筛选组合。tasks 默认 unfinished，jobs/agents 默认 active/session，agent 另有 queued |
| 分页 | limit 默认 10、最大 100；同时限制约 4 KiB 页面正文，按记录边界返回 nextCursor。jobs/agents 按创建时间与 ID 倒序；tasks 按组创建时间、组/子 ID 正序，中间页补充组上下文 |
| 字节读取 | limitBytes 默认 4096、最大 65536；offset 为原始字节位置，处理 UTF-8 边界；返回 text/stream/offset/nextOffset/totalBytes/endOfStream 及截断或搜索信息 |
| 搜索 | 正则与 /re/flags 共用读取语法；context 默认 2、最大 20，不能脱离 search 单独使用 |
| 等待 | wait.ids 为 1–50 个 job/agent/workflow ID，mode 默认 all；timeoutMs 默认 300000、最大 3600000，只结束此次调用，不停止对象 |
| 停止 | requested/state/cleanup/affected，affected 列出真实受影响对象；清理尚未确认时不报告全部停止 |

单对象操作首行显示对象摘要，列表与 wait 显示集合摘要，goal 显示目标动作；其后提供实际变化、失败、问题与必要读取入口，固定操作说明位于工具描述。普通回执目标 1–3 行、约 512 B；批量新 ID、父级待答问题/选项、真实答案与评论、错误与清理结果优先于预算。details 保存同一结果的结构化字段，用于本地显示和控制，Provider 的模型正文使用 content。ask_user 主会话与 child 共用文本结果格式：单题只含状态与答案，批量含作答计数、编号、截断题干与逐题答案；context、完整 questions/options 和响应结构只保存在 details。timed_out 与 skipped 的答案不得视为同意，正文通过 not consent 或 unanswered 明确标记；child 追加 source: parent。完整输出与日志通过 read 按需读取，规则见 [jobs 读取与操作](../jobs/index.md)。

runtime/read.ts 的 readContinuation 共用 offset/search/context/limitBytes 续读字段，job_read 与 agent_read 的 more 提示保留当前读取方式。默认截断的 keys 数组记录所选匹配行及上下文原始范围；正文明确标注遗漏，full 提示使用 offset:0 进入连续读取；搜索正文、上下文和标注共同计入字节预算，超长返回行显式截断，boundedText 也供结算预览复用。

逻辑行按块累积，仅在 LF 或 EOF 合并一次；匹配前保留整行，匹配后按返回预算保存上下文。组装与原始字节扫描为线性成本，单行缓冲及解码内存随最长逻辑行增长。boundedText 只编码可能进入返回值的前缀，避免为小预览分配整行的 UTF-8 副本。

agent 工具使用稳定 ID，runId 按需选择历史执行；handle/alias 的发送与补全属于 TUI 提及入口，见 [agents 操作](../agents/operations.md)。jobs 与 agents 共用生命周期语义，领域终态分别包含 timed_out 与 limited；活动判断还核对真实清理边界。

ask_user.timeoutMs 只控制询问期限；wait.timeoutMs 只控制等待调用；job_start.timeoutMs 控制 job 的运行期限并实际停止超时进程。相同单位不表示相同作用范围。

## 公共工具显示

ui/tool-render.ts 的 ToolView 提供 call、collapsed 与可选 expanded；统一构造 renderCall/renderResult，并使用 Pi 默认工具外壳。原生 Box 负责 pending/success/error 背景与 outputPad，Suite 正文以零 padding 的 Text/Container 处理 ANSI、中文、emoji 和多行布局，不绘制工具上下横线。有 partial 或最终结果后通过 ctx.state.finished 隐藏调用正文，由结果接管同一执行块；折叠正文固定一行，展开保留完整对象与状态概览。错误始终显示 error 图标和完整 error 正文。工具展开、鼠标区域、图片与调用/结果流式配对仍由 Pi ToolExecutionComponent 管理，不新增工具交互容器。

ToolLine 清理字面字段并压平换行，折叠行按可见宽度截断；图标按 tone 着色，主要标题使用 toolTitle，titleTone 可显式保留任务状态色，summary 使用 toolOutput，meta 默认 dim 或指定语义色，任务完成标题支持删除线。stateLine 复用 Browser/Dock 的 stateTone：starting/running 为 success，queued/waiting/waiting(parent)/stopping 与清理未确认为 warning，failed/limited/timed_out 为 error，completed/stopped 为 dim。

ToolView.expanded 可返回结构化 ToolLine、ToolField、ToolCode、ToolCommand、字面字符串数组，或原生 Component。ToolField 标签为 muted，值保留多行并按正文/错误/警告角色着色；ToolCode 只接受明确 language 或真实 path，ToolCommand 明确声明 bash/powershell。命令、代码与 JSON 使用 Pi highlightCode，普通日志和任意正文保持字面量，不进行 Markdown 或语言猜测。所有不可信字面内容先 sanitize 再生成可信 ANSI，原生 Component 的生产者负责同一边界。公共组件保留布局和高亮缓存，内容、宽度、语言与主题变化时更新或 invalidate，ANSI 不写入业务状态。未提供 expanded 时显示模型正文全文；敏感 job_write 输入在展开中保持隐藏，可能回显输入的错误诊断在着色前脱敏，模型 content/details 保持原样。

普通 subagent 的 agent_start/list/get/read/send/stop 以 AgentRecord.name 为主标识，ID 仅在展开正文或 dim 元信息中出现；集合折叠行保留数量/范围。启动调用以 name 或类型名显示；只有 ID 的调用通过 agents/runtime.ts 的 agentDisplayName 查询已有进程级 Manager 内存记录，可带 runId 选择执行，找不到时显示 ID，不创建运行时、不发现或读取磁盘历史。stop 的 details 保存名称，历史结果可直接显示。

状态图标为 ⟳ 进行中、⧗ 排队、? 等待、✔ 完成、✘ 失败、⊘ 停止/跳过/取消、⏱ 超时/受限；tasks 使用自己的 ☐/⟳/⚠/☑ 语义。单项鼠标展开与 app.tools.expand（默认 Ctrl+O）由 Pi 宿主管理，折叠行不追加操作提示。

扩展工厂通过 runtime/renderers.ts 与 Pi registerToolRenderer 在加载阶段登记所有 Suite 工具的纯展示定义；childSuite 在绑定执行工具前调用同一登记入口，并传入 run.config.ui.highlightBuiltinCommands 的准入快照。child 的显示配置归属 run.configCwd，不根据可独立指定的执行目录 record.cwd 重读设置。registerSuiteRenderers 的可选参数接受固定布尔值或归属方提供的布尔 provider；主会话使用当前配置目录的 reload 快照。历史组件在 session_start 之前重建时即可使用，reload、resume 与重启沿用相同的摘要、展开和错误显示。展示注册不启用模型工具、不创建执行模块；模块关闭或当前工具选择未包含某工具时，其历史记录仍可阅读。已注册工具或其他扩展提供的 renderer 优先于历史展示定义。

runtime/tools.ts 的 registerToolRenderers 支持按工具名组合已有 renderer；live resolver 调用 next() 保留后续扩展与原生定义，纯展示 lookup 使用同一组合。ui.highlightBuiltinCommands 默认 true，仅增强内置模型 bash/powershell 的命令调用区；增强仍调用原生 renderCall 维护计时，保留 renderShell、renderResult、超时、部分参数、流式输出、截断、图片与展开能力。false 使用完整原生调用显示；已有第三方 self-shell 保留自身组合。用户 !/!! 的 BashExecutionComponent、原生 read/write 代码与 edit diff 不受该选项影响。

src/ui/rendering/command.ts 导出 commandComponent(command, shell, theme): Component，shell 为 bash 或 powershell，供 Jobs 顶部和 Suite ToolCommand 展开复用。返回组件按原始命令及真实 shell 语言高亮，不执行命令；调用方保留组件实例并在主题/布局失效时 invalidate。Jobs 和 Suite 命令字段始终高亮，不受内置工具专用选项影响。

runtime/tools.ts 的 registerBoundTool 同时登记运行时 renderer；首次加载只注册工具，运行时刷新保留活动工具选择，显式启用时加入该工具。renderer lookup 按 ExtensionAPI 隔离，主会话与 child 的 ask_user 可使用不同标题。Ask Transcript 使用同一查找，child 查看器使用实际 run.renderers；历史结果使用持久化 content/details 重新绘制，不改写记录、不重新执行工具或请求模型。wait 折叠只显示结算比例、失败计数与提前返回原因，展开保留逐项摘要、others 与 pending；普通 agent 的逐项主标识与 pending 按现有内存记录显示名称，无记录时保留 ID，job/workflow 显示不变。替换仅在渲染层进行，content、summaryLine、通知文本及展开正文中的 read/send 参数保持原始 ID 契约。

pi-suite:notification 使用 Pi 默认消息显示，标题为 `[pi-suite:notification]`，正文保留通知中的 agent_/run_ ID；Suite 不注册专用消息 renderer。

## 错误边界

模型工具使用共享 ToolError，在文本消息开头保留错误码，并指出原因或下一步。列表入口的 prepareArguments 拒绝单项或未知字段并给出 list/get 修正示例；task_edit 的 op 与字段共同校验，错误明确整批未提交。公共错误包括 INVALID_ARGS、NOT_FOUND、HISTORY_READ_ONLY、NOT_RUNNING、USER_CONTROL、STALE_BINDING、CLOSING、UNSUPPORTED_STREAM；领域还可报告明确的类型、深度、任务关联或运行时协议错误。原始存储/命令交互错误由对应边界解释，不作为另一套模型工具协议。

goal_complete、goal_blocked、goal_wait 的空白参数为 INVALID_ARGS，未知 goalId 为 NOT_FOUND，非 active 目标为 NOT_RUNNING，失效运行归属或绑定为 STALE_BINDING，详见 [目标操作](../goal/operations.md)。占用的 jobs 运行时缺少所需控制能力时为 RUNTIME_UNAVAILABLE，详见 [jobs 协议与范围](../jobs/index.md)。

完整 JavaScript 正则求值耗尽引擎栈等 RangeError 资源时返回 REGEX_RESOURCE_LIMIT，包含失败行的原始字节数、offset、引擎消息及分页建议；整次搜索失败，不返回部分命中，不截断匹配输入或切换正则引擎。任意正则不承诺有界执行时间，原始 offset 分页可独立使用。

各模块入口与字段见 [ask](../ask/index.md)、[goal](../goal/operations.md)、[tasks](../tasks/index.md)、[jobs](../jobs/index.md)、[agents](../agents/operations.md) 与 [workflow](../agents/workflow/operations.md)。

[返回公共运行时](index.md)

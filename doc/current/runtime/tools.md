# 模型工具契约

扩展按[模块开关](index.md#配置)注册工具。每项操作对应一个工具名。参数用 camelCase，毫秒字段以 `Ms` 结尾，字节数以 `Bytes` 结尾。

## 共享参数与返回

`runtime/tools.ts` 提供共享的 ID 校验、列表字段与分页、读取字段、停止结果类型和文本结果构造函数。各模块定义自己的业务字段和状态。

| 契约 | 当前规则 |
| --- | --- |
| 对象 ID | job_/agent_/run_ 后接 8 位小写十六进制，wf_ 后接 12 位；task 组为递增数字字符串、子任务为 `组.序号`（如 `1.2`），执行工具只接受子任务 ID，goal 使用当前目标契约的精确 goalId |
| 单项与列表 | task/job/agent 使用 list 与 get 独立入口；列表没有单项 id，agent_list.agentId 可与历史筛选组合。tasks 默认 unfinished，jobs/agents 默认 active/session，agent 另有 queued |
| 分页 | limit 默认 10、最大 100；同时限制约 4 KiB 页面正文，按记录边界返回 nextCursor。jobs/agents 按创建时间与 ID 倒序；tasks 按组创建时间、组/子 ID 正序，中间页补充组上下文 |
| 字节读取 | `limitBytes` 默认 4096，范围 64–65536。`offset` 按原始字节计数，连续分页避开 UTF-8 字符中间。返回 `text`、`stream`、`offset`、`nextOffset`、`totalBytes`、`endOfStream` 及截断或搜索信息 |
| 搜索 | `search` 接受 1–500 字符的正则。裸表达式忽略大小写，`/re/flags` 可显式指定标志（`g` 被移除）。每页最多 50 个匹配；`context` 为 0–20 行，默认 2，仅与 `search` 一起使用 |
| 等待 | `ids` 为 1–50 个 job、agent 或 workflow ID，`mode` 可选 `all`（默认）或 `any`。`timeoutMs` 默认 300000，范围 1–3600000。提前返回、取消和结果消费见[共享等待](index.md#共享等待) |
| 停止 | requested/state/cleanup/affected，affected 列出真实受影响对象；清理尚未确认时不报告全部停止 |

单项结果首行是对象摘要，列表与 wait 首行是集合摘要，goal 首行是目标动作。后续行给出实际变化、失败、问题与需要的后续调用。普通回执以 1–3 行、约 512 B 为目标；新 ID、父级待答问题及选项、答案与评论、错误和清理结果优先完整返回。`content` 是模型正文，`details` 保存供显示和控制使用的结构化结果。

主会话和 child 的 `ask_user` 使用同一格式：状态、逐题编号、最多 24 个 Unicode 码点的短题干，以及完整的答案、评论和自定义输入。同名选项按原列表中的 `#N` 区分。`details` 保存完整题目、选项和回复。题目没有 `context`，选项可有 `description`；历史只读。`timed_out` 和 `skipped` 明示 `not consent`，自动选择逐题标为 `auto-selected`。`skipped` 保留部分作答，未答项标为 `unanswered`。`cancelled` 表示取消，不提供授权。child 结果附 `source: parent`。

`job_read` 和 `agent_read` 复用 `runtime/read.ts`。默认截断时，`truncated.keys` 记录选中行及上下文的原始字节区间，正文标明省略范围。`full:` 从 `offset: 0` 开始连续读取；`more:` 用 `nextOffset` 接着读。两种提示都通过 `readContinuation`（生成续读参数）保留本次的搜索、上下文和字节上限。搜索正文、上下文和标注一起计入字节上限。超长行显式截断；结算预览也用 `boundedText`（按 UTF-8 字节数截断）。

读取器逐块扫描原始字节，到 LF 或 EOF 时才合并一行。整行参与匹配，返回时才按预算截断。扫描和拼接成本随输入线性增长，单行缓冲和解码占用随最长行增长。`boundedText` 只编码可能返回的前缀。

agent 工具使用稳定 ID，runId 按需选择历史执行；handle/alias 的发送与补全属于 TUI 提及入口，见 [agents 操作](../agents/operations.md)。jobs 与 agents 共用生命周期语义，领域终态分别包含 timed_out 与 limited；活动判断还核对真实清理边界。

ask_user.timeoutMs 只控制询问期限；wait.timeoutMs 只控制等待调用；job_start.timeoutMs 控制 job 的运行期限并实际停止超时进程。相同单位不表示相同作用范围。

## 公共工具显示

ui/tool-render.ts 的 ToolView 提供 call、collapsed 与可选 expanded；统一构造 renderCall/renderResult，并使用 Pi 默认工具外壳。原生 Box 负责 pending/success/error 背景与 outputPad，Suite 正文以零 padding 的 Text/Container 处理 ANSI、中文、emoji 和多行布局，不绘制工具上下横线。有 partial 或最终结果后通过 ctx.state.finished 隐藏调用正文，由结果接管同一执行块；折叠正文固定一行，展开保留完整对象与状态概览。错误时摘要行显示 error 图标和调用标题：折叠时附诊断首行，展开时在下方以 error 色显示完整诊断，摘要行只保留工具提供的标签。ToolView.error 可为拒绝提供标签和独立于模型正文的诊断（StructuredOutput 用 `rejected`）。toolRenderers 的 `timing` 选项在摘要行右侧以 dim 显示时长：执行中按实时计时刷新，结束后显示宿主记录的执行时长；wait 使用 `elapsedText`。工具展开、鼠标区域、图片与调用/结果流式配对仍由 Pi ToolExecutionComponent 管理，不新增工具交互容器。

ToolLine 清理字面字段并压平换行，折叠行按可见宽度截断；图标按 tone 着色，主要标题使用 toolTitle，titleTone 可显式保留任务状态色，summary 使用 toolOutput，meta 默认 dim 或指定语义色，任务完成标题支持删除线。stateLine 复用 Browser/Dock 的 stateTone：starting/running 为 success，queued/waiting/waiting(parent)/stopping 与清理未确认为 warning，failed/limited/timed_out 为 error，completed/stopped 为 dim。

ToolView.expanded 可返回结构化 ToolLine、ToolField、ToolCode、ToolCommand、字面字符串数组，或原生 Component。ToolField 标签为 muted，值保留多行并按正文/错误/警告角色着色；ToolCode 只接受明确 language 或真实 path，ToolCommand 明确声明 bash/powershell。普通代码与 JSON 使用 Pi highlightCode，显式命令使用共享 Shell 词法区间与活动主题角色；普通日志和任意正文保持字面量，不进行 Markdown 或语言猜测。所有不可信字面内容先 sanitize 再生成可信 ANSI，原生 Component 的生产者负责同一边界。公共组件保留源码区间、布局和高亮缓存，内容、宽度、语言、用途模式与主题变化时更新或 invalidate，ANSI 不写入业务状态。未提供 expanded 时显示模型正文全文；敏感 job_write 输入在展开中保持隐藏，可能回显输入的错误诊断在着色前脱敏，模型 content/details 保持原样。

普通 subagent 的 agent_start/list/get/read/send/stop 以 AgentRecord.name 为主标识，ID 仅在展开正文或 dim 元信息中出现；集合折叠行保留数量/范围。启动调用以 name 或类型名显示；只有 ID 的调用通过 agents/runtime.ts 的 agentDisplayName 查询已有进程级 Manager 内存记录，可带 runId 选择执行，找不到时显示 ID，不创建运行时、不发现或读取磁盘历史。stop 的 details 保存名称，历史结果可直接显示。

状态图标为 ⟳ 进行中、⧗ 排队、? 等待、✔ 完成、✘ 失败、⊘ 停止/跳过/取消、⏱ 超时/受限；tasks 使用自己的 ☐/⟳/⚠/☑ 语义。主会话中的单项鼠标展开与 app.tools.expand（默认 Ctrl+O）由 Pi 宿主管理，折叠行不追加操作提示。复杂阅读 overlay 的鼠标能力另见 [终端交互边界](../ui/terminal.md#原生阅读与鼠标)，不根据 renderer 或原生工具实例的存在推定事件能够命中。

展示定义的注册时机见 [renderer 提前注册](index.md#renderer-提前注册)。模块关闭或工具未激活时，历史仍可阅读：渲染只读持久化的 `content` 和 `details`，不修改记录、不执行工具、不请求模型。

`registerToolRenderers` 按工具名组合 renderer。Pi 已注册的 renderer 优先于历史默认值；实时显示通过 `next()` 取得后续扩展或原生定义，只读查询使用同样的组合。内置命令调用的选项、保留的原生行为以及 Jobs 和 Suite 的命令高亮见 [命令结构高亮](../ui/command-highlighting.md)。

Ask Transcript 使用共享 renderer 查询，child 查看器使用该次执行的 `run.renderers`。wait 折叠显示结算比例、失败数、提前返回原因和已等待时长，展开显示逐项摘要、`others` 和 `pending`。

其余工具的展开内容来自 details 字段，不附模型回执文本（job_start 附上全文、wait 除外）：

- agent_start/get/send 展开为 id、runId、state、model、thinking、turns、toolUses、任务关联、activity、usage 与 error 等字段；start 另有 promptSummary 和 resultSummary，send 先列 action，get 的 `detail:true` 另有模型/thinking 来源、contextUsage、lastUpdateAt，以及 question 与所属 jobs。agent_stop 与 job_stop 展开为 runId 或 job 字段、requested、cleanup 和 affected。
- job_get 展开为 command、cwd、timeout、任务关联、state、cleanup、error、live 和完整 details JSON。
- agent_read 与 job_read 折叠为 `<stream> <offset>–<nextOffset> / <totalBytes> B`（job_read 有搜索时附匹配数），展开为分页字段加字面输出，不按 Markdown 或代码解析；job_read 的 stderr 字节数单独列为 stderrBytes。
- job_write 折叠为 `sent N B`，关闭输入时附 `stdin closed`；展开为输入（敏感时为 `[sensitive]`）、bytesSent 与 stdinClosed。
- goal_complete 展开为完成摘要；StructuredOutput 折叠为 `accepted`，展开为提交的 JSON。agent 摘要和 `pending` 里的 ID 可在显示时替换成内存记录中的名称，找不到则显示 ID；job、workflow、模型正文、通知和展开的 read/send 参数保持原 ID。

`pi-suite:notification` 有专用 renderer。它按 `details.segments` 隐藏 Goal 自动续跑片段，带显示视图的事件折叠时各占一行、展开后显示正文。缺少匹配的元数据或真实事件含非文本内容时，交给 Pi 原生显示。格式见[通知消息格式](index.md#通知消息格式)。

## 错误边界

模型工具使用共享 ToolError，在文本消息开头保留错误码，并指出原因或下一步。列表入口的 prepareArguments 拒绝单项或未知字段并给出 list/get 修正示例；task_edit 的 op 与字段共同校验，错误明确整批未提交。公共错误包括 INVALID_ARGS、NOT_FOUND、HISTORY_READ_ONLY、NOT_RUNNING、USER_CONTROL、STALE_BINDING、CLOSING、UNSUPPORTED_STREAM；领域还可报告明确的类型、深度、任务关联或运行时协议错误。原始存储/命令交互错误由对应边界解释，不作为另一套模型工具协议。

goal_complete、goal_blocked、goal_wait 的空白参数为 INVALID_ARGS，未知 goalId 为 NOT_FOUND，非 active 目标为 NOT_RUNNING，失效运行归属或绑定为 STALE_BINDING，详见 [目标操作](../goal/operations.md)。占用的 jobs 运行时缺少所需控制能力时为 RUNTIME_UNAVAILABLE，详见 [jobs 协议与范围](../jobs/index.md)。

完整 JavaScript 正则求值耗尽引擎栈等 RangeError 资源时返回 REGEX_RESOURCE_LIMIT，包含失败行的原始字节数、offset、引擎消息及分页建议；整次搜索失败，不返回部分命中，不截断匹配输入或切换正则引擎。任意正则不承诺有界执行时间，原始 offset 分页可独立使用。

各模块入口与字段见 [ask](../ask/index.md)、[goal](../goal/operations.md)、[tasks](../tasks/index.md)、[jobs](../jobs/index.md)、[agents](../agents/operations.md) 与 [workflow](../agents/workflow/operations.md)。

[返回公共运行时](index.md)

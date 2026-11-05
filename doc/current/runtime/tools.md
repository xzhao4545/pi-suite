# 模型工具契约

模型工具由唯一扩展入口按模块准入注册，同一操作使用一个工具名。参数采用 camelCase，时间以 Ms、字节以 Bytes 标注；配置键、命令和界面快捷键按对应模块文档维护。

## 共享参数与返回

runtime/tools.ts 提供 objectId、listFields、paginate、readFields、WAIT_ID_PATTERN、StopOutcome 和 textResult；jobs/agents 的列表、读取、停止及共享 wait 复用这些定义。领域状态与业务字段保留在对应模块，不另建通用对象注册表。

| 契约 | 当前规则 |
| --- | --- |
| 对象 ID | job_/agent_/run_ 后接 8 位小写十六进制，wf_ 后接 12 位；task 为清单内递增数字字符串，goal 使用当前目标契约的精确 goalId |
| 单项与列表 | id 与 state/scope/cursor/limit 互斥；列表默认 active/session，agent 另有 queued |
| 分页 | limit 默认 20、最大 100；按创建时间与 ID 倒序，返回 nextCursor |
| 字节读取 | limitBytes 默认 16384、最大 65536；offset 为原始字节位置，处理 UTF-8 边界；返回 text/stream/offset/nextOffset/totalBytes/endOfStream 及截断或搜索信息 |
| 搜索 | 正则与 /re/flags 共用读取语法；context 默认 2、最大 20，不能脱离 search 单独使用 |
| 等待 | wait.ids 为 1–50 个 job/agent/workflow ID，mode 默认 all；timeoutMs 默认 300000、最大 3600000，只结束此次调用，不停止对象 |
| 停止 | requested/state/cleanup/affected，affected 列出真实受影响对象；清理尚未确认时不报告全部停止 |

单对象操作首行显示对象摘要，列表与 wait 显示集合摘要，goal 显示目标动作；其后提供必要正文与可用后续入口。details 保存同一结果的结构化字段。完整输出与日志通过 read 按需读取，规则见 [jobs 读取与操作](../jobs/index.md)。

runtime/read.ts 的 readContinuation 共用 offset/search/context/limitBytes 续读字段，job_read 与 agent_read 的 more 提示保留当前读取方式。默认截断的 keys 数组记录所选匹配行及上下文原始范围；搜索正文、上下文和标注共同计入字节预算，超长返回行显式截断，boundedText 也供结算预览复用。

逻辑行按块累积，仅在 LF 或 EOF 合并一次；匹配前保留整行，匹配后按返回预算保存上下文。组装与原始字节扫描为线性成本，单行缓冲及解码内存随最长逻辑行增长。boundedText 只编码可能进入返回值的前缀，避免为小预览分配整行的 UTF-8 副本。

agent 工具使用稳定 ID，runId 按需选择历史执行；handle/alias 的发送与补全属于 TUI 提及入口，见 [agents 操作](../agents/operations.md)。jobs 与 agents 共用生命周期语义，领域终态分别包含 timed_out 与 limited；活动判断还核对真实清理边界。

ask_user.timeoutMs 只控制询问期限；wait.timeoutMs 只控制等待调用；job_start.timeoutMs 控制 job 的运行期限并实际停止超时进程。相同单位不表示相同作用范围。

## 错误边界

模型工具使用共享 ToolError，在文本消息开头保留错误码，并指出原因或下一步。公共错误包括 INVALID_ARGS、NOT_FOUND、HISTORY_READ_ONLY、NOT_RUNNING、USER_CONTROL、STALE_BINDING、CLOSING、UNSUPPORTED_STREAM；领域还可报告明确的类型、深度、任务关联或运行时协议错误。原始存储/命令交互错误由对应边界解释，不作为另一套模型工具协议。

goal_complete、goal_blocked、goal_wait 的空白参数为 INVALID_ARGS，未知 goalId 为 NOT_FOUND，非 active 目标为 NOT_RUNNING，失效运行归属或绑定为 STALE_BINDING，详见 [目标操作](../goal/operations.md)。占用的 jobs 运行时缺少所需控制能力时为 RUNTIME_UNAVAILABLE，详见 [jobs 协议与范围](../jobs/index.md)。

完整 JavaScript 正则求值耗尽引擎栈等 RangeError 资源时返回 REGEX_RESOURCE_LIMIT，包含失败行的原始字节数、offset、引擎消息及分页建议；整次搜索失败，不返回部分命中，不截断匹配输入或切换正则引擎。任意正则不承诺有界执行时间，原始 offset 分页可独立使用。

各模块入口与字段见 [ask](../ask/index.md)、[goal](../goal/operations.md)、[tasks](../tasks/index.md)、[jobs](../jobs/index.md)、[agents](../agents/operations.md) 与 [workflow](../agents/workflow/operations.md)。

[返回公共运行时](index.md)

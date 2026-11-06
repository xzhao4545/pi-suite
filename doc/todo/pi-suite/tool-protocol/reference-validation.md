# OMP 对照与验收

## 参考实现

继续固定于 OMP 提交 `f6d0dd718302126605e8c67a50aaca76062af828`，不以可变 main 的不同版本混用协议。

| 源码/协议 | 已确认行为与本项目借鉴 |
| --- | --- |
| [todo 协议](https://github.com/can1357/oh-my-pi/blob/f6d0dd718302126605e8c67a50aaca76062af828/docs/tools/todo.md) | 顶层 op，start/done/block/unblock；view 无需两个竞争目标字段。借鉴明确操作，Suite 继续用稳定数字 ID 与并发原子变更 |
| [task 入口](https://github.com/can1357/oh-my-pi/blob/f6d0dd718302126605e8c67a50aaca76062af828/packages/coding-agent/src/task/index.ts)、[task 协议](https://github.com/can1357/oh-my-pi/blob/f6d0dd718302126605e8c67a50aaca76062af828/docs/tools/task.md) | 后台 spawn content 主要为 agent/job ID；delegation 指导置于工具描述，启动确认不重复。同步完成或异步结算保留真实结果，而非始终只返回 ID |
| [task 结果模板](https://github.com/can1357/oh-my-pi/blob/f6d0dd718302126605e8c67a50aaca76062af828/packages/coding-agent/src/prompts/tools/task-summary.md) | 保留 ID、状态、duration、abort/error、截断标记、全文引用及 merge 信息；大结果给 preview。该版本文档说明 11500 字符内完整输出，超出给 5000 字符预览；Suite 不直接照搬阈值 |
| [proc 读取与控制](https://github.com/can1357/oh-my-pi/blob/f6d0dd718302126605e8c67a50aaca76062af828/packages/coding-agent/src/internal-urls/proc-protocol.ts) | proc:// 列出状态/耗时/标签和实际进度，单项按需读取结果/error；写 kill 与读状态分开，错误给可执行修正。不将所有诊断字段放进每次列表 |
| [agent 全文与结构化提取](https://github.com/can1357/oh-my-pi/blob/f6d0dd718302126605e8c67a50aaca76062af828/packages/coding-agent/src/internal-urls/agent-protocol.ts) | agent:// 指向完整结果，可提取 JSON 指定路径；未发布或先前执行的结果有明确状态说明。借鉴可定位结果和精确执行边界，复用 Suite agent_read/结果存储 |
| [bash 协议](https://github.com/can1357/oh-my-pi/blob/f6d0dd718302126605e8c67a50aaca76062af828/docs/tools/bash.md)、[read 协议](https://github.com/can1357/oh-my-pi/blob/f6d0dd718302126605e8c67a50aaca76062af828/docs/tools/read.md) | 正常返回实际输出，失败保留退出码/超时；长输出有截断与 artifact 信息。读取与输出预算属于宿主能力，不能只靠 TUI 折叠减少模型输入 |
| [wait 协议](https://github.com/can1357/oh-my-pi/blob/f6d0dd718302126605e8c67a50aaca76062af828/docs/tools/wait.md)、[异步 job manager](https://github.com/can1357/oh-my-pi/blob/f6d0dd718302126605e8c67a50aaca76062af828/packages/coding-agent/src/async/job-manager.ts) | OMP wait 无参数；已交付结果被消费，不重复发 async-result，模型可以继续有用工作而非轮询。Suite 保留 ids/mode/timeoutMs 的定向等待能力，借鉴单次交付和短状态反馈 |
| [task 动态 schema](https://github.com/can1357/oh-my-pi/blob/f6d0dd718302126605e8c67a50aaca76062af828/packages/coding-agent/src/task/types.ts) | 按启用能力构建参数形状；某些路径有明确 lenient 修正。Suite 不用未知参数删除或静默猜测修正有副作用操作，只隐藏未启用能力并提供清晰错误示例 |

OMP 的 proc:// / agent:// / artifact:// 属于其内部 URL 路由。Suite 已有原生领域工具、读取和存储框架，本专项不复制一套 URL 路由、子代理注册表或异步运行时；列表/get 的具体拆分是针对 Suite 已发生错误的设计，并非宣称 OMP 有同名工具。

## 验证指标

| 指标 | 比较方式与目标 |
| --- | --- |
| 首次调用正确率 | 使用“列清单/列某组/看单项/看历史执行/更新状态”等相同意图，在用户实际模型与配置下比较有效首次调用占比；区分参数错误与业务不可用，报告样本量 |
| 重复 INVALID_ARGS | 回放此次 13 个重复参数反例所代表的查询；新协议能用明确入口成功执行，错误时获得可直接重试示例，不重复原样失败 |
| schema 与描述成本 | 比较实际注册并发送的所有工具 schema/description；记录新增 get 固定开销，不能宣称工具变多却一定更省 |
| 返回与总上下文 | 比较相同数据下 content 的 UTF-8 字节与实际模型 tokenizer token；连同参数、纠错轮次、分页读取和通知一起统计，UI/disk details 的节省单列 |
| 信息完整性 | ID/runId、父子关系、进度、有效阻塞/原因、错误、退出码/超时、清理与只读、待回答问题、游标和全文入口均保留；结构化输出保持可解析和校验事实 |
| 性能 | 工具精简不新增模型调用；单项普通查询不扫描无关完整历史/日志；限制页大小，串行/锁/消费协议保持统一 |

普通启动/发送/列表/状态回执争取达到 [返回预算](results.md)；批量创建和用户明确读取的实际结果允许更长。节省比例在基线与实现比较后报告，不预先承诺未经测量的百分比。

## 必要验收场景

将风险合并到既有协议/存储/生命周期测试中，不为每个图标、文案或字段顺序新增测试。优先覆盖：

1. **查询与 schema**：空参默认、组/单项、状态/范围与历史分页；真实注册及 Provider 转换后的参数形状；参数错误提供有效修正，未知 ID、cursor 和只读状态可辨认。
2. **变更与字段完整性**：单操作和批量原子性、多个 doing、手动/依赖阻塞、重复完成；批量新 ID 映射、已启动但关联失败、真实 stop/cleanup 结果不遗漏。
3. **有界读取与结果**：中文/长标题/多字节、长日志的非尾部错误、stderr、生成中的 EOF、截断与续读；长 agent 结果的后半段结论和结构化 payload 可以完整取回，分页不改变 stream/过滤。
4. **问题与一次交付**：前台早退问题、完整选项/回答格式、wait 超时/pending、其他对象提前结算、监视进度和通知；新旧 run 不混淆，结果不会重复注入或因摘要省略而误消费。

schema/协议测试证明契约，不能替代真实模型首次调用正确率验证。实现完成后用有限代表性场景比较模型行为和实际 content；只有新增失败或未解决风险才扩大测试范围，遵守日常 5 分钟、全量 10 分钟上限。

## 文档收尾

局部更新 [公共工具契约](../../../current/runtime/tools.md)、[任务结构](../../../current/tasks/index.md)、[任务操作](../../../current/tasks/operations.md)、[Jobs](../../../current/jobs/index.md)、[Agents 操作](../../../current/agents/operations.md) 和相关模型/历史/工作流页面；修正 schema、工具说明、默认预算与操作入口，保留其他现有细节。

完成后将本目录移入 finished，并同步 Tasks/Goal 专项的交叉链接；current 只写当前已验收事实，不写试验日志或未实施协议。

[返回计划](index.md)

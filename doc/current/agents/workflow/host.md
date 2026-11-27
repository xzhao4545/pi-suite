# 宿主、资源与记录

`WorkflowManager`（`manager.ts`）按 `agentDir` 提供进程级管理器；`WorkflowsModule`（`index.ts`）按当前会话与分支提供列表、等待、[Dock](../operations.md#dock-键盘进入) 和通知。workflow 启动时捕获父会话的 cwd、模型、模型目录、thinking、项目信任、系统提示与 owner/anchor，后台执行只使用这些副本，因为 Pi 1.5 在替换会话后会撤销原 `ExtensionContext`；捕获方式与 agent 相同，见[启动时捕获的内容](../runtime.md#启动时捕获的内容)。

## 运行时归属

workflow 从写入初始快照到完成最终结算都占用 workflow 与 agents 两个运行时 owner，暂停期间也占用。`/reload` 的处理见 [reload 与执行 owner](../../runtime/index.md#reload-与执行-owner)。任一 owner 来自先前加载且仍需保留时，新启动与 journal 重放返回 `RUNTIME_UNAVAILABLE`；暂停、继续、停止和读取不受影响。

## Child 与 gate

### Child

- workflow child 通过公共 `AgentManager` 启动 Pi SDK 会话，记录带 `workflowId`；新 child 只能使用 catalog 中启用的类型。`resume` 续接时沿用原类型、模型、thinking、schema、工具选择与配置，结构化结果仍用原 `CompiledSchema` 校验，并在脚本 realm 内解析为对象。记录字段与启动快照见[执行与记录](../runtime.md)。
- child 由 workflow 自己的并发控制调度，不占普通前台/后台池，也不出现在普通 agents 列表和状态计数中。
- 顶层 workflow child 的 `ask_user` 和 `agent_send` 见[父级回答](../operations.md#父级回答)。普通引导与会话恢复由 workflow 控制。
- 运行中的宿主保留自己 child 的 `Execution` 引用（AgentManager 内存执行表中的项），结束后释放，见[执行引用回收](../runtime.md#执行引用回收)。

### Gate

- gate 通过公共 JobManager 以 pipe 模式执行：使用 Pi shell 解析、workflow cwd、所属会话，creator 为该 workflow。
- 期限默认 10 分钟，启动后关闭 stdin。
- stdout/stderr 保存在 job 日志中，按共享有界读取规则取回。job 以 completed 结束、退出码为 0 且未取消时 gate 通过；否则该调用失败，错误写入 agent 进度行，child 已产生的用量保留。
- gate 不出现在普通 jobs 列表、状态计数与结果通知中，日志从 workflow 详情查看。

### 取消与清理

停止、跳过、重试和退出 Pi 都走同一条 child/job 取消路径。

1. JobManager 按本次传入的 run/workflow ID 匹配 job 的创建者或祖先；同级运行的 job 不受影响。已关闭的创建者只用于拒绝后续启动。详见[停止与 job 清理](../runtime.md#停止与-job-清理)。
2. `host.close` 等待全部 child 停止后再汇总清理错误。清理失败时保留 AgentRecord 身份，供 owner 再次清理；无论成败都释放 `Execution` 引用。
3. 终态通知在 Worker 终止、child 与所属 job 清理、结果写入和快照保存全部完成后发出。清理未确认或写入失败时，运行以 failed 结束并显示错误。

## 保存资源

按名称查找 `<name>.js`，优先级从高到低：

1. 项目 `.pi/workflows`
2. 项目 `.agents/workflows`
3. 用户 `<agentDir>/workflows`
4. 已安装 Pi 包声明的 workflows

- 项目目录与项目包只在项目受信任时读取。`agents.packageWorkflows` 接受布尔值或包名/source 数组；`false` 和空数组关闭包脚本发现。声明格式见[包声明](../resources.md#包声明)。
- 名称最长 128 字符，以字母或数字开头，只含字母、数字、点、短横线和下划线。
- 保存列表只显示带 `export const meta` 声明、不超过 512 KiB 的普通文件。按名称找到的高优先级文件缺少声明或读取失败时报错，不回退到低优先级文件。
- `script`、`scriptPath`、`name` 必须恰好提供一项；`scriptPath` 相对 workflow cwd 解析。嵌套 `workflow()` 使用同一套解析与信任规则，只接受 `name` 或 `scriptPath`。

## 运行文件

每次运行在 `<agentDir>/pi-suite/agents/workflows/<ownerSessionId>/<wfId>/` 下保存：

| 文件 | 内容 |
| --- | --- |
| `script.js` | 脚本副本，Replay journal 使用它 |
| `journal.jsonl` | 已结算 agent 调用，见 [Journal 恢复](index.md#journal-恢复) |
| `run.json` | 运行快照 |
| `result.txt` | 最终结果或错误文本 |

目录权限 0700，文件权限 0600。启动 Worker 前先写脚本副本、空 journal 和初始快照。`WorkflowStore` 使用公共 JsonStore 在锁内重读并原子保存；I/O 失败直接报错，不改用内存存储。

## 父级记录

父会话的 `pi-suite:workflow-record` 条目保存归属、状态、进度、文件路径、通知消费标记与 child 记录引用。child 会话全文、工具结果和结构化正文从公共 SDK 会话读取，不写入该条目。该条目的渲染器随扩展加载注册，agents 模块关闭时也注册：折叠为一行进度，展开显示完整进度；进程中有同 ID 的运行时显示实时进度，否则显示条目数据，用时停在条目时间。

绑定会话时从当前分支恢复记录：

- 父级条目版本不受支持或数据无效，或与 `run.json` 的 ID、会话、cwd 或锚点不一致时，报 `WORKFLOW_HISTORY`。
- 若父级条目已结束，且其结束时间不早于文件快照，则取父级条目；否则取文件快照。任一副本标为已消费时，恢复的运行也标为已消费。
- 恢复出的运行仍为 running 或 paused 时，说明执行它的进程已退出，标记为 failed；journal 保留，可显式重放。

## 等待与通知

- 共享 `wait` 接受 `wf_` ID，`goal_wait.waitFor` 也接受 workflow。
- 结果只在所属主会话的当前分支可见。owner 不在时结束的运行，在该会话再次绑定时进入统一通知。
- 通知包含摘要、结果或错误文本的前 1000 字符，以及用 `read` 打开的结果路径。显示时折叠为 `Workflow result` 一行（状态、ID、名称、child 完成数和用时），展开显示结果文本和路径。
- wait 取得结果后撤销对应通知，并把消费标记写入父级记录。

[返回 Workflow](index.md)

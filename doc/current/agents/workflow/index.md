# Workflow 编排

`agent_workflow` 运行一段 JavaScript 脚本，由脚本启动和组合多个 child agent。代码位于 `src/agents/workflow`，其中 runtime、worker-source、meta、journal、task 与 progress 改编自 @tintinweb/pi-subagents 0.23.0，按文件来源见 [上游登记](../../../../third-party/UPSTREAM.md)。`createWorkflowHost`（`host.ts`，运行核心调用的宿主接口）把脚本接到公共 AgentManager、JobManager、资源发现、记录、通知和等待；工具与 `/subagents` 查看共用进程级 `WorkflowManager`。

- [宿主、资源与记录](host.md) — child 与 gate、保存脚本、运行文件与通知。
- [工具与原生操作](operations.md) — agent_workflow、等待、/subagents workflows、开关与冲突。

## 执行与边界

`runWorkflow` 在独立 Worker 线程中编译并执行脚本。用 Worker 是为了能用 `terminate()` 停止死循环或卡在 await 中的脚本；Worker 内的 vm context 保证协作脚本的确定性，不是安全沙箱。`gate` 作为普通 shell 命令执行。

1. 校验：脚本超过大小限制、含 tab/CR/LF 以外的控制字符、metadata 无效或 `args` 无法按 JSON 传递时，报错且不启动 Worker。
2. 执行：脚本通过 `agent`、`parallel`、`pipeline`、`phase`、`log`、`workflow` 与 `budget` 调度 child，进度按批次交给宿主。
3. 结束：结果状态为 completed、failed 或 killed，附进度日志与调用计数。返回前等待 Worker 线程终止；child 的结算与清理由宿主负责。

### Metadata

脚本以 `export const meta = {name, description, whenToUse?, phases?}` 开头，`phases` 每项为 `{title, detail?, model?}`，`name` 与 `description` 必须是非空字符串。

`meta` 必须是纯字面量：先由 `assertPureLiteral`（`literal.ts`）检查语法，再在空 VM 中以 100 ms 上限求值。函数调用、运算、变量、spread 与模板插值都会报错；字符串、注释、数组、对象和尾逗号使用 JavaScript 语法。校验后的 metadata 同时交给宿主，运行中的名称与阶段直接使用它。

### 值边界与确定性

- `args`、`schema` 和脚本返回值必须是 JSON 值：循环引用、非有限数、BigInt、函数、稀疏数组、symbol（值或键）与非普通对象都会报错。未传 `args` 或脚本未返回值时，顶层值为 `undefined`。
- 这些对象在脚本 realm 内解析，保留该 realm 的 Object/Array 原型。
- 脚本限制动态代码生成。`Date.now()`、`Math.random()` 与无参数 `new Date()` 会抛错，因为它们使 journal 重放结果不一致；时间通过 args 传入。

### 组合与限制

- `parallel` 等待全部条目；`pipeline` 让各条目独立推进各阶段。普通条目抛错时该条目为 null，pipeline 跳过它的后续阶段；运行级上限错误向外传播。
- `phase` 与 agent 的 `phase` 选项提供进度分组；`log` 与 console 输出按批次交给宿主。
- `workflow(nameOrRef, args?)` 只能嵌套一层，在同一 Worker 内运行，共享并发额度、agent 计数、journal 与 budget；子 workflow 的阶段标题带 `▸ <name>` 前缀，单独成组。

| 限制 | 默认值 |
| --- | --- |
| 脚本大小 | UTF-8 512 KiB |
| 单次运行 agent 数 | 1000 |
| 每次 parallel/pipeline 条目 | 4096 |
| 嵌套 `workflow()` 调用 | 256 |
| 并发 | `max(1, min(16, CPU 数 - 2))` |

超过 agent、条目或嵌套上限时运行失败。脚本结束时仍有未 await 的 agent 调用，运行失败并停止这些 child。

## Agent 调用

`agent(prompt, opts?)` 的选项为 label、phase、model、agentType、gate、resume、effort、schema。其他选项报错并列出支持项；`isolation` 报错说明不支持 git worktree 隔离。`effort` 取值为 minimal、low、medium、high、xhigh、max。

- `schema`：使用公共 JSON Schema 编译器。宿主给 child 注入 StructuredOutput 工具，运行核心再次校验结果。
- 失败：模型或 gate 失败时调用返回 null，错误显示在该 agent 的进度行中，由脚本决定后续流程。
- `gate`：child 成功且结构化结果校验通过后，宿主在 workflow cwd 执行 shell 命令，每次尝试最多执行一次。gate 失败或抛错时，已产生的 child 用量仍计入，child 也仍可按 label 续接。执行方式见 [Child 与 gate](host.md#child-与-gate)。
- `resume`：传入本次运行中已完成 child 的 label，宿主在原会话中续接，沿用原模型与工具契约；不能同时传 agentType、model、effort、schema 或 gate。原 child 的 `CompiledSchema`（编译后的结构化结果 schema）随续接保留，Worker 按结构化标记在脚本 realm 内解析返回值。

## 控制与预算

| 控制 | 行为 |
| --- | --- |
| pause | 不再启动新 child，已在运行的继续结算 |
| resume | 解除暂停 |
| skip | 未结算的调用返回 null |
| retry | 只作用于运行中的调用：停止当前尝试并重跑，脚本继续等待原 Promise |

等待并发槽位的调用拿到槽位时再检查暂停与跳过，暂停期间不会漏启动。入口见 [/subagents workflows](operations.md#subagents-workflows)。

`budget.spent()` 累计本次运行全部尝试的输出 token，包括用户重试的尝试；进度行累计该调用各次尝试的 token 与工具调用数。`budget.total` 为 null，`budget.remaining()` 为 Infinity。

进度是追加日志，同一 agent index 以最后写入项为准；后台 task 的计数在每批进度后从折叠结果重新计算，不重复累加。

## Journal 恢复

journal 为 JSONL。每个 agent 调用按到达顺序取得 index，结算时追加一行 `{index, key, ok, text?, resumed?}`。key 是 prompt、label、model、agentType、effort、gate、resume 与 schema 的 SHA-256 前 32 位十六进制；阶段分组不影响 key。

1. 按 index 顺序复用位置与 key 都一致且成功的前缀。
2. 第一个缺失、key 变化、失败或结构化结果复核失败的调用，以及其后的全部调用，实际执行。
3. 复用项写入本次 journal，使该文件自身完整。
4. journal 含 `agent({resume})` 调用时不复用任何条目：复用项只是文本，没有可续接的 child 会话。

读取按 index 排序。I/O 错误、中间行损坏、非法条目和重复 index 都报错；只有最后一行未写完且文件没有末尾换行时可以舍弃，并返回 truncated 标记，由宿主写入运行日志。追加失败使运行失败，不切换为内存恢复。恢复入口与目标限制见 [恢复运行](operations.md#恢复运行)。

[返回 agents](../index.md)

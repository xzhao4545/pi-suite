# Workflow 编排

编排核心位于 `src/agents/workflow`，由 @tintinweb/pi-subagents 0.23.0 的 runtime、worker-source、meta、journal、task 与 progress 源码导入适配。核心通过 WorkflowHost 接入公共 AgentManager、JobManager、资源发现、记录、通知和等待；agent_workflow 与原生查看使用同一运行 owner。按文件来源见 [上游登记](../../../../third-party/UPSTREAM.md)。

- [宿主、资源与记录](host.md) — child/gate 生命周期、保存脚本、快照与会话归属。
- [工具与原生操作](operations.md) — agent_workflow、共享等待、/agents workflows 与控制。

## 执行与边界

`runWorkflow` 在独立 Worker 中编译执行 JavaScript。输入不可执行时在启动前拒绝；启动后的结果带 completed、failed 或 killed 状态、进度日志与调用计数。返回前等待 Worker 线程终止。宿主负责 child 的实际结算与清理。

脚本 metadata 为 `export const meta = {name, description, whenToUse?, phases?}`。片段经过纯字面量语法检查，再在空 VM 中以 100 ms 上限解析；函数调用、运算、变量、spread、模板插值不属于字面量。字符串、注释、数组、对象和尾逗号使用 JavaScript 语法。运行时校验后向宿主提供同一份 metadata，运行中的名称与阶段直接使用该结果。

args、schema 和脚本返回值使用 JSON 边界：拒绝循环、非有限数、BigInt、函数、稀疏数组、symbol 与非普通对象；顶层未提供的 args 和无返回值使用 undefined。对象在脚本 realm 内解析，保留该 realm 的 Object/Array 原型。脚本限制动态代码生成；Date.now、Math.random 和无参数 Date 构造明确拒绝，时间信息通过 args 传入。

`parallel` 等待全部条目，`pipeline` 让各条目独立推进阶段；普通条目异常成为 null，运行级上限错误向外传播。`phase` 与显式 agent phase 提供进度分组，`log` 与 console 输出按批次交给宿主。单层嵌套 workflow 使用同一个 Worker、并发额度、调用计数、journal 与 budget，阶段标题按子 workflow 分组。

默认限制：脚本 UTF-8 512 KiB、单次运行 agent 1000、每次 parallel/pipeline 条目 4096、嵌套调用 256；并发为 `max(1, min(16, CPU-2))`。未等待的 agent launch 会使运行失败并停止对应 child。

## Agent、控制与预算

agent 调用支持 label、phase、model、agentType、gate、resume、effort 与 schema；未知选项和 isolation 明确拒绝。结构化结果使用公共 JSON Schema 编译器，宿主给 child 注入 StructuredOutput，运行核心再次检查结果。模型与 gate 失败返回 null，错误保留在 agent 进度行中，由脚本决定后续流程。

gate 由宿主在 workflow cwd 执行，核心只调用一次。gate 执行失败或抛错都保留已经产生的 child 用量。resume 使用本次运行已完成 child 的 label，要求宿主继续其原会话与模型、工具契约；不得同时提供 agentType、model、effort、schema 或 gate。原 child 的 CompiledSchema 随续接保留，Worker 根据有效的结构化标记在脚本 realm 内解析返回值。

pause 停止新启动，已有 child 继续结算；resume 释放暂停等待。skip 让未结算调用成为 null；retry 只作用于正在执行的调用，停止该次尝试并重跑，脚本继续等待原来的 Promise。并发等待中的调用重新取得槽位时检查暂停和跳过，避免暂停泄漏启动。

`budget.spent()` 累计本次运行全部尝试的输出 token，包含用户重试的尝试；进度行累计各尝试 token 与工具调用。`budget.total` 为 null，`budget.remaining()` 为 Infinity。进度为追加日志，同一 agent index 采用最后写入项；后台 task 的计数按批次从折叠结果计算，避免重复加总。

## Journal 恢复

journal 为 JSONL，agent 调用按到达顺序取得 index，结算时追加。key 覆盖 prompt、label、model、agentType、effort、gate、resume 与 schema，阶段分组不影响调用身份。

恢复只复用位置与 key 一致且成功的前缀；首次缺失、变化、失败或结构化结果复核失败后，后续调用全部执行。复用项写入本次 journal，使该文件独立完整。含 `agent({resume})` 的 journal 整体执行，因为复用文本不产生可继续的 child 会话。

读取按 index 排序；I/O 错误、中间损坏、非法条目和重复 index 明确报错。仅最后一次未完成且无末尾换行的 JSON 追加可以舍弃，并返回 truncated 标记供宿主报告。追加失败使运行失败，禁止无声切换为内存恢复。

[返回 agents](../index.md)

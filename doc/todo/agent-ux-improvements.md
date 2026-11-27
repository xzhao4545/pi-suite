# Agent UX 改进

## 目标

1. `/subagents` 的 Runs 页能恢复已结束的 agent。
2. 同一 agent 的多个 run 在 Runs 页和 Dock 只占一行。
3. run 因网络或上游错误失败时，自动恢复同一个 agent 继续，不新开 agent。
4. wait 的工具行右侧显示已等待时长。

## 现状

- 恢复：`manager.send()` 对已结束的 agent 调用 `start(..., record)`，沿用 agent ID 和会话文件，分配新 run ID。`agent_send` 和 `@handle` 已经这样恢复。Runs 页和 Transcript 的 `m Message` 由 `agentControls().canMessage` 控制，它要求 run 仍在活动，所以已结束的 run 没有入口。
- 显示：Runs 页每行是一个 run（`value: record.runId`）；Dock Agents 行的 id 是 `agent:<runId>`，失败且未消费的 run 也占一行。恢复后旧 run 和新 run 各占一行。
- 重试：child 会话使用 Pi 的 `retry` 设置（`SettingsManager.getRetrySettings()`：`enabled`、`maxRetries`、`baseDelayMs`、`maxAgentDelayMs`）。Pi 只重试匹配其可重试错误表的报错；`The upstream response was interrupted before completion` 和 `Request timed out` 不在表内，run 直接以 failed 结束。`runner.ts` 在最后一条 assistant 消息 `stopReason === 'error'` 时把 `errorMessage` 作为失败原因抛出。
- wait：执行期间只显示调用行 `Wait · N objects`，`ToolLine` 没有靠右的字段。Pi 的 `ToolRenderContext` 提供 `invalidate()`、`executionStarted` 和结束后的 `durationMs`。

## 方案

### 1. Runs 页恢复

- `canMessage` 增加一种情况：该 run 是 agent 的最新 run（`manager.get(id).record.runId === runId`），已结算（不在 stopping 或结束清理中），非只读，且 `manager.visible(record, scope)` 为真。提交后调用 `manager.send()`，返回 `resumed`。
- 输入提示：活动 run 为 `Message <name>: `，已结束的 run 为 `Resume <name>: `，有待答问题时仍为 `Answer parent question: `。
- Transcript 页的 `m` 使用同一判断。

### 2. 一个 agent 一行

- Runs 页按 agent ID 分组，每组一行，代表该 agent 的最新 run：状态、时长、操作和 Transcript 都取最新 run。最新 run 的会话分支包含之前各 run 的对话，所以 Transcript 显示全部历史。
- 有多个 run 时，行尾追加 ` · <N> runs`（muted）。搜索文本包含所有 run 的 runId。
- 状态筛选按最新 run 判断。
- 新增操作 `r Runs`，只在有多个 run 时可用，打开该 agent 的 run 列表。列表每行一个 run，保留现有的单 run 操作（Details、Jobs、Cleanup jobs 等）。
- 浏览状态的 `selected` 由 runId 改为 agent ID，恢复产生新 run 后光标仍停在同一行。
- Dock Agents 分区：同一 agent 只显示最新 run，旧 run 不再单独占行。

### 3. 网络或上游错误自动恢复

- 判断条件：
  - run 因模型请求错误失败。由 runner 抛出可区分的错误，不靠匹配合并后的错误文本；
  - 未被停止；
  - 错误文本匹配重试模式，且不匹配排除模式。两个模式只在 `src/agents/` 内定义一处：
    - 重试：`upstream`、`interrupted`、`timed out`、`timeout`、`network`、`connection`、`socket hang up`、`ECONNRESET`、`fetch failed`、`overloaded`、`429`、`5xx`；
    - 排除：`quota`、`billing`、`balance`、`usage limit`、`insufficient`、`unauthorized`、`401`、`403`。
- 动作：失败结算后立即用原 record 恢复同一 agent，父级不变，与 `agent_send` 的恢复相同。新 run 先处于 queued，经过 `min(baseDelayMs·2^(n-1), maxAgentDelayMs)` 后才可启动。延迟期间最新 run 处于活动状态，`wait` 不会把这个 agent 判为结算。
- 次数：同一 agent 连续自动恢复最多 `maxRetries` 次；`retry.enabled` 为 false 时不自动恢复。run 完成、用户发消息或停止后计数清零。次数用尽后按普通失败结算。
- 通知：被自动恢复接续的失败 run 标记为已消费，不发失败通知，不唤醒父级。父级只收到最终结果。
- 显示：等待自动恢复的 run 在 Runs 页和 Dock 的状态后追加 ` · retry <n>/<max>`。
- 恢复消息（模型可见）：`The previous request failed with a network or upstream error: <error>. Continue the same task from where you stopped. Do not repeat completed steps.`
- 次数用尽时，`record.error` 末尾追加 ` · gave up after <n> automatic resumes`。
- 实现前核对：`launch()` 结算后如何取得父级 scope 和 config（调度触发的启动没有调用方，可参照）。workflow child 不在本项范围。

### 4. wait 显示时长

- `ToolLine` 增加靠右字段 `aside`。宽度不足时截断左侧内容，保留 `aside`。
- `toolRenderers` 增加计时选项：执行开始后在 `ctx.state` 记录开始时间，每秒调用 `ctx.invalidate()`；结果到达后停止计时器，改用 `ctx.durationMs`。计时器调用 `unref()`。
- wait 开启计时：调用行和结果行右侧显示 `elapsedText()` 的结果（如 `15s`、`2m05s`、`1h03m`），tone 为 dim。
- 模型看到的 wait 结果文本不变。

## 约束

- 不改 Pi；不新增配置项；不提交。
- 代码由 subagent 写。文档和所有用户或模型可见的文本由父会话写，代码中只用本文给出的字符串。
- 测试遵守 AGENTS.md 的编码要求，只覆盖以下契约：
  - 一个 agent 一行，操作作用于最新 run；
  - 已结束的 run 可从 Runs 页恢复同一 agent ID；
  - 自动恢复的延迟期间 wait 不结算，次数用尽后正常失败；
  - `aside` 在窄宽度下保留。

## 相关文档

- `doc/current/agents/operations.md`（Runs 页、Dock）、`doc/current/agents/runtime.md`（恢复、结算、通知）
- `doc/current/runtime/index.md`（wait）、`doc/current/ui/index.md`（工具行）
- `docs/*/modules/agents/index.md`、`docs/*/interface.md`、`docs/*/tools.md`

## 任务

- [ ] 1 Runs 页恢复
- [ ] 2 一个 agent 一行（Runs 页与 Dock）
- [ ] 3 网络或上游错误自动恢复
- [ ] 4 wait 显示时长
- [ ] 同步 doc/current 与 docs

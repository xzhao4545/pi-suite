# Workflow

[Agents](index.md) · [文档索引](../../index.md)

workflow 是编排多个子代理的 JavaScript 脚本：对工作清单并行展开、按阶段流水处理、核实结果，并返回汇总答案。开关：`agents.workflows`（默认 `true`）。

只有当你要求多代理编排、某个技能要求这样做，或你指定了某个已保存的 workflow 时，模型才应启动 workflow。完整的编写指南是 [`pi-suite-workflow` 技能](../../../../skills/pi-suite-workflow/SKILL.md)，模型在编写脚本前会先阅读它。

## `agent_workflow`

| 参数 | 含义 |
| --- | --- |
| `script` | 内联脚本源码。 |
| `scriptPath` | 脚本文件路径，相对于工作目录。 |
| `name` | 已保存的 workflow（见下文）。 |
| `args` | 任意 JSON 值，作为 `args` 传给脚本。 |
| `resumeFromRunId` | 本会话中、当前分支可见的已结束 `wf_` 运行。复用其中未改变且成功的 `agent()` 调用。 |

`script`、`scriptPath`、`name` 必须且只能提供一个。该工具总是在后台启动，并返回 `wf_` ID 和 `resultPath`。用 `wait` 等待该 `wf_` ID，或等待通知，然后读取 `resultPath` 获取完整输出。

## 脚本结构

```js
export const meta = {
  name: 'review-diff',
  description: 'Review a diff from several angles and verify each finding',
  phases: [{ title: 'Find' }, { title: 'Verify' }],
}

const angles = ['correctness', 'security', 'tests']
const findings = await pipeline(angles,
  angle => agent(`Review the current diff for ${angle} issues`, { phase: 'Find', label: angle }),
  (report, angle) => agent(`Check whether these ${angle} findings are real:\n${report}`, { phase: 'Verify' }),
)
return findings.filter(Boolean).join('\n\n')
```

- `meta` 必须是纯字面量，包含 `name` 和 `description`；`whenToUse` 和 `phases` 可选。
- `agent(prompt, opts?)` 启动一个子代理，返回其最终文本；提供 `opts.schema` 时返回经过校验的对象。子代理失败或被跳过时返回 `null`。选项：`label`、`phase`、`schema`、`model`、`effort`、`agentType`、`gate`（子代理结束后必须通过的 shell 命令，默认超时 10 分钟）、`resume`（继续该 label 对应的子代理）。
- `pipeline(items, ...stages)` 让每一项独立地经过各阶段；`parallel(thunks)` 等待全部 thunk 完成。
- 另有 `phase(title)`、`log(message)`、`args`、`budget.spent()`，以及用于一层嵌套的 `workflow(nameOrRef, args?)`。
- 脚本是运行在独立 Worker 中的普通 JavaScript，不能访问文件系统或 Node.js API。Worker 用于保证确定性并拦截误用，不是安全沙箱，而且 `gate` 会执行 shell 命令，只运行你信任的脚本。`Date.now()`、`Math.random()` 和无参数的 `new Date()` 会抛错，因为它们会破坏恢复；时间请通过 `args` 传入。

限制：脚本 512 KiB，每次运行 1000 个 agent，每次 `parallel`/`pipeline` 4096 项，嵌套调用 256 次。并发数为 `max(1, min(16, CPU 数 − 2))`。workflow 子代理不占普通子代理池。

## 已保存的 workflow

带 `export const meta` 的 `.js` 文件可以按 `name` 运行。查找顺序：

1. `<project>/.pi/workflows/`
2. `<project>/.agents/workflows/`
3. `<agentDir>/workflows/`
4. 已安装 Pi 包声明的 workflow（`agents.packageWorkflows`）。

项目目录要求项目受信任。名称使用字母、数字、`.`、`-` 和 `_`，以字母或数字开头，最长 128 个字符。

每次运行保存在 `<agentDir>/pi-suite/agents/workflows/<sessionId>/<wfId>/`，包含 `script.js`、`journal.jsonl`、`run.json` 和 `result.txt`。

## 恢复与重放

journal 记录每一次 `agent()` 调用。恢复时复用开头那些提示与选项都未改变且成功的调用；从第一次变化或失败开始，之后的调用全部重新执行。包含 `agent({resume})` 调用的 journal 会完整重新执行。

## Workflows 页面

`/subagents workflows` 列出当前会话的 workflow 运行和已保存的 workflow，`s` 在两者之间切换。

| 按键 | 操作 |
| --- | --- |
| Enter | 打开运行详情，或已保存 workflow 的源码。 |
| `p` | 暂停或恢复新 agent 的启动。已在运行的 agent 继续。 |
| 按两次 `x` | 停止 workflow、其子代理及它们的 job。 |
| `r` | 用相同脚本和 args 重放已结束的运行，复用未改变的前缀。 |
| `n` | 用 JSON args 启动已保存的 workflow。 |

运行详情列出阶段、agent、模型、尝试、用量、日志和结果。在 **Children / gates** 中可以打开子代理对话记录，读取 gate 的 stdout 和 stderr，**Skip** 某个调用（脚本收到 `null`），或 **Retry** 正在运行的调用。

workflow 子代理的 `ask_user` 问题会交给主会话，可以用 `agent_send` 回答。引导和恢复 workflow 子代理由 workflow 自己负责。

## 冲突

如果其他扩展已经提供 workflow 工具（`agent_workflow`、`SubagentWorkflow`、`Workflow` 或 `workflow`），本套件在该会话中关闭自己的 workflow 并报告冲突。对方工具名不同时，显式设置 `"agents": { "workflows": true }` 可以两者并存；对方同样叫 `agent_workflow` 时，Pi 保留先注册的那个，需要禁用其中一个扩展。

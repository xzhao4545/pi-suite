# 工具调用显示精简

状态：方案已确认，未实施。tasks 工具的具体摘要规则见 [Tasks 编号、状态样式与紧凑反馈](tasks-display.md) 第 4 节，实施时改为使用本方案的公共框架；ask 界面与结果语义已完成，见 [Ask 交互](../../finished/pi-suite/ask/interaction.md)。

## 原始需求

- [ ] 1. ask_user 调用后的显示精简，不铺开全部 JSON。
- [ ] 2. jobs（job_*）、子代理（agent_*）等其他工具按需完善调用显示：默认简短，展开后查看明细。

## 当前原因

Suite 注册的 20 个工具（job_* 6 个、agent_* 6 个、agent_workflow、ask_user 主会话与子代理各 1 个、goal_* 3 个、wait）中，只有 agent_workflow 自带 renderCall/renderResult；另外只有 task_list、task_edit 有 renderer。其余工具使用 Pi 1.5.0 的默认显示（`dist/modes/interactive/components/tool-execution.js`）：

| 默认行为 | 位置 | 后果 |
| --- | --- | --- |
| 调用行 `formatToolCallWithArgs`：工具名 + `key=JSON`，折叠时截到 100 字符；展开时每个参数一行，字符串原样输出 | 99–101，`core/tools/render-utils.js` 70–97 | agent_start 的完整 prompt、job_start 的完整命令、goal_complete 的完整 summary 都会在展开时铺开；job_write 的 `sensitive:true` 输入也原样显示 |
| 结果折叠时显示前 10 个 `\n` 行，展开显示全部 | 6、102–115 | ask_user 的结果是一行 `JSON.stringify(record)`，10 行限制不生效，整段 JSON 自动换行占满多屏；job_read/agent_read 默认 4096 字节的正文前 10 行直接铺开；wait 的子代理结果摘要每项最多约 2 KB |
| 结果与调用分两块显示 | — | goal_complete 的 summary 在调用和结果中各出现一次 |
| ask 询问界面的历史视图 | `src/ask/index.ts` 42 行 `new Transcript(tui, ctx.cwd)` 未传 renderer 查找 | 询问期间查看历史时，所有扩展工具走无定义路径（`formatToolExecution`，320–331）：工具名、完整格式化 JSON 参数与完整输出，不受折叠控制 |

展开方式由宿主提供：点击单个工具结果只切换该项（`createResultRegion` 的 MouseRegion，`renderShell: 'self'` 同样生效）；`app.tools.expand`（默认 ctrl+o）切换全部工具。renderer 只按 `options.expanded` 输出内容。

## OMP 参考结论

阅读 [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) 提交 `f2b795ba747b23d42052184d822b41e3d01357cc` 的 `packages/tui/src/tools/` 与 `packages/tui/src/render/`：

| 位置 | 设计 | 本方案处置 |
| --- | --- | --- |
| `render/status-line.ts` `renderStatusLine` | 统一单行头部 `icon title: description [badge] meta·meta`，字段中的换行压成空格 | 采用：所有工具共用一个状态行函数 |
| `tools/renderer.ts`、`chat/tool-execution.ts` 1998 | `mergeCallAndResult: true`：有结果后不再绘制调用块 | Pi 1.5.0 无此选项；沿用 tasks 已有做法：`renderShell: 'self'`，renderResult 设置 `ctx.state.finished` 后调用块返回空行 |
| `render/render-utils.ts` `PREVIEW_LIMITS` | 折叠预览 3 行、展开 12 行、列表折叠 8 项；`formatExpandHint` 追加 `[Ctrl+O: Expand]` | 折叠默认一行，不加展开提示（与 tasks 方案一致）；正文类结果展开时显示全文 |
| `tools/wait.ts` | 调用 `⏳ Wait`；有结果后每个已结算对象一行 `✔ bg-3 done · 42s  npm test`，失败项多一行原因，最多 8 行 | 折叠只保留一行计数，逐项摘要放到展开 |
| `tools/task.ts` | 子代理调用显示类型与分配列表（最多 4 个）；完成后每个子代理一行 `✔ Anna: … [done] · 14 req · … · 1m02s` 加 3 行输出预览，底部 `[3 succeeded · 1 failed · …]` | 折叠只显示一行状态与名称；结果正文和用量放到展开 |
| `tools/proc-render.ts` | job 查看/停止为 `Proc <id>` 头部 + 3 行预览；停止结果带 `[cancelled]` 等徽标 | 停止结果折叠为一行状态与清理结论 |
| `tools/bash.ts` | 后台启动在卡片底部显示 `Backgrounded: <jobId>`，给模型的后台说明文字不显示给用户 | job_start 折叠只显示 ID、名称与状态，不显示给模型的续读提示 |
| `tools/ask.ts` `renderResult` | 忽略 `expanded`，始终显示完整问题与全部选项 | 不采用：折叠为一行答案，展开才显示选项 |

## 方案

### 1. 公共显示框架 `src/ui/tool-render.ts`

新增一个文件，所有 Suite 工具的 renderer 都从这里构造，不在各模块各写一套。

```ts
type Tone = 'accent' | 'success' | 'warning' | 'error' | 'dim';
interface ToolLine { icon: string; tone?: Tone; title: string; summary?: string; meta?: string[] }
interface ToolView<A, D> {
  call(args: A): ToolLine;                       // 调用进行中的一行
  collapsed(details: D, args: A): ToolLine;       // 结果折叠：一行
  expanded?(details: D, args: A, text: string): string[]; // 结果展开：省略时显示工具正文全文
}
export function toolRenderers<A, D>(view: ToolView<A, D>): Pick<ToolDefinition, 'renderCall' | 'renderResult' | 'renderShell'>;
```

- `toolLine(theme, line)`：输出 `<icon> <title> · <summary> · meta·meta`，图标与标题按 tone 着色，summary 默认色，meta dim；所有字段先经 `sanitizeText` 并把换行压成空格，整行按宽度截断。
- `renderShell: 'self'`；调用块在 `ctx.state.finished` 为 true 后返回空数组，完成后只剩结果行（沿用 `src/tasks/tools.ts` 的现有做法，并补上当前缺少的 `outputPad` 处理）。
- 错误结果（`ctx.isError`）：第一行 `✘ <title>` error 色，下面始终显示完整错误正文，不受折叠影响。
- `isPartial` 的进度更新同样走 `collapsed`，所以运行中与完成后只有一行。
- `expanded` 省略时显示工具返回给模型的正文全文，保证展开后能看到模型拿到的全部信息。
- 统一状态图标（均已核对 pi-tui `visibleWidth` 为 1 列）：

| 含义 | 图标 | tone | 对应状态 |
| --- | --- | --- | --- |
| 进行中 | `⟳` | accent | job starting/running/stopping；agent starting/running/stopping |
| 排队 | `⧗` | dim | agent queued |
| 等待用户或父级 | `?` | warning | agent waiting；ask 进行中 |
| 完成 | `✔` | success | completed、answered |
| 失败 | `✘` | error | failed |
| 停止/跳过/取消 | `⊘` | warning | stopped、skipped、cancelled |
| 超时/受限 | `⏱` | warning | timed_out、limited |

- tasks 的任务状态图标（`☐ ⟳ ⚠ ☑`）表示待办语义，仍由 `src/tasks/presentation.ts` 提供；tasks 工具的行通过 `toolLine` 输出，保持同一行结构。

#### renderer 查找

- `src/runtime/tools.ts` 新增模块内的 renderer 表：Suite 所有工具注册统一经过一个入口（现有 `registerBoundTool` 扩展为同时记录 `name → renderers`；jobs、agents、ask、goal、tasks、wait 中直接调用 `pi.registerTool` 的注册全部改为经过该入口）。
- `src/ask/index.ts` 创建 `Transcript` 时传入该表的查找函数，询问期间的历史视图与主界面显示一致。子代理查看器继续使用 `run.renderers`（`src/agents/runner.ts` 40–43），子会话注册的 Suite 工具同样带上这些 renderer。

### 2. 各工具显示

以下“调用中”是结果到达前的一行；“折叠”是结果一行；“展开”是点击或 `app.tools.expand` 后显示的内容。

#### ask_user（主会话与子代理向父级提问）

| 阶段 | 显示 |
| --- | --- |
| 调用中 | `? Ask · <第一题题干 60 列>`；多题为 `? Ask · 3 questions` |
| 折叠 answered | 单题：`✔ Ask · <题干 40 列> → <答案>`，答案为选中标题（多选以 `, ` 连接）或输入文字首行；多题：`✔ Ask · 3 answered` |
| 折叠 timed_out | 与 answered 同格式，图标为 `⏱`，meta `auto-selected`；有 unanswered 题时 meta 追加 `1 unanswered` |
| 折叠 skipped / cancelled | `⊘ Ask · skipped`、`⊘ Ask · cancelled` |
| 展开 | 每题：题干、context，选项用 [Ask 交互](../../finished/pi-suite/ask/interaction.md) 第 3 节的标记显示（已选 success），自由输入文字与评论 |

- 子代理的 ask_user（`src/agents/child.ts`）标题为 `Ask parent`，其余相同。
- 模型可见的 JSON 正文不变。

#### jobs

| 工具 | 调用中 | 折叠 | 展开 |
| --- | --- | --- | --- |
| job_start | `⟳ Job · <name 或命令首行 60 列>`，meta `pipe`/`pty` | `<状态图标> job_xxx · <name> · <mode>`，带 timeout 时 meta `timeout 30s`；attach 返回时 meta `screen returned` 或 `left terminal` | 完整命令、cwd、timeout、任务 ID；attach 交还时的屏幕内容 |
| job_list | `Jobs` | `Jobs · 3 active (session)`，有下一页时 meta `more` | 每个 job 一行 `<图标> job_xxx · name · 12.4s`，历史错误 |
| job_get | `Job · job_xxx` | `<图标> job_xxx · <name> · <state>`，有错误时 meta `error` | 全文 |
| job_read | `Job read · job_xxx · <stream>` | `Job read · job_xxx · <stream> 0–4096 / 12000 B`，搜索时 meta `5 matches` | 本页正文与续读提示（全文） |
| job_write | `Job input · job_xxx` | `Job input · job_xxx · sent 12 B`，关闭 stdin 时 meta `stdin closed` | `sensitive:true` 时输入内容显示为 `[sensitive]`，否则显示 input/keys/paste |
| job_stop | `Job stop · job_xxx` | `⊘ job_xxx · stopped · cleanup confirmed`；已结束为 `job_xxx · already settled` | 全文 |

job_write 的调用行不再显示输入内容，修复默认显示泄露 sensitive 输入的问题。

#### agents

| 工具 | 调用中 | 折叠 | 展开 |
| --- | --- | --- | --- |
| agent_start | `⟳ Agent · <type> · <name 或 prompt 首行 60 列>`；带 schedule 时为 `⏲ Agent schedule · <schedule>` | 后台：`<图标> agent_xxx · <name> · running`；前台完成：`✔ agent_xxx · <name> · 12.3s`；前台转后台：meta `continuing in background`；调度：`⏲ schedule_xxx · <type> · next 10:30` | 完整 prompt、模型与 thinking、结果摘要（现有 2 KB 截断）与用量 |
| agent_list | `Agents` | `Agents · 2 active (session)`，有下一页时 meta `more` | 每个 agent 一行 |
| agent_get | `Agent · agent_xxx` | `<图标> agent_xxx · <name> · <state>`；有待答问题时为 `? agent_xxx · question pending` | 全文（含问题、选项与 agent_send 提示） |
| agent_read | `Agent read · agent_xxx · <stream>` | `Agent read · agent_xxx · <stream> 0–4096 / 9000 B` | 本页正文全文 |
| agent_send | `Agent send · agent_xxx` | `agent_xxx · <action>`，action 取 `AgentManager.send` 返回值 | 发送的消息与结果全文 |
| agent_stop | `Agent stop · agent_xxx` | `⊘ agent_xxx · stopped · cleanup <state>`，级联对象数量放 meta `+3 affected` | 每个受影响对象一行 |
| agent_workflow | 保持现有 `Workflow · <name>` | 现有 `WorkflowProgress` 折叠为 3 行（标题统计、副标题、用量），改为第一行使用 `toolLine`，其余两行并入 meta，成为一行 | 保持现有展开内容 |

#### wait 与 goal

| 工具 | 调用中 | 折叠 | 展开 |
| --- | --- | --- | --- |
| wait | `⟳ Wait · 3 objects` | `Wait · 2/3 settled`；有失败时图标 `✘` 并 meta `1 failed`；提前返回时 meta `returned early: <reason>` | 每个对象的摘要全文、others 与 pending |
| goal_complete | `Goal complete` | `✔ Goal complete · <summary 60 列>` | summary 全文 |
| goal_blocked | `Goal blocked` | `⚠ Goal blocked · <reason 60 列>` | reason、evidence、repeatedTurns |
| goal_wait | `Goal wait` | `⧗ Goal waiting · <reason 60 列>`；无需等待时 `Goal not waiting · all settled` | waitFor、resumeAfterMs、已结算对象 |

调用块在有结果后隐藏，goal 的 summary 不再重复出现。

#### tasks

task_list、task_get、task_edit 按 [tasks-display.md](tasks-display.md) 第 4 节的一行摘要规则，改用 `toolRenderers` 构造。

### 3. 不改变的部分

- 工具返回给模型的 content 与 details 不变（tasks 的 `#` 去除除外，见 tasks 方案）。
- 历史会话中的工具结果使用同一 renderer 重新绘制，不改写会话记录。
- 其他扩展的工具仍由宿主默认显示。

## 影响范围

- 新增 `src/ui/tool-render.ts`（`src/ui` 现有 9 个文件，新增后 10 个）。
- `src/runtime/tools.ts`：注册入口与 renderer 表。
- `src/jobs/tools.ts`、`src/agents/tools.ts`、`src/agents/child.ts`、`src/agents/workflow/tools.ts`、`src/agents/workflow/ui/progress.ts`、`src/runtime/wait.ts`、`src/goal/tools.ts`、`src/ask/index.ts`、`src/tasks/tools.ts`：接入 renderer 与统一注册入口。各模块的 `ToolView` 定义较多时放到模块内 `render.ts`（如 `src/jobs/render.ts`、`src/agents/render.ts`），不撑大 tools.ts。

## 测试调整

- 显示文案不新增永久测试。
- 新增 1 项公共框架测试：调用块在结果到达后隐藏、错误结果显示完整正文、折叠为一行且不超过宽度、`expanded` 省略时显示正文全文。这些是所有工具共用的契约，回归会同时影响 20 个工具。
- 现有测试中断言默认 fallback 文本的用例（若有）按新显示更新。

## 验收

- [ ] 实际 Pi CLI PTY 40/60/120 列逐个调用上述工具：折叠均为一行；点击单个结果展开该项；ctrl+o 切换全部；错误显示完整正文。
- [ ] job_write 使用 `sensitive:true` 时调用与展开均不显示输入内容。
- [ ] ask_user 询问期间打开历史，Suite 工具与主界面显示一致。
- [ ] 子代理查看器中的 Suite 工具使用相同显示。
- [ ] 完成后在 `doc/current/runtime/tools.md` 记录公共显示框架与状态图标，在 ask、jobs、agents、goal、tasks 的 current 文档中更新工具显示说明，并在 `doc/current/ui/index.md` 登记 `tool-render.ts`。

[返回 Pi Suite 待办](index.md)

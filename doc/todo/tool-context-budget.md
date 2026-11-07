# 模型工具上下文精简

## 目标

减少 Suite 工具在每次 Provider 请求中的常驻上下文和单次结果体积，让模型正文只包含决策所需信息；结构化字段继续保存在 details，供本地渲染、历史重绘与控制使用。

## 当前状态

- jobs、agents、tasks、wait、goal、workflow 的结果已通过 runtime/tools.ts 的 textResult 返回文本行，符合 [模型工具契约](../current/runtime/tools.md) 的 1–3 行、约 512 B 回执目标。
- ask_user（src/ask/index.ts 与 child 版本 src/agents/child.ts）把 askDetails 记录整体 JSON.stringify 后作为 content，回传模型自己刚提交的 options（含 description/recommended）、context，批量还包含完整 questions（含 defaultOptionId(s)、allowMultiple），以及可由 status 推出的 cancelled。
- agent_workflow 的工具描述约 19.5 KB（约 5k token），并拼接全部已启用 agent type 说明；描述本身要求仅在用户明确选择多 agent 编排时调用，但在 agents.workflows 启用时始终位于每次请求的工具列表中。
- job_start、agent_start、task_edit 等描述各约 0.5–1 KB，tasks 提醒每 2–4 轮最多注入 10 行，当前体积可接受。

## 方案

### ask_user 文本结果

content 改为文本，details 保持 askDetails 原结构（tool-render.ts 的折叠/展开显示依赖 details，不受影响）。

单题只返回状态与回答，不重复题目和选项：

```
answered: 方案B (option-2)
answered: A, C (option-1, option-3) + custom: 另外加个日志
answered (custom): 用 SQLite
timed_out (auto-selected, not consent): 方案A (option-1)
skipped: unanswered
cancelled
```

批量首行为状态与作答计数，逐题保留截断后的题目（约 60 字）用于对应，未答题标记 unanswered：

```
skipped · 2/3 answered
1. 数据库选型 → PostgreSQL (option-1)
2. 是否加缓存 → custom: 先不加
3. 部署方式 → unanswered
```

comment 作为对应答案下的 `comment: …` 行；child 版本追加 `source: parent`。主会话与 child 共用一个格式化函数，不各写一份。

### agent_workflow 描述按需加载

推荐方案（待用户确认）：工具描述缩短到约 1 KB，只保留调用前提（用户明确选择多 agent 编排）、参数、返回与后台通知语义，并指明编写脚本前读取 workflow skill；完整编排指南移入随包发布的 skill（与 skills/pi-suite-jobs 同一机制），保持原有与 Claude Code 对齐的措辞。skill 在系统提示中只占名称与说明，正文仅在实际使用时读取。

备选方案：保留完整描述，默认不激活 agent_workflow，由 `/subagents workflows` 或明确命令为当前会话激活。缺点是用户说“用 workflow”时模型无法直接调用，需要先手动激活。

两种方案都复用现有 registerBoundTool 与 skills 机制，不新建工具注册或文档加载系统。

## 影响范围

- src/ask/index.ts、src/agents/child.ts（共用结果文本格式化）
- src/agents/workflow/tool-description.ts、src/agents/workflow/tools.ts、skills/ 下新增 workflow skill 与包声明
- 相关 current 文档：[ask](../current/ask/index.md)、[模型工具契约](../current/runtime/tools.md)、[Workflow 操作](../current/agents/workflow/operations.md)

## 约束

- timed_out 与 skipped 的“不是同意”语义必须保留在文本中，不能因精简丢失。
- 历史记录使用持久化 content/details 重绘；details 结构不变，旧会话可继续显示。
- skill 正文与工具描述不重复维护同一段指南。

## 验收

- ask_user 单题、多选含自定义、freeform、timed_out、skipped、cancelled、批量部分作答的 content 与上文格式一致，details 与历史展开显示不变。
- child 向 parent 提问的结果与主会话格式一致并带 source。
- agent_workflow 描述体积降到约 1 KB；模型在用户要求 workflow 时读取 skill 后能正确编写并启动脚本。

## 任务

- [ ] ask_user 主会话与 child 结果改为共用的文本格式
- [ ] 更新 doc/current/ask/index.md 结果字段说明与 runtime/tools.md 中 ask 相关描述
- [ ] 确认 agent_workflow 方案（短描述 + skill / 按需激活）
- [ ] 按确认方案实现 agent_workflow 描述精简并更新 workflow 操作文档

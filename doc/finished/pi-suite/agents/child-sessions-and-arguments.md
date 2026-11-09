# Subagent 会话存储位置与空值参数

## 目标

- `/resume` 会话列表只显示主会话，不显示 subagent（含 workflow child）的会话文件。
- 查明模型为所有可选参数填值的根因并在配置层修正。

## 当前状态

- src/agents/runner.ts 以 `SessionManager.create(record.cwd, sessionDir, {parentSession})` 创建持久 child 会话，sessionDir 未配置时为 Pi 默认 `<agentDir>/sessions/<cwd-slug>/`，与主会话同目录。Pi 1.5 的 `SessionManager.list` 读取该目录全部 `.jsonl`（不递归），`listAll` 只读取 sessions 下一层目录，因此 `/resume` 同时列出全部 child 会话。当前项目目录已有 10 个带 parentSession 的 child 会话文件。
- src/agents/history.ts 的工作区发现从主会话记录中的 child/workflow 引用（绝对路径）继续跟随，不依赖 child 文件与主会话同目录。
- 用户的 cpa provider（openai-responses，经本机代理）下 gpt-6.1-sol 对所有可选参数都会填值：`task_list` 不传参数的要求下实际传入 `{"cursor":"","groupId":"1","limit":1,"state":"unfinished"}`；`agent_start` 传入 `schedule:""`、编造的 model/taskId 等。Pi 1.5 对该 provider 默认 `strict:false`，工具 schema 的 required 只含必填字段，因此根因在代理或模型侧，不在本仓库。本仓库只能处理可确定无意义的值：空字符串。`agent_start` 把 `schedule:""` 当作已提供，返回 `schedule cannot be combined with background:false or inheritContext`，误导模型。

## 方案

### child 会话目录

- 未显式配置 type.sessionDir 时，持久 child 会话创建在父会话文件所在目录的 `subagents/` 子目录（父会话为内存会话时使用 Pi 默认目录下的 `subagents/`）；嵌套 child 与 workflow child 同样使用其直接父会话目录下的 `subagents/`，不再逐层嵌套目录（嵌套 child 的父会话已位于 `subagents/` 时直接使用该目录）。显式配置 sessionDir 的类型保持用户设定。
- Pi 的 list/listAll 不读取子目录，因此 `/resume` 不再列出新建的 child 会话。历史发现继续通过父会话引用读取 child 文件；`/subagents` Workspace、transcript、resume 同一 agent 的行为不变。
- 已有的同目录 child 会话不自动迁移（改写父会话记录中的路径属于难以撤销的操作），需用户确认后另行处理。

### 可选参数被填值的根因与处理

- 抓取 Pi 实际请求确认：cpa provider 未声明 compat，`supportsStrictMode` 默认 false，Pi 在工具定义中省略 `strict` 字段。直接请求本机代理验证：同一工具省略 `strict` 时 gpt-6.1-sol 返回 `{"cursor":"0","limit":1}`，显式 `strict:false` 时返回 `{}`。即代理/后端在缺省时按 strict 处理，模型被迫为每个可选字段填值。
- 处理：在用户 `~/.pi/agent/models.json` 的 cpa provider 增加 `compat.supportsStrictMode: true`，Pi 显式发送 `strict:false`。修改后真实 Pi 中 task_list 实际参数为 `{}`，agent_start 只传 name/type/prompt 并正常启动。
- 本仓库不增加空值剥离等兜底：编造的非空值（如 `schedule:"+1m"`、`model:"openai/gpt-5.4"`、`taskId:"1.1"`）无法在扩展侧识别，兜底只能掩盖配置问题。schedule 与 inheritContext（含 false）互斥保持既有文档约定。

## 影响范围

- src/agents/runner.ts（child 会话目录）、src/agents/workflow/host.ts（若 workflow child 另行创建会话）
- 相关 current 文档：[agents 运行时](../../../current/agents/runtime.md)、[agents 历史](../../../current/agents/history.md)

## 验收

- 新建持久 subagent 后，会话文件位于 `<父会话目录>/subagents/`，`SessionManager.list(cwd)` 不包含它；`/subagents` Workspace 仍能发现并打开其 transcript，resume 同一 agent 继续使用原文件。
- 修正配置后，真实 Pi 中 gpt-6.1-sol 调用 task_list 与 agent_start 不再填充未要求的可选字段。

## 任务

- [x] child 会话写入父会话目录下的 subagents/，嵌套与 workflow child 同规则
- [x] 可选参数填值根因定位：provider compat.supportsStrictMode 配置修正（用户配置，非仓库代码）
- [x] 测试与 agents/tools 当前文档

# 模型工具

[文档索引](index.md)

本套件为模型注册以下工具，参数见链接页面。工具只在所属模块启用时注册。

| 工具 | 模块 | 用途 |
| --- | --- | --- |
| [`ask_user`](modules/ask.md#参数) | ask | 向用户提出单个问题或 2–4 个批量问题。 |
| [`goal_complete`](modules/goal.md#模型工具) | goal | 附审计证据完成当前目标。 |
| [`goal_blocked`](modules/goal.md#模型工具) | goal | 因反复出现的外部阻塞暂停目标。 |
| [`goal_wait`](modules/goal.md#模型工具) | goal | 暂停目标的本轮执行，直到所列 job、agent 或 workflow 结束。 |
| [`task_list`](modules/tasks.md#工具) | tasks | 列出任务并获取当前代次。 |
| [`task_get`](modules/tasks.md#工具) | tasks | 读取单个组或子任务。 |
| [`task_edit`](modules/tasks.md#工具) | tasks | 新增、更新、删除、开始、完成、阻塞或清空任务，可单项或原子批量执行。 |
| [`job_start`](modules/jobs/index.md#工具) | jobs | 启动 pipe 或 PTY job、CLI 预设、监视器或受监督终端。 |
| [`job_list`](modules/jobs/index.md#工具) | jobs | 按状态和范围列出 job。 |
| [`job_get`](modules/jobs/index.md#工具) | jobs | 获取单个 job 的状态和详情。 |
| [`job_read`](modules/jobs/index.md#工具) | jobs | 读取 job 的输出、输入或事件。 |
| [`job_write`](modules/jobs/index.md#工具) | jobs | 向运行中的 job 发送文本、按键或粘贴内容。 |
| [`job_stop`](modules/jobs/index.md#工具) | jobs | 停止 job 并报告清理证据。 |
| [`agent_start`](modules/agents/index.md#工具) | agents | 启动或定时调度子代理。 |
| [`agent_list`](modules/agents/index.md#工具) | agents | 列出子代理运行。 |
| [`agent_get`](modules/agents/index.md#工具) | agents | 获取单个运行的状态、模型和待回答的问题。 |
| [`agent_read`](modules/agents/index.md#工具) | agents | 读取运行的对话记录或结果。 |
| [`agent_send`](modules/agents/index.md#工具) | agents | 引导、回答或恢复子代理。 |
| [`agent_stop`](modules/agents/index.md#工具) | agents | 停止运行、其子代理及它们的 job。 |
| [`agent_workflow`](modules/agents/workflows.md#agent_workflow) | agents | 在后台运行编排脚本。 |
| [`wait`](concepts.md#wait-工具) | 共享 | 等待 `job_`、`agent_` 或 `wf_` ID。 |

## 约定

- 列表默认最多返回 10 项，用 `cursor` 翻页；每页同时控制在约 4 KiB 以内。
- ID 始终使用之前调用返回的准确字符串。界面中子代理以名称显示，但工具使用 `agent_` 和 `run_` ID。
- 结果以一行摘要开头；输出被截断或需要后续操作时，会给出具体的下一步。

## 错误码

错误以错误码开头，随后是原因和建议的下一步。下表列出常用错误码；模块特有的错误码见各模块页面。

| 错误码 | 含义 |
| --- | --- |
| `INVALID_ARGS` | 参数缺失、格式错误或与其他参数冲突。 |
| `NOT_FOUND` | 没有该 ID 的对象。 |
| `HISTORY_READ_ONLY` | 对象只存在于保存的历史中，无法控制。 |
| `NOT_RUNNING` | 该操作需要对象处于运行状态。 |
| `USER_CONTROL` | 用户已接管该 PTY。 |
| `STALE_BINDING` | 调用所属的会话、目标修订版本或轮次已不再是当前的。 |
| `CLOSING` | Pi 正在关闭。 |
| `UNSUPPORTED_STREAM` | 该 job 模式没有这个流。 |
| `RUNTIME_UNAVAILABLE` | 本进程中的 job 运行时无法执行该操作。 |
| `REGEX_RESOURCE_LIMIT` | 搜索正则耗尽了引擎资源，请改用 offset 分页。 |
| `TASK_STALE` | 任务代次已过期，请重新列出任务。 |
| `TASK_GENERATION_REQUIRED` | 任务引用缺少来源代次，请从 `task_list` 获取。 |
| `TASK_SCOPE` | assigned 范围的任务调用超出了分配的任务。 |
| `MODEL_UNAVAILABLE` | 配置的模型没有凭据，或模型名匹配到多个模型。 |
| `MODEL_RUNTIME_UNAVAILABLE` | 父级模型运行时无法与子代理共享。 |
| `START_NOT_COMMITTED` | 因创建者正在被停止，job 启动被拒绝。 |
| `WORKSPACE_CAPACITY` | 工作区的 job 历史已达 1 GiB，请先删除旧 job。 |
| `JOB_OCCUPIED` | job 仍在活动或清理尚未确认，不能删除。 |
| `NOT_OWNER` | 目标属于其他会话或分支。 |
| `ALREADY_RUNNING` | 子代理仍在运行或正在停止。 |
| `AGENT_DEPTH` | 会超过 `agents.maxDepth`。 |
| `INVALID_ANSWER` | 回答与问题不符，例如对单选题给出多个选项。 |

# Subagent 任务清单隔离

## 目标

subagent 拥有自己的任务清单，不能修改主 agent 的任务；被分配了主清单任务（agent_start.taskId）的 subagent 只能更新这一个任务的进度。

## 实施前问题

- src/agents/child.ts 以 `run.parent.taskStore` 创建 child 的 TasksModule，child 与嵌套 child 获得完整的 task_list/task_get/task_edit，可以新增、修改、删除父级清单中的任意任务，并通过父级 Dock 显示。
- 实施前文档将其描述为设计（[tasks](../../../current/tasks/index.md) 的执行引用段、[存储与会话](../../../current/tasks/storage.md) 的 child 段），没有权限边界。
- TaskStore.link 保存 agent owner 与 jobIds；agent_start 的 taskId 用于建立执行引用，执行结束不自动修改任务状态。

## 方案（用户已确认）

- child 的 task_list/task_get/task_edit 默认操作该 child 自己的私有清单，存储按 child 会话目标定位，复用现有 TaskStore 注册表与文件协议；私有清单不进入主会话 Dock，可在 /subagents transcript 或 child 的 Dock（若存在）中查看。
- agent_start 传入 taskId 时，child 额外获得对父级清单中该子任务的受限访问：只允许 start、done、block、unblock，以及读取该任务；不允许 add、update 其他字段、delete，也不能操作父级其他任务。受限操作通过明确的参数或独立入口区分目标清单（例如 task_edit 的 op 作用于 `assigned` 任务，或在工具描述中说明分配任务 ID 指向父级清单），设计时选择对模型最不易混淆的方式，并在工具描述中说明。
- 越权操作返回明确的 ToolError（例如 TASK_SCOPE），说明 child 只能更新分配给它的任务。
- 嵌套 child 遵循相同规则：其“父级清单”为直接父 child 的私有清单；taskId 只能引用直接父级清单中的任务。
- 恢复同一稳定 agent ID 时沿用原私有清单与分配任务。

## 影响范围

- src/agents/child.ts、src/agents/types.ts（ParentScope.taskStore）、src/agents/manager.ts 的 taskId 校验
- src/tasks/index.ts、src/tasks/tools.ts、src/tasks/store.ts（目标键）
- 相关 current 文档：[tasks](../../../current/tasks/index.md)、[存储与会话](../../../current/tasks/storage.md)、[agents 运行时](../../../current/agents/runtime.md)

## 验收

- child 调用 task_edit add/update/delete 只改变自己的清单，主清单与主 Dock 不变。
- 带 taskId 的 child 可对该任务 start/done/block/unblock，操作其他父级任务或其他字段返回明确错误。
- 嵌套 child 与恢复执行遵循相同边界。

## 任务

- [x] child 私有 TaskStore 与目标键
- [x] 分配任务的受限访问与越权错误
- [x] 嵌套与恢复执行沿用边界
- [x] 更新 tasks/agents 当前文档

## 实施结果

- 私有清单沿用 TaskStore 注册表及 JsonStore version:3 文件协议，以 child 实际 cwd、会话 ID 与持久化设置定位；持久与同进程内存恢复均复用原目标，不播种父级清单。
- task_get/task_edit 使用显式 scope:assigned 访问分配任务，省略 scope 或 scope:local 始终指向私有清单。双方 ID 重名不引起自动路由，assigned 批次只接受同一任务的四种进度操作，越权整批返回 TASK_SCOPE。
- assigned 读取仅返回分配任务，进度回执不暴露其他父级任务的派生回执或组统计。嵌套准入只捕获直接父 child 的私有 store，tasks 未启用时携带 taskId 明确失败；恢复校验继承的 taskId，删除目标后恢复返回 NOT_FOUND，不停止已存活执行。
- 新增两条契约测试，更新并发、reload/fork、持久历史恢复、问答进度与嵌套分配的已有测试。Linux Node 24 离线 SDK/任务相关测试 27 项通过，pnpm typecheck 通过。

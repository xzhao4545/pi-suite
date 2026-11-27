# 两级任务管理

一个任务清单包含任务组和直属子任务，最多两层。`task_list`、`task_get` 和 `task_edit` 供模型调用；用户通过 [`/tasks`](operations.md#tasks) 浏览。任务状态不等于 goal、agent 或 job 的执行结果。

## 结构与状态

组 ID 是递增的十进制编号。子任务 ID 形如 `1.2`，表示组 `1` 的第 `2` 个子任务；`parentId` 保存组 ID。编号、清空与 `generation`（清单代次）见[存储与会话](storage.md)。

| 对象 | 有效状态，按优先顺序 |
| --- | --- |
| 子任务 | 存储状态为 `done` 时显示 `done`；否则有未完成依赖时显示 `blocked`；其余使用存储状态（`todo`、`doing` 或手动 `blocked`）。 |
| 组 | 有子任务且全部完成时为 `done`；否则组本身有未完成依赖时为 `blocked`；有有效 `doing` 的子任务时为 `doing`；未完成子任务全为 `blocked` 时为 `blocked`；其余为 `todo`。无依赖的空组为 `0/0 todo`。 |

组进度统计全部现存子任务；增删或重新打开子任务会改变计数，筛选、折叠和搜索不会。`blockedBy` 保存直接依赖 ID，`blocks` 为反向关系，由同一字段计算。自引用、不存在的依赖、互相依赖，以及把带未完成依赖的任务设为 `doing` 或 `done` 都会警告，编辑仍可提交。删除任务时会清理指向它的依赖。

## 工具

| 工具 | 参数与返回 |
| --- | --- |
| `task_list` | `task_list({})` 返回当前 `generation` 和未完成清单。可传 `groupId`、`state`（默认 `unfinished`，也可用 `doing`、`blocked`、`done`、`all`）、`cursor`、`limit`。传 `groupId` 或 `cursor` 时必须带取得该值时的代次。分页先按组的创建时间，再按组 ID 和子序号排序；默认 10 项，最多 100 项，正文预算约 4 KiB。分页从组中间开始时补上组标题；有下一页时返回 `nextCursor`，正文的 `more:` 给出续页调用。 |
| `task_get` | 必填 `generation` 和 `id`。返回一个组或子任务的完整标题、状态、说明、手动阻塞原因、未完成依赖、反向依赖和执行引用。组详情不展开子任务；用 `task_list` 按组查询。 |
| `task_edit` | 必填 `generation`。传 `op` 编辑一项，或用 `op: "batch"` 按顺序执行 `changes` 内的 1–100 项；任一项无效时整批不提交。回执给出当前代次、实际 ID、标题、父组、字段变化、有效状态、依赖引起的状态变化、组进度和警告。字段无变化时显示 `unchanged`。 |

有分配任务的 child 可在 `task_get` 和 `task_edit` 中指定 `scope`，见 [child 任务范围](operations.md#child-任务范围)。

| `op` | 参数与效果 |
| --- | --- |
| `add` | 不传 `parentId` 创建组；可用 `children` 一次创建最多 100 个直属子任务，只接受标题数组；组不能指定 `status`。传 `parentId` 创建子任务，默认 `todo`，不可传 `children`。后续操作使用回执中的实际 ID。 |
| `update` | 传 `id` 和要改的 `title`、`description`、`status`、`blockedBy` 或 `blockedReason`。空字符串清空说明；`blockedBy` 替换整组依赖（最多 100 个不同 ID）。只有子任务可改 `status`；移动任务须删除后在目标组新增。 |
| `delete` | 传 `id`；删有子任务的组须明确传 `cascade: true`。 |
| `start` / `done` | 传子任务 `id`，设为 `doing` / `done`。可同时有多个 `doing`。 |
| `block` / `unblock` | 传子任务 `id`。`block` 可带 `reason`，不会重新打开完成项；`unblock` 将手动 `blocked` 设回 `todo`，未完成依赖仍可使有效状态为 `blocked`。 |
| `clear` | 只能单独调用，不能放进批次或用于 `assigned` 范围。清空本清单及其中的依赖和执行引用；编号重置。自动清空条件和回执见[存储与会话](storage.md)。 |

标题为 1–200 字符，去掉首尾空白后必须非空；说明最多 8000 字符。`reason` 和 `blockedReason` 最多 500 字符。`blockedReason` 只用于存储状态为 `blocked` 的子任务，离开该状态时清除；空字符串可清除原因。

## 执行引用

1. 启动 job 或 agent 时，可一起传 `taskId` 和 `taskGeneration`。`taskId` 必须指向调用方本地清单中的子任务，`taskGeneration` 必须是取得该 ID 时的代次。agent 启动时记录该清单及代次，主会话 reload 或 fork 不改变它。job 的关联要求启用 tasks；嵌套调用的清单见 [child 任务范围](operations.md#child-任务范围)。
2. `TaskStore.link` 是写入执行引用的入口。在存储锁内校验代次，把 agent ID 写入 `owner`，或把 job ID 加入 `jobIds`；不会设置任务状态。job 和 agent 记录也保存 `taskId` 与 `taskGeneration`。job 的归属与通知仍按[会话和创建者](../jobs/index.md)确定。
3. agent 恢复时沿用 agent ID、child 会话和启动时的任务引用，见 [任务关联](../agents/runtime.md#任务关联)。缺代次报 `TASK_GENERATION_REQUIRED`，代次不符报 `TASK_STALE`，不会绑定重新分配的 ID。

执行完成或停止不会把任务设为 `done`。删除任务或清空清单不会停止执行；job 历史和详情仍显示启动时的任务引用及其源代次。

## 模块文件

- `types.ts`：工具参数与存储格式。
- `model.ts`、`query.ts`：批量编辑、状态计算、依赖与查询。
- `store.ts`：串行读写、文件锁和提交。
- `index.ts`：会话绑定、Dock 摘要、完成反馈和提醒。
- `schema.ts`、`tools.ts`、`render.ts`：参数校验、工具回执及其显示。
- `commands.ts`：注册命令，处理非 TUI 查询，按需加载查看器。
- `presentation.ts`、`viewer.ts`：任务文字和符号，接入共享 `BrowserView`（列表查看器）。

[存储与会话](storage.md) · [用户操作](operations.md) · [基线与验证](../validation.md)

[返回当前文档](../index.md)

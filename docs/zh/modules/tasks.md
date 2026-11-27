# Tasks

[文档索引](../index.md)

tasks 模块为模型提供两级任务清单：分组，以及组内的子任务。它帮助模型规划多步骤工作，并在 Dock 中向你展示进度。开关：`modules.tasks`。

## 结构

- 组的 ID 为 `1`、`2`……；子任务的 ID 形如 `1.2`。只有两级。同一清单代次内，删除的 ID 不会被复用。
- 子任务状态为 `todo`、`doing`、`blocked` 或 `done`。多个任务可以同时处于 `doing`。阻塞的任务可以带 `blockedReason`。
- `blockedBy` 列出依赖。依赖未完成的任务显示为阻塞。
- 组的状态和进度由子任务派生：全部子任务完成时为 done，有子任务进行中时为 doing，所有未完成子任务都阻塞时为 blocked。组的状态不能直接设置。
- 任务状态与 job、agent 的状态相互独立。job 结束不会把对应任务标记为完成。

## 代次

每个清单都有一个 `generation`（代次）标记。`task_list({})` 返回当前代次，`task_get`、`task_edit` 以及按组或游标翻页时必须引用它。

非空清单中的所有任务都完成后，清单自动清空。模型也可以用 `task_edit({ generation, op: "clear" })` 主动清空。清空会把编号重置为 `1` 并生成新代次。引用旧代次的调用返回 `TASK_STALE`，因此过期引用不会指向复用了相同 ID 的新任务。清空不会停止 job 或 agent，也不会完成目标。

## 工具

| 工具 | 参数 |
| --- | --- |
| `task_list` | `generation?`、`groupId?`、`state?`（默认 `unfinished`，可选 `doing`、`blocked`、`done`、`all`）、`cursor?`、`limit?`（默认 10）。组的计数始终包含全部子任务。 |
| `task_get` | `generation`、`id`。返回单个组或子任务，含说明、依赖和执行引用。 |
| `task_edit` | `generation` 加一个操作，或 `op: "batch"` 加 1–100 项 `changes`。批量操作原子提交：任何一项无效，整批都不生效。 |

操作：

| `op` | 字段 |
| --- | --- |
| `add`（组） | 不带 `parentId`。`title`、`description?`、`blockedBy?`，以及最多 100 个 `children` 标题。组本身没有 `status`。 |
| `add`（子任务） | 带 `parentId`。`title`、`description?`、`status?`、`blockedBy?`。子任务不能带 `children`。 |
| `update` | `id`，以及 `title`、`description`、`status`、`blockedBy`、`blockedReason` 中的任意字段。只有子任务有状态。移动任务需要先删除，再在目标组中新增。 |
| `delete` | `id`；非空的组需要 `cascade: true`。 |
| `start` / `done` / `unblock` | 子任务的 `id`。 |
| `block` | `id`，以及可选的 `reason`（最多 500 个字符）。 |
| `clear` | 只能在顶层使用，不能放进批量操作。 |

标题为 1–200 个字符，说明最多 8000 个字符。结果列出实际变化、依赖任务的派生状态变化、组进度和警告（例如依赖成环）。

## 把工作关联到任务

`job_start` 和 `agent_start` 接受 `taskId`（如 `1.2`）及 `taskGeneration`。job 或 agent 的 ID 会记录到任务上。关联本身不改变任务状态。

子代理有自己的私有任务清单，不显示在你的 Dock 中。如果启动时带了 `taskId`，它可以用 `scope: "assigned"` 读取和更新这一个父级任务：

```json
{ "generation": "<分配时的 generation>", "scope": "assigned", "op": "done", "id": "1.2" }
```

assigned 范围只允许对该任务执行 `task_get`，以及 `start`、`done`、`block`、`unblock` 操作，其他操作返回 `TASK_SCOPE`。不带 `scope` 时，ID 始终指向子代理的私有清单。

## 任务浏览器

`/tasks [组 ID]` 打开标题为 `Tasks ▸ List` 的浏览器，默认显示全部任务。

| 按键 | 操作 |
| --- | --- |
| `g` | 循环切换组筛选。 |
| `s` | 循环切换状态筛选：All、Unfinished、Running、Blocked、Completed。 |
| `/` | 按 ID、标题、说明、阻塞原因或状态筛选。 |
| Tab | 在列表和详情之间切换。 |
| Enter | 返回对话，并在 Dock 中选中该任务所在的组。 |
| Esc | 退出搜索或详情，清空筛选，然后关闭。 |

浏览器是只读的，任务只能通过模型的工具修改。没有 TUI 时，`/tasks` 以文本输出清单。

## Dock 显示

Tasks 分区标题显示全部子任务的完成数/总数。每个组以树形显示并带有自己的计数，使用 ☐ 待办（强调色）、⟳ 进行中（绿色）、⚠ 阻塞（黄色，附 `(Blocked)`）、☑ 完成（暗色并带删除线）。只展开一个组：Dock 中选中或通过 `/tasks` 选定的组，否则依次取有进行中任务的组、有阻塞任务的组、最近更新的组。展开的组显示最近完成的一项和最多 5 个未完成任务；剩余未完成任务有两个或更多时折叠为 `… N more items`。其他未完成组只显示标题和计数，按 ID 顺序最多 4 个。Dock 空间仍不足时，优先保留当前组及其当前任务。没显示出来的未完成组，无论是超出 4 个上限还是因空间不足被省略，都计入最后一行 `… N more groups`。已完成的组合并为一行 `☑ N completed groups`。整个清单完成后，分区显示结果 5 秒后消失。

## 提醒

`tasks.reminders` 开启（默认）时，如果模型连续 4 轮没有使用任务工具（存在 `doing` 任务时为 2 轮），会在模型的下一次请求中附加提醒，列出最多 10 个未完成任务和当前代次。提醒本身不会触发请求，也不会修改任何任务。

## 存储与会话

已保存的会话把清单存放在 `<cwd>/.pi/tasks/tasks-<sessionId>.json`；未保存的会话只保存在内存中。fork 已保存的会话会把清单复制到独立文件；fork 内存会话则从空清单开始，并显示警告。

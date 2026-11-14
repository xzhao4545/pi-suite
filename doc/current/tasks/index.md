# 两级任务管理

tasks 模块用父级分组与直接子任务组织工作，工具为 task_list、task_get、task_edit，用户入口为 /tasks。任务进度与 goal、agent、job 的结算分别管理，完成计数只表示当前子任务状态。

## 结构与状态

- 组使用递增十进制 ID，子任务使用 `组ID.序号`（如 `1.2`）；nextId 只计组，各组 nextChild 分配子序号，同一 generation 内 delete 后不复用。整清单自动/主动清空重置编号并轮换 generation，引用须携带源代次。parentId 指向组，最多两层。
- 子任务状态为 todo、doing、blocked、done，可记录手动 blockedReason。有效状态优先 done，其次未完成依赖造成 blocked，最后使用存储状态。父级状态由直接子任务派生：全部完成且数量大于 0 为 done，自身依赖未完成为 blocked，存在有效 doing 为 doing，未完成子任务全部 blocked 为 blocked，其余为 todo；空组为 0/0 todo。
- 父级进度始终统计全部现存子任务，筛选、折叠与搜索不改变计数。新增、删除和重新打开子任务都会重算相应父级。
- blockedBy 保存依赖 ID，反向 blocks 从同一数据派生。自引用、不存在目标、二元环和带未完成阻塞项的 doing/done 更新返回明确警告；删除时清理指向被删除对象的依赖。

## 工具

| 工具 | 参数与返回 |
| --- | --- |
| task_list | generation?、groupId?、state?（unfinished 默认、doing、blocked、done、all）、cursor?、limit?；不引用 ID 的 task_list({}) 发现当前 generation，按组/游标续页须引用源代次。默认按组返回未完成清单，组进度包含全部子任务。默认 10 项、约 4 KiB，按组/子 ID 稳定分页，中间页保留组标题；正文提供 nextCursor 的可执行续页入口 |
| task_get | generation、id、scope?（local 默认；assigned 读取直接父级分配任务）；返回一个组或子任务的完整标题、状态、说明、有效阻塞项、反向依赖和执行引用，不自动展开组内子任务 |
| task_edit | generation 必填；单项直接指定 op；批量使用 op=batch、changes（1–100 项），scope? 作用于整批（local 默认；assigned 仅更新分配任务进度）。支持 add/update/delete/start/done/block/unblock 和 owner 顶层 clear；按顺序原子提交，任一无效则整批不生效。回执含当前 generation、真实 ID/标题/父级、实际变化、有效状态、依赖派生变化、组进度与警告；重复相同设置显示 unchanged；非空全部完成自动清空并报告 cleared 原因 |

add 不传 parentId 创建父级，可用 children 提供最多 100 个直接子任务标题；传 parentId 创建子任务，默认 todo。update 使用 id，只提交 title、description、status、blockedBy、blockedReason 中发生变化的字段；description 空字符串清空说明，blockedBy 数组替换依赖。只有子任务可修改 status；移动需删除后在目标组新增。父级状态不能直接修改。删除带子任务的父级必须明确 cascade:true。start/done/block/unblock 使用 `1.2` 形式的子任务 ID，start/done 使用 generation/op/id；block 可带 reason（最多 500 字符），unblock 将手动 blocked 返回 todo，尚未完成的依赖继续派生阻塞。完成项不会因 block 重开；多个 doing 可以并发。blockedReason 仅适用于手动 blocked 子任务，离开该状态时清除。

标题为 1–200 字符且包含非空白文本，说明最多 8000 字符。children 是标题数组，不接受嵌套对象；新增父级的子任务直接用 children 创建，后续操作使用已返回的真实 ID。

## 执行引用

job_start(taskId, taskGeneration) 在 tasks 启用时要求 ID 对应当前会话的子任务且源代次有效，记录 job 的 taskId/taskGeneration 并把 job ID 写回该任务。执行归属仍由 JobManager 的会话与创建者字段确定；job 停止或完成不自动修改任务状态。任务删除或 clear 不停止 job，job 历史保留启动时的引用，详情说明源代次。

TaskStore.link 为统一执行引用入口，保存 agent owner 与 jobIds；它在锁内检查 generation，不设置任务状态。agent_start(taskId, taskGeneration) 要求 ID 对应直接父级清单中的子任务，并捕获该清单及代次。每个 child 的 task_list/task_get/task_edit 默认操作自己的私有清单，私有变更不进入主会话 Dock；child 的 job_start 和新嵌套 agent_start 同样只引用该私有清单。agent 恢复沿用稳定 agent ID、child 会话目标与 taskId/taskGeneration，关联过期返回 TASK_STALE，缺少代次明确拒绝，不绑定重用 ID；完成或停止执行不自动把任务改为 done。会话切换和 fork 的清单边界见 [存储与会话](storage.md)。

带 taskId 的 child 用 `task_get({"generation":"<assigned source>","scope":"assigned","id":"1.2"})` 读取分配任务，用 `task_edit({"generation":"<assigned source>","scope":"assigned","op":"done","id":"1.2"})` 更新其 start/done/block/unblock 进度。省略 scope 或指定 local 时，ID 永远指向私有清单，即使两个清单都存在 `1.2`；不根据 ID 自动路由。assigned 不支持 add/update/delete/clear、其他父级 ID 或跨清单批次，越权返回 TASK_SCOPE，说明只能读取或更新分配任务；整批权限检查失败不提交任何变化。assigned 回执仅保留该任务的变化与警告，不返回父级其他任务的派生回执或组进度；父级订阅仍正常观察实际派生状态。主会话或没有分配任务的 child 的 task_get/task_edit schema 不包含 scope 字段，也不附加 scope 说明；scope 参数与说明仅在有分配任务的 child 中提供。

## 模块文件

- types.ts：参数与存储 schema。
- model.ts、query.ts：批量编辑、进度、依赖与查询。
- store.ts：统一串行入口、存储锁与原子提交。
- index.ts：会话绑定、Dock 摘要、完成反馈与提醒。
- schema.ts、tools.ts、render.ts：公共参数校验、短回执与公共工具显示框架接入。
- commands.ts：轻量命令注册、非 TUI 文本查询与按需交互加载。
- presentation.ts、viewer.ts：统一任务文字/符号与共享 BrowserView 接入。

存储见 [存储与会话](storage.md)，操作见 [用户操作](operations.md)，验证范围见 [基线与验证](../validation.md)。

[返回当前文档](../index.md)

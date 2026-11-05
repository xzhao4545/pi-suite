# 两级任务管理

tasks 模块用父级分组与直接子任务组织工作，工具为 task_list、task_edit，用户入口为 /tasks。任务进度与 goal、agent、job 的结算分别管理，完成计数只表示当前子任务状态。

## 结构与状态

- 父子共用递增十进制短 ID，删除后不复用；parentId 指向父级，最多两层。
- 子任务状态为 todo、doing、done。父级状态由现存直接子任务派生：全部完成且数量大于 0 为 done，存在 doing 为 doing，其余为 todo；空组为 0/0 todo。
- 父级进度始终统计全部现存子任务，筛选、折叠与搜索不改变计数。新增、删除、移动和重新打开子任务都会重算相应父级。
- blockedBy 保存依赖 ID，反向 blocks 从同一数据派生。自引用、不存在目标、二元环和带未完成阻塞项的 doing/done 更新返回明确警告；删除时清理指向被删除对象的依赖。

## 工具

| 工具 | 参数与返回 |
| --- | --- |
| task_list | id? 或 parentId?，includeDone?，detail?；id 与 parentId 互斥。默认按组返回未完成父级和子任务，includeDone 显示全部。按 id 始终返回单项；按 parentId 始终返回指定组，子任务按完成筛选。默认短摘要，detail 增加说明、未完成阻塞项、反向依赖和执行引用 |
| task_edit | changes 数组，1–100 项，op 为 add/update/delete；一批按顺序校验和提交，任一操作无效则整批不生效。返回新增 ID/标题/父子关系、更新 ID/实际变化字段、删除 ID、受影响父级进度与警告 |

add 不传 parentId 创建父级，可用 children 提供最多 100 个直接子任务标题；传 parentId 创建子任务，默认 todo。update 使用 id，只提交 title、description、status、parentId、blockedBy 中发生变化的字段；description 空字符串清空说明，blockedBy 数组替换依赖。只有子任务可修改 status 或移动至另一父级；父级状态不能直接修改。删除带子任务的父级必须明确 cascade:true。

标题为 1–200 字符且包含非空白文本，说明最多 8000 字符。children 是标题数组，不接受嵌套对象；新增父级的子任务直接用 children 创建，后续操作使用已返回的真实 ID。

## 执行引用

job_start(taskId) 在 tasks 启用时要求 ID 对应当前会话的子任务，记录 job 的 taskId 并把 job ID 写回该任务。执行归属仍由 JobManager 的会话与创建者字段确定；job 停止或完成不自动修改任务状态。任务删除不停止 job，job 历史仍保存启动时的 taskId。

TaskStore.link 为统一执行引用入口，保存 agent owner 与 jobIds；它不设置任务状态。agents 的运行接入和恢复后的引用关联由 [子代理计划](../../todo/pi-suite/agents/index.md) 管理。

## 模块文件

- types.ts：参数与存储 schema。
- model.ts、query.ts：批量编辑、进度、依赖与查询。
- store.ts：统一串行入口、存储锁与原子提交。
- index.ts：会话绑定、Dock 摘要、完成反馈与提醒。
- tools.ts、viewer.ts：原生工具与共享详情接入。

存储见 [存储与会话](storage.md)，操作见 [用户操作](operations.md)，验证范围见 [基线与验证](../validation.md)。

[返回当前文档](../index.md)

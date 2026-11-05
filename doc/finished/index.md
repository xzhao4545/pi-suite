# 已完成专项

本目录保存已完成专项记录。形成的稳定实现与规则维护在 [当前文档](../current/index.md)，未完成需求维护在 [待办索引](../todo/index.md)。

- [ask 默认答案与预选项](./pi-suite/ask/default-answers.md) — 默认初始化、参数冲突和明确提交。
- [ask 批量提问、多选与推荐](./pi-suite/ask/batch-selection.md) — 独立题型、稳定选项 ID 和整批确认。
- [目标生命周期与状态摘要基础阶段](./pi-suite/goal-core.md) — 宿主恢复、用户控制、预算、分支归属与状态发布。
- [PTY hands-free 与 dispatch 基础阶段](./pi-suite/jobs/hands-free-core.md) — 增量预算、静默终止、用户接管、共享等待与 reload 后目标唤醒；Linux 离线验收。
- [CLI 预设与启动授权基础阶段](./pi-suite/jobs/cli-launch-core.md) — 内置/自定义预设、Pi fork 参数、字面量 prompt、用户级 launchPolicy 与共享 ask；Linux 离线验收。
- [日志实时查看与历史分页基础阶段](./pi-suite/jobs/log-viewer-core.md) — 有界字节窗口、底部跟随、搜索位置保留、最终输出与列表游标；Linux 离线验收。
- [同进程升级控制基础阶段](./pi-suite/jobs/runtime-control-core.md) — 独立版本控制桥、受限查询与停止、quit、空闲替换与自然退出竞争；Linux 离线验收。
- [子代理执行与交互基础阶段](./pi-suite/agents/core.md) — 同进程会话、两池队列、父级提问、持久 run 记录、任务共享与 job 清理；Linux 离线验收。
- [子代理模型配置基础阶段](./pi-suite/agents/models-core.md) — 类型逐字段写回、单 agent 下一请求切换与持久恢复、原生选择与阅读状态；Linux 离线验收。
- [两级任务基础阶段](./pi-suite/tasks/core.md) — 原子批量编辑、派生进度、统一存储、会话与提醒、共享详情和 job 引用；Linux 离线验收。

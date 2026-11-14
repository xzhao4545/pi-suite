# 待办事项

本目录是活跃待办事项的唯一维护位置。新增产品、工程、文档或验证待办时，应按主题创建或更新本目录下的对应文件。已完成专项的完整清单以 [doc/finished/index.md](../finished/index.md) 为唯一出口，本文件不重复枚举。

## 任务索引

- [UI 文案、Goal 状态与 Responses 跨资源恢复](goal-responses-recovery.md) — 待实施；保留诊断告警，仅留 /goal pause，三态生命周期与一行恢复展示，设置化跨资源历史 ID 隔离、瞬态重试及 Goal 最终结算协调。
- [源码入口启动性能优化](source-startup-performance.md) — 待实施；解耦 renderer/执行依赖，补齐 Tasks、Goal 查看器按需加载，按真实 CLI 冷暖启动与首次使用验收；不做预编译、不改安装方式，第三方扩展另行处理。

当前实现与开发方式见 [doc/current](../current/index.md)。完整设计、上游按文件处置与既有验收证据保存在 [设计与实施记录](../finished/pi-suite/design/index.md)，原设计细节保留。新增交互与启动需求及 tmux 复制的环境与验收范围已归档到 [对应专项](../finished/pi-suite/interaction-improvements/index.md)。

## 规则

- 每个待办文件应聚焦一个主题或一组强相关任务。
- 每个待办文件内都要添加任务列表，使用[ ]标记任务状态，方便记录文档进度。
- 文件名使用小写短横线，能表达主题范围。
- 待办内容应写清目标、当前状态、影响范围、约束、验收方式和相关 current 文档。
- 不在 `doc/current` 中维护活跃 TODO 列表；`doc/current` 只记录当前事实和稳定规则。
- 待办完成后，将对应文件移动到 `doc/finished/`，并把形成的稳定事实写入 `doc/current` 对应页面。

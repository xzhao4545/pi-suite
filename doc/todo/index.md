# 待办事项

本目录保存所有未完成的计划与待办。已完成的专项移到 [doc/finished](../finished/index.md)，那里的索引是归档的唯一入口，本文件不重复列出。当前实现见 [doc/current](../current/index.md)。

## 任务索引

- [Dock 显示修正](./dock-display.md) — 运行时间每秒刷新与单位显示、token 紧凑显示、Agents 行显示模型；Tasks 分区按组 ID 排序并只展开焦点组。
- [用户文档首版与审查修正](./user-docs-review.md) — README 与 docs 中英文、MIT 许可；审查发现的代码与文档修正。
- [Goal 暂停与用户轮](./goal-pause.md) — 暂停只停止自动续跑；按暂停原因决定用户消息是否恢复。
- [文本整理](./text-cleanup.md) — doc/current、模型可见文本、UI 文本与注释按统一写作标准整理。
- [Agent UX 改进](./agent-ux-improvements.md) — Runs 页恢复已结束的 agent；同一 agent 只占一行；网络或上游错误自动恢复同一 agent；wait 显示等待时长。
- [工具与通知渲染完善](./render-coverage.md) — 通知按来源折叠渲染；job 屏幕共用渲染；Transcript 使用注册的渲染器；StructuredOutput 渲染；错误折叠。

## 规则

- 每个文件聚焦一个主题或一组强相关的任务。
- 文件名用小写短横线，能看出主题范围。
- 内容写清目标、现状、影响范围、约束、验收方式和相关 current 文档。
- 每个文件末尾有任务列表，用 `[ ]`/`[x]` 标记进度。
- `doc/current` 不维护待办，只记录当前事实与稳定规则。
- 完成后把文件移到 `doc/finished/`，并把形成的稳定事实写入 `doc/current` 对应页面。

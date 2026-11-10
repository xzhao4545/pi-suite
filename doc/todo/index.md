# 待办事项

本目录是活跃待办事项的唯一维护位置。新增产品、工程、文档或验证待办时，应按主题创建或更新本目录下的对应文件。已完成专项的完整清单以 [doc/finished/index.md](../finished/index.md) 为唯一出口，本文件不重复枚举。

## 任务索引

- [Subagent 全屏、Dock 默认展开与文本精简](./viewer-and-dock-polish/index.md) — 新登记三项需求：Subagent 覆盖整个屏幕且不显示主 footer；Dock 未选择时优先展开 Tasks；精简冗余提示，包括 Tasks 选择标题的 readonly。当前仅登记，未实施。

- [工具外观、任务 Dock 与原生会话阅读接入](./ui-native-integration/index.md) — 六项待实施问题：Pi 原生工具外壳、任务恢复反馈、等宽选中、Subagent 首次末尾定位、工具点击与历史滚动条；含根因、公共框架方案、边界、任务清单及验收要求。
- [Responses 历史净化 fork](./responses-clean-fork/index.md) — 拟新增 `/responses fork`：无需选择提供商，一次性净化当前分支的私有 item 引用与加密推理，保留原会话、普通消息和工具配对；新会话后续正常请求，含生命周期、能力限制及验收要求。

Pi Suite Windows 验收见 [收尾记录](../finished/pi-suite/windows-completion.md)；Cursor CLI 验收按用户要求移除。

当前实现与开发方式见 [doc/current](../current/index.md)。完整设计、上游按文件处置与既有验收证据保存在 [设计与实施记录](../finished/pi-suite/design/index.md)，原设计细节保留。既有验收专项仅处理 Windows；手机 SSH 专项取消，Linux 由用户后续在其他设备验收，不阻塞该专项。新增交互与启动需求及 tmux 复制的环境与验收范围已归档到 [对应专项](../finished/pi-suite/interaction-improvements/index.md)。

## 规则

- 每个待办文件应聚焦一个主题或一组强相关任务。
- 每个待办文件内都要添加任务列表，使用[ ]标记任务状态，方便记录文档进度。
- 文件名使用小写短横线，能表达主题范围。
- 待办内容应写清目标、当前状态、影响范围、约束、验收方式和相关 current 文档。
- 不在 `doc/current` 中维护活跃 TODO 列表；`doc/current` 只记录当前事实和稳定规则。
- 待办完成后，将对应文件移动到 `doc/finished/`，并把形成的稳定事实写入 `doc/current` 对应页面。

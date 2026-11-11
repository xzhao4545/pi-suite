# 待办事项

本目录是活跃待办事项的唯一维护位置。新增产品、工程、文档或验证待办时，应按主题创建或更新本目录下的对应文件。已完成专项的完整清单以 [doc/finished/index.md](../finished/index.md) 为唯一出口，本文件不重复枚举。

## 任务索引

- [命令结构高亮与语法配色优化](command-highlighting.md) — 已确认方案，待实施；增强共享命令模式的执行位置、选项、变量与结构识别，优化原生语法角色配色，保留代码／日志边界、原生工具组合与缓存。
- [官方 Pi 干净消费者安装验收](official-pi-installation.md) — 用户明确延期 Git/本地包安装及资源发现验收；官方 Pi 1.5.0 的代码实施与实际 bin/RPC 加载结果不替代安装证据，保持 private:true，不执行 npm 发布。

Pi Suite Windows 验收见 [收尾记录](../finished/pi-suite/windows-completion.md)；Cursor CLI 验收按用户要求移除。

当前实现与开发方式见 [doc/current](../current/index.md)。完整设计、上游按文件处置与既有验收证据保存在 [设计与实施记录](../finished/pi-suite/design/index.md)，原设计细节保留。既有验收专项仅处理 Windows；手机 SSH 专项取消，Linux 由用户后续在其他设备验收，不阻塞该专项。新增交互与启动需求及 tmux 复制的环境与验收范围已归档到 [对应专项](../finished/pi-suite/interaction-improvements/index.md)。

## 规则

- 每个待办文件应聚焦一个主题或一组强相关任务。
- 每个待办文件内都要添加任务列表，使用[ ]标记任务状态，方便记录文档进度。
- 文件名使用小写短横线，能表达主题范围。
- 待办内容应写清目标、当前状态、影响范围、约束、验收方式和相关 current 文档。
- 不在 `doc/current` 中维护活跃 TODO 列表；`doc/current` 只记录当前事实和稳定规则。
- 待办完成后，将对应文件移动到 `doc/finished/`，并把形成的稳定事实写入 `doc/current` 对应页面。

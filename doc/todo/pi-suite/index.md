# Pi 自定义扩展包设计方案

状态：实施中；当前实现事实维护在 doc/current，各专项按验收进度归档。

目标环境：Windows、Linux；手机通过 SSH 终端使用；以最新 Pi 为目标，实现时锁定实际验证过的版本。Linux 按操作系统能力验证，不单独安排发行版专项，不安装新的发行版。

当前状态：公共界面、会话绑定、ask、目标基础能力、执行任务核心功能与两级 tasks 基础能力已实现；ask 默认答案、批量专项、目标生命周期、PTY 监督、CLI 启动、日志查看、升级控制、两级任务、子代理执行交互、模型配置、资源、@handle、定时调度、RPC、workflow 编排核心与宿主接入、类型开关与 Execution 回收、原生查看与快捷控制、workspace 持久历史发现与只读查询阶段已完成，子代理停止竞争与共享任务清单/恢复集成通过 Linux 验收，子代理进度/通知摘要与所属活动 jobs 查询、查看和单独停止已通过 Linux 验收并归档，单包架构与统一工具规范已归档；首次真实会话目录的模块准入、完整 session job 可见集与状态投影、全禁用模块的 owner 退出清理和 goal 工具错误通过 Linux 验收，询问与后台通知组合、统一 Dock 必要详情与任务显示、完整 Starship footer 发布入口及 job 历史主动清理通过 Linux 验收并归档；Windows、真实手机 SSH 与用户实际 footer 配置继续推进。tasks、jobs、agents 以上游源码按文件导入改造，所有模型工具按统一规范注册。此目录维护目标、约束、完整设计和验收计划。实现事实见 [doc/current](../../current/index.md)，完成专项记录见 [doc/finished](../../finished/index.md)。

输出预算/原始范围/续读提示、密码回显隐藏与横向 PTY 重绘、有限完成预览、实际 Pi CLI、Codex exec_command/Claude Bash/Read 的受控执行与停止、包技能通过 Linux 阶段验收；超长逻辑行的线性组装/正则资源错误与垂直/全屏支持范围已验证，Pi 原样 @ prompt、其他 CLI 与未验收工具范围、Cursor 环境及 Windows/真实手机组合保留在 jobs 专项。

影响范围：扩展入口、公共界面与运行时、ask、tasks、jobs、goal、agents，以及两个目标平台的验证与发布。

约束：复用 Pi 统一框架，保留设计细节；第一阶段完成同进程保活，跨进程保活另行评估；不添加多语言支持。

## 专项任务索引

- [x] [扩展包架构与发布](../../finished/pi-suite/architecture.md)
- [ ] [上游基线与参考来源](upstream-baseline.md)
- [ ] [上游源码导入与改造](upstream-import.md)
- [x] [统一工具设计规范](../../finished/pi-suite/tool-design.md)
- [ ] [统一面板布局](ui.md)
- [ ] [用户询问](ask/index.md)
- [ ] [两级任务管理与动态调整](tasks.md)
- [ ] [统一执行任务与保活](jobs/index.md)
- [ ] [目标状态与续跑](goal.md)
- [ ] [goal 状态栏联动与 pi-starship 兼容](goal-status.md)
- [ ] [公共状态栏摘要与活动数量](status.md)
- [ ] [子代理：查看、运行记录、主从交互与扩展能力](agents/index.md)
- [ ] [实施顺序与验收](implementation.md)

## 验收与维护

验收场景和实施依赖见 [实施顺序与验收](implementation.md)。每个专项的任务清单、影响范围、约束和验收方式维护在对应文件。完成后按项目规则归入 finished，并同步 current；此索引不把设计能力描述为已实现能力。

[返回待办总索引](../index.md)

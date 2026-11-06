# Pi 自定义扩展包设计方案

状态：设计与实施记录归档；归档不表示全部平台验收完成，未完成的 Windows 验收统一见 [Windows 待办](../../../todo/pi-suite/index.md)。

目标环境：本轮只处理 Windows；Linux 由用户后续在其他设备验收，不阻塞本轮；取消手机 SSH 专项。实际宿主版本以已验证记录为准。

当前状态：公共界面、会话绑定、ask、目标基础能力、执行任务核心功能与两级 tasks 基础能力已实现；ask 默认答案、批量专项、目标生命周期、PTY 监督、CLI 启动、日志查看、升级控制、两级任务、子代理执行交互、模型配置、资源、@handle、定时调度、RPC、workflow 编排核心与宿主接入、类型开关与 Execution 回收、原生查看与快捷控制、workspace 持久历史发现与只读查询阶段已完成，子代理停止竞争与共享任务清单/恢复集成通过 Linux 验收，子代理进度/通知摘要与所属活动 jobs 查询、查看和单独停止已通过 Linux 验收并归档，单包架构与统一工具规范已归档；首次真实会话目录的模块准入、完整 session job 可见集与状态投影、全禁用模块的 owner 退出清理和 goal 工具错误通过 Linux 验收，询问与后台通知组合、统一 Dock 必要详情与任务显示、完整 Starship footer 发布入口及 job 历史主动清理通过 Linux 验收并归档；Windows 与用户实际 footer 配置继续推进。tasks、jobs、agents 以上游源码按文件导入改造，所有模型工具按统一规范注册。此目录维护目标、约束、完整设计和验收计划。实现事实见 [doc/current](../../../current/index.md)，完成专项记录见 [doc/finished](../../index.md)。

输出预算/原始范围/续读提示、密码回显隐藏与横向 PTY 重绘、有限完成预览、实际 Pi CLI 的原样前导 `@`/附件/默认 pipe 与 fork/PTY 生命周期、Codex exec_command/Claude Bash/Read 的受控执行与停止、包技能通过 Linux 阶段验收；超长逻辑行的线性组装/正则资源错误与垂直/全屏支持范围已验证，其他 CLI 与未验收工具范围、Cursor 环境及 Windows 组合统一见 [Windows 待办](../../../todo/pi-suite/index.md)。

Windows 常驻 CIM、ConPTY 密码隐藏、OSC 轮次、共享 JSON 存储竞争、完整 158 项检查、实际 Pi CLI 的缩放/接管/模型/RPC/单次调度/workflow/日志历史入口，以及实际 Codex/Claude pipe 工具执行与清理通过，见 [Windows 阶段](../jobs/windows-runtime.md)；[同进程保活](../jobs/session-lifecycle.md) 已归档。其他原生组合、文本 PTY、业务服务和用户 footer 仍按对应专项验收。

影响范围：扩展入口、公共界面与运行时、ask、tasks、jobs、goal、agents，以及两个目标平台的验证与发布。

约束：复用 Pi 统一框架，保留设计细节；保活只覆盖同一 Pi 进程，Pi 退出终止全部受管任务与 PTY；不添加多语言支持。

## 专项设计索引

- [x] [扩展包架构与发布](../architecture.md)
- [上游基线与参考来源](upstream-baseline.md)
- [上游源码导入与改造](upstream-import.md)
- [x] [统一工具设计规范](../tool-design.md)
- [统一面板布局](ui.md)
- [用户询问](ask/index.md)
- [两级任务管理与动态调整](tasks.md)
- [统一执行任务与保活](jobs/index.md)
- [目标状态与续跑](goal.md)
- [goal 状态栏联动与 pi-starship 兼容](goal-status.md)
- [公共状态栏摘要与活动数量](status.md)
- [子代理：查看、运行记录、主从交互与扩展能力](agents/index.md)
- [实施顺序与验收](implementation.md)

## 验收与维护

原验收场景和实施依赖见 [实施顺序与验收](implementation.md)。各专项保留目标、约束、完整设计和已有结论；未完成的 Windows 验收仅在 [Windows 待办](../../../todo/pi-suite/index.md) 维护，不在设计记录内重复创建活跃任务。完成后将证据写入对应 finished 专项、稳定事实同步 current；不能将设计归档等同于验收通过。

[返回待办总索引](../../../todo/index.md)

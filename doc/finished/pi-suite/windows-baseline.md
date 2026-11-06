# Windows 上游问题与当前实现证据

2026-11-06，核对版本与发布来源见 [上游基线](design/upstream-baseline.md) 和 [来源元数据](../../../third-party/sources.json)。上游发布包能力与缺口来自固定版本源码检查；本轮未将这些原始扩展逐个装入用户环境复现。下表的运行结论来自 Windows 上当前 Pi Suite 与 Pi 1.5.0 的真实 SDK、进程或 CLI，各层证据分别列出，避免把静态推断写成上游实测。

| 来源与静态问题 | 当前 Windows 运行证据 | 适用边界 |
| --- | --- | --- |
| pi-ask-user 0.17.2：取消/超时均返回 null，面板预算与多模块协调需统一 | [原生询问组合](ask/windows-combination.md)：三种结算、最低回答行、鼠标/焦点/草稿、两个 child 与 job 的通知合并 | 实际 CLI + ConPTY；当前实现有明确 answered/timed_out/cancelled，不推断上游实例的 UI |
| pi-tasks 0.9.1：无 parentId，面板最多 10 项，仅按列宽调整 | [两级任务](tasks/windows-combination.md) 与询问组合：父子进度、blocked、折叠/筛选、三尺寸、并发更新及恢复 | 实际 CLI/child 组合；独立业务扩展的任务状态按 [RPC 阶段](agents/windows-rpc.md) 单独读取 |
| pi-interactive-shell 0.18.0：Windows 仅停止 PTY 根进程，输出缺少搜索；非 reload shutdown 清理全部任务 | [监督与输出](jobs/windows-supervision-output.md)、[CLI/清理](jobs/windows-runtime.md) 和 [同进程保活](jobs/session-lifecycle.md)：pipe/PTY 范围确认、分页/搜索、接管与会话重绑 | 实际进程/CLI 与真实 SDK；仅同一 Pi 进程保活，quit 终止受管范围 |
| pi-goal 0.54.15：agent_end aborted 直接暂停，compact 先调用 abort | [目标生命周期](goal-core.md) 的 Windows 真实 SDK 检查覆盖 retry/compact/Esc/绑定恢复；[原生询问组合](ask/windows-combination.md) 验证 waiting_user 与一次继续 | compact/retry 为真实 SDK 受控模型证据，未声称外部模型网络重试或上游原包 CLI 复现 |
| pi-subagents 0.23.0：工具结果手工文本、固定 fleet 行数、无 child UI 提问、结果不分页 | [Workflow/child 查看](agents/windows-workflow-viewer.md)、[历史与交互](agents/windows-history.md)、[模型入口](agents/windows-models.md)：原生流式组件、所属 jobs、嵌套问题、分页与只读恢复 | 实际 CLI/child/Worker；离线 Provider 控制模型回复，真实资源查询另见 [Context7](agents/windows-context7.md) |
| pi-background-jobs 0.1.3：Windows 非交互与工作区独占，运行条每任务一行 | [原生界面](ask/windows-combination.md)、[运行时](jobs/windows-runtime.md)、[监督与输出](jobs/windows-supervision-output.md)：共享摘要/预算、独立 owner、实际交互 PTY 与确认清理 | 两平台实现保留；本轮只补 Windows，Linux 后续由用户另行安排 |
| pi-starship 0.65.2：format 可缺 extension_status，max_statuses 无 goal 优先保证 | [实际 footer](jobs/windows-cli-ui.md)：原生/Starship 三尺寸并存；用户配置副本缺插槽时不显示，显式 Dock 可见 | 未改写用户配置，任意外部 footer format 不保证公共高度反馈 |

完整上游源码、路径与导入改造保留于 [上游导入](design/upstream-import.md) 和 [上游登记](../../../third-party/UPSTREAM.md)。这些记录与当前 Windows 专项共同完成问题追踪；不将完整测试通过扩大为任意第三方服务或 Cursor 预设通过。

[返回完成索引](../index.md)

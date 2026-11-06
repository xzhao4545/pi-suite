# Windows workflow 与 child 原生查看验收

日期：2026-11-06。环境：Windows、Node 24.22.2、Pi 1.5.0、zigpty 0.1.6 ConPTY，100×32。使用实际 Pi CLI、隔离 agent 目录与脚本化离线 Provider；只替换模型响应，启动、Worker、工具、Git Bash、原生 TUI、持久记录与清理均走项目实际实现。原生菜单由 ConPTY 键盘驱动，不以 SDK 直接调用菜单替代运行证据。

## Workflow

- 实际 `agent_workflow` 启动后，从 `/agents workflows` 打开超长名称运行；Children / gates 中两条相同长前缀、不同末尾的 child 仍按 index 正确选择。
- 运行详情 Pause 后状态为 paused，Resume 后恢复 running；往返时继续读取同一详情。实际 child bash 输出可从 Transcript 阅读。
- child 完成后的 gate 使用实际 Bash，分别输出 stdout 与 stderr。Children / gates 的 Gate stdout、Gate stderr 显示各自哨兵文本，返回后保留 workflow 详情。
- 对第二个活动 child 执行 Retry，进度变为 attempt 2、user-retry，第一次实际执行停止，脚本继续等待原调用。再选择该 child 执行 Skip，进度为 skipped，脚本得到 null 并 completed。
- 结束后在保持打开的详情中选择 Replay journal，创建新 workflow；第一个成功调用显示 cached，没有再次请求模型或执行 gate，第二个跳过调用重新执行。停止重放运行后状态 killed，累计 1 replayed，活动 child 全部停止。
- 独立长 gate 场景在运行详情选择 Stop；workflow killed，gate job stopped，stopReason 为 agent。Windows 清理记录为 managed_scope_confirmed、rootExited=true、taskkillExitCode=0；记录中的 shell 与后代进程结束。

原生验收发现详情动作只在打开帧时计算，运行在帧内结束时不能直接出现 Replay journal。动作使用共享 DetailsView 的动态 available 条件；Pause、Resume、Stop、Replay journal 随当前运行状态更新。复验在同一详情完成跳过、重放与停止，无需退回列表刷新。

## Child Transcript 与所属 Jobs

- 实际前台 `agent_start` 启动 child；Transcript 显示真实 bash 的持续部分输出。按 b 后该执行 background=true，原前台工具返回 backgrounded 结果，主模型继续收到 PARENT_RELEASED，child 继续运行。
- 活动详情第一次 x 显示“再按 x 停止”；其他按键解除确认。搜索中的文本不触发停止。第二次连续 x 停止目标 child，结果为 stopped、cleanup confirmed，bash 显示 Command aborted。
- 独立长 assistant 响应在生成中出现 STREAM_LINE 部分内容，完成前 child 仍 running；完成后同一 Transcript 可读最终哨兵。搜索定位第 20 行后，更多内容到达以及 Message 输入取消往返都保持该阅读位置。输入中的 x、b 只作为文字，取消后 child 继续执行。
- Transcript 的 Jobs 列表只显示该 run 创建的实际 job。Read stdout 显示其输出；单独 Stop job 后 job stopped，child 保持 running，退出 Jobs 返回 Transcript。随后两次 x 仍能停止 child。
- 正常结束 child 留有活动 PTY job；`/new` 后从 `/agents workspace all` 打开原 owner 的记录。记录菜单只有 Transcript、Jobs；Transcript 没有 Message、模型修改、Background 或 Stop subtree。
- 上述只读 Jobs 的活动 PTY 菜单提供 Details、Read output、Read input、Back，不提供 Attach terminal、Stop job 或 Clear history；Read output 显示该 job 的实际输出，阅读期间 job 保持 running。退出 Pi 后该进程树结束。

## 验证范围

类型检查和既有 workflow-host 5 项检查通过，并在已有状态切换检查内补充同帧 running → completed 的动作集合断言；没有为每个原生按键添加重复测试。其他宽度的离线渲染与公共 Transcript 身份缓存检查沿用 [查看器阶段](viewer-controls.md)。本阶段不声称外部模型、外部 MCP、其他操作系统或全部终端尺寸通过。

当前操作规则见 [Workflow 操作](../../../current/agents/workflow/operations.md) 与 [agents 操作](../../../current/agents/operations.md)。

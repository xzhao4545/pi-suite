# Windows 原生询问、界面与通知组合

## 验收范围

2026-11-06，Windows、Node 24.22.2、Pi 1.5.0、zigpty 0.1.6 ConPTY。运行实际 Pi CLI 与 pi-suite 发布入口，独立 agentDir、cwd、会话及 Git Bash 设置；离线 faux provider 只控制模型返回的工具调用，不替换 Pi 原生 TUI、询问组件、子会话、通知协调器或进程后端。终端输入使用实际键序列与 SGR 鼠标事件，读取 xterm 当前 viewport，并与原 owner 的真实会话记录交叉核对。

同一个前台目标同时保有两级任务组、两个真实 child 的父级问题、两个实际 pipe jobs 和原生 ask。主模型通过 task_edit、job_start、ask_user、agent_send、agent_read、job_read、goal_complete 运行；观察扩展通过现有 AgentManager 启动真实 child，并向真实 job 的 stdin 发送一次完成信号。没有用伪造任务记录、固定屏幕文本或 SDK UI 替身证明 CLI 行为。

## 原生界面

- 40×24、60×30、120×40 之间往返缩放，goal、agents 2、jobs 2 的共享状态摘要不重复；最高优先级的 waiting(parent) 留在 Dock，任务与其他详情由隐藏数量表示。询问草稿始终可编辑、提交或取消。
- 默认预算在 27 行保持紧凑回答，在 28 行恢复标题、回答与操作栏；footer 的本包状态行计入预算。ui.maxRows=1 时 Dock 收起，仍保留最低一条回答行；单行自由输入与选项询问均能提交。这是当前文档明确的最低回答行例外，不将 footer 自身两条基础行计入 suite 预算。
- Ctrl+H 打开历史，SGR 滚轮把阅读位置从第 1 行推进至第 4 行；Tab 将键盘焦点交给历史下方回答，编辑草稿后返回 inline，再打开历史仍保留阅读位置。草稿从原预填文本经 inline 和历史两处编辑后原样进入 answered 结果。
- SGR 滚轮在选项区把焦点从 Option 0 移到 Option 1，不提交也不修改勾选；`d` 打开该选项完整说明，滚轮推进说明位置，End 到达最后一行。关闭说明后恢复原询问，Dock 同时恢复。
- 默认勾选的 id9 在筛选结果外仍保留；说明/历史往返及三尺寸缩放后，筛选并明确选择 id1，最终只提交 id1 与 id9 对应的原始 ID 和标题。Tab、Enter 与 Esc 的焦点及提交/取消边界保持。

## 询问与通知

分别运行 answered、timed_out、cancelled 三个独立 CLI 会话；超时分支采用 11000ms 真实期限，取消使用原生 Esc，回答使用原生 Enter。

- 首个 ask 打开期间，两个真实 child 各自进入 waiting(parent)，真实 job 收到 stdin 后输出完成标记并以 exit 0 结束；主模型请求数保持 3，公共消息仍只有初始 goal 请求，后台事件未打断询问。
- 超时和取消都只返回非回答结果，不提交预填草稿；会话目标持久化 waiting=user、automatic=false。等待期间仍不消费后台问题，也不自动唤醒；新的用户输入显式恢复目标。
- 回答后的可投递边界，或非回答后用户恢复的边界，将真实 job 完成、两个 child 问题与 goal 继续请求合并成同一条公共通知。每会话全程恰为 2 条公共通知：初始 goal 与此条恢复通知。
- 同一模型回复排队两次原生 ask，第二题期限 2200ms。第一题停留超过 2600ms、阅读说明与缩放后再提交，第二题仍能正常显示并回答，证明待执行询问不提前消耗其展示期限。
- 两个 child 经 agent_send 回答后都真实完成；主模型重复 agent_read 与 job_read 消费结果，再等待观察窗口，没有新增通知或额外唤醒。每会话为 9 次主模型请求、3 次原生询问结算；回答、超时和取消各结算一次。
- 三个主分支均可通过 /quit 正常退出；另一个尚在运行的真实 job 由既有退出清理路径结束。独立最小高度会话也完成了原生提交与退出。

此验收证明 Windows 原生界面与询问通知组合；不替代其他 CLI 预设、终端监督、workflow、历史目录、外部 MCP 或业务 consumer 的专项验收。

[返回完成索引](../../index.md)

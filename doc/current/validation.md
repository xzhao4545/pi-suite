# 基线与验证

开发依赖锁定 @earendil-works/pi-coding-agent、pi-ai、pi-tui 1.5.0 和 typebox 1.3.27，使用新作用域 API。Windows 实际 CLI 为 Pi 1.5.0；Linux 使用同版本 SDK。项目要求 Node.js 24+ 和 pnpm 12.6.0。Linux 按操作系统能力验证，使用已有环境，不安排发行版专项或安装新发行版。

Linux 检查复用已有 Node.js/nvm 环境；非交互 shell 应先加载 nvm 初始化脚本，再解析 node 命令。pnpm-workspace.yaml 的 supportedArchitectures 为 Windows/Linux 保留平台可选依赖，使共享依赖目录包含 TypeScript 7 的两平台编译器。

发布包来源、tarball integrity、可用 gitHead 和仓库字段见 [来源元数据](../../third-party/sources.json)。ask 以 pi-ask-user 0.17.2 的工具契约为基线，将交互重构到公共 runtime/ui；其完整许可证保存在 [许可证](../../third-party/licenses/pi-ask-user.txt)。所有来源及更新方式见 [上游登记](../../third-party/UPSTREAM.md)。

goal 参考 @narumitw/pi-goal 0.54.15 的工具契约与控制语义，生命周期接入 Pi 1.5.0 的公共最终结算接口，许可证见 [pi-goal MIT](../../third-party/licenses/pi-goal.txt)。

## 检查

```sh
pnpm typecheck
pnpm test
```

Node 内置测试运行器使用 experimental-transform-types 加载 TypeScript。检查包括外部参数契约、混合批量最终确认、预选/推荐身份、排队及超时竞态、配置覆盖、会话撤销、通知合并、状态去重和原生消息呈现。实际 Pi SDK 通过原生工具包装器验证注册及结果；TUI 组件检查 40×24、60×30、120×40 的询问高度和可见宽度。目标检查使用 SDK 自带 faux provider，通过真实宿主核对正常继续、重试成功/耗尽、手动与阈值/溢出压缩、压缩取消、Esc、未回答询问、预算、reload、新建/恢复/fork、树切换和期限恢复；压缩摘要由公共 hook 提供。原生 footer 核对 40、60、120 列的状态行与宽度。

jobs 检查使用真实进程：pipe 的 stdout/stderr、退出码与耗时，stdin 输入与 sensitive 记录，进程树停止确认、重复停止与已结算不再停止，timeoutMs，另一 manager 只读历史，按创建归属级联停止及停止期间的启动，quit 停止与准入关闭，PTY 输入与合并输出；并通过真实宿主核对 wait 撤销通知、轮后结算恰好唤醒一次、状态计数清除、列表筛选与参数冲突、job_stop 结果和不支持的通道。同进程保活用 SDK 的 AgentSessionRuntime 与 reload 核对：job 运行中执行 new、resume、fork 与 reload，仍是原进程且日志连续，只有所属会话收到一次结果。输出读取核对小日志全量、1 MiB 与 100 MiB 日志的头尾与中段关键行截断及续读范围、中文与 emoji 分页边界、搜索上下文与匹配上限续读、无效正则，以及 PTY 回车覆写与重复行折叠。Windows 用 Git Bash 运行（测试在临时 agentDir 的 settings.json 设置 shellPath），Linux 用系统 bash。

共享 wait 用内存来源核对其他对象结算、未在 ids 中的 child 提问、等待中与等待前的用户插话、超时，以及 mode all 的部分结算不返回；真实宿主核对等待一个 job 时另一 job 结算提前返回且不再通知、用户 steer 结束等待且不停止 job。goal_wait 的 waitFor 通过真实宿主核对其他 job 结算不结束等待、恢复时合并送达，以及已结算 ID 不进入等待。终端视图在真实 PTY job 上核对用户按键接管后模型写入返回 USER_CONTROL、Ctrl+G 交还、Ctrl+T 带回含用户与模型输入结果的屏幕、Ctrl+B 离开后 job 仍在运行。monitor 用真实进程核对 literal 与阈值 trigger、同行去重、冷却、detector 丢弃与改名，poll-diff 在样本变化时触发，file-watch 不带 command 运行并在文件事件时触发；真实宿主核对 monitor 事件使等待其自身 job 的 wait 提前返回、events 通道读取，以及已返回事件不再唤醒。

以上 46 项离线检查及类型检查在 Windows（Node 24.22.2）和 Linux（已有 WSL/nvm 环境，Node 24.14.0）通过，日常检查在 5 分钟内。共享 wait 提前返回、goal_wait waitFor、终端视图与 monitor 的 11 项检查目前只在 Linux 通过，Windows 待复核。另在 Windows 执行 pi-starship 0.65.2 实际 extension_status 模块，验证 goal/runtime 槽位读取、数量上限与空状态。这些检查证明当前询问、目标、执行任务及共享组件的契约；终端缩放、/jobs 交互选择流程、真实手机 SSH 输入、完整第三方 footer 布局和后续业务模块综合生命周期由 [完整实施计划](../todo/pi-suite/implementation.md) 管理。

[返回当前文档](./index.md)

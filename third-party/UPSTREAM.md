# 上游来源

下表记录核对过的版本。npm 发布元数据、tarball integrity 和已提供的 gitHead 固定在 [sources.json](./sources.json)；没有 gitHead 或 repository 的来源保持空值，不推测其提交或仓库。

| 包 | 核对版本 | 源仓库 |
| --- | --- | --- |
| pi-ask-user | 0.17.2 | https://github.com/edlsh/pi-ask-user |
| @tintinweb/pi-tasks | 0.9.1 | https://github.com/tintinweb/pi-tasks |
| pi-interactive-shell | 0.18.0 | https://github.com/nicobailon/pi-interactive-shell |
| @narumitw/pi-goal | 0.54.15 | https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal |
| @tintinweb/pi-subagents | 0.23.0 | https://github.com/tintinweb/pi-subagents |
| pi-background-jobs | 0.1.3 | npm 发布元数据未提供仓库，以发布包为核对来源 |

## 实现来源与更新

ask_user 以 pi-ask-user 0.17.2 的参数与 response/details 契约为来源，交互在 src/ask 与共享 src/ui 中重构；保留其 [完整 MIT 许可证](./licenses/pi-ask-user.txt)。没有串联加载其独立 UI、设置或旧作用域兼容逻辑。

goal 参考 @narumitw/pi-goal 0.54.15 的目标工具契约与控制语义；src/goal 重构持久目标、运行归属和宿主最终结算，继续请求、状态与详情复用公共 runtime/ui，保留其 [完整 MIT 许可证](./licenses/pi-goal.txt)。自动限制只使用用户明确配置的预算。

jobs 导入 pi-background-jobs 0.1.3 与 pi-interactive-shell 0.18.0 的部分源文件，均保留 MIT 许可证（[pi-background-jobs](./licenses/pi-background-jobs.txt)、[pi-interactive-shell](./licenses/pi-interactive-shell.txt)），每个导入文件头注明原路径与改动：

| 本包文件 | 来源 | 改动 |
| --- | --- | --- |
| src/jobs/backends/windows-tree.ts | pi-background-jobs src/windows-process.ts | 改为作用于与后端无关的进程句柄，供 pipe 与 PTY 共用 |
| src/jobs/backends/pipe.ts | pi-background-jobs src/process.ts | stdin 保持打开供输入；POSIX 子进程为进程组组长 |
| src/jobs/manager.ts | pi-background-jobs src/jobs.ts | 增加 PTY、单一 job.json、单调耗时、输入记录、创建归属与级联停止；去掉工作区独占锁 |
| src/jobs/store.ts、runtime.ts、state.ts、types.ts、workspace.ts | pi-background-jobs 同名文件 | 目录与 ID 改为本包格式；runtime 注册键与协议改为本包 |
| src/jobs/backends/pty.ts、terminal/protocol.ts、terminal/keys.ts、terminal/shell.ts | pi-interactive-shell pty-process.ts、pty-protocol.ts、key-encoding.ts、shell-resolution.ts | 删除语义动作编码；Windows 停止接入 windows-tree |
| src/jobs/terminal/session.ts、render.ts | pi-interactive-shell pty-session.ts | 输出写入 job 日志而非内存缓冲；渲染纯函数拆出 |
| src/jobs/terminal/visible-text.ts | pi-interactive-shell output-selection-runtime.ts 的 normalizeSelectorVisibleText | 单独摘出 |
| src/jobs/monitors/compile.ts | pi-interactive-shell index.ts 的 trigger 编译、poll-diff 循环与 file-watch 命令生成 | 触发模式与 job_read search 共用语法；阈值增加 eq；删除 semantic 策略 |
| src/jobs/monitors/runtime.ts | pi-interactive-shell headless-monitor.ts 的匹配、冷却、去重与 poll-diff 摘要，index.ts 的 detector 协议 | 改为读取 job 自身日志，pipe 与 PTY 共用；detector 失败时附错误投递候选事件；删除语义挂钩与 dispatch 状态机 |
| src/jobs/monitors/hands-free.ts | pi-interactive-shell headless-monitor.ts 的静默/宽限期生命周期与 overlay-component.ts 的增量更新/预算状态机 | 由长期 JobManager 持有；实际退出才结算；接管暂停更新与静默终止；预算生成时扣除，更新走共享通知；删除语义监督 |

工具与通知不导入上游实现，按本包规范重写。其余文件尚未导入；tasks 与 agents 仍作为设计参考。按文件导入、改造与丢弃的计划见 [上游导入](../doc/todo/pi-suite/upstream-import.md)。pi-starship 0.65.2 用于外部 footer 契约参考及实际 extension_status 模块验证，不是本包依赖。导入其他模块时同步记录路径、许可证及具体重构边界。

更新时先取得指定版本的 npm 发布包，与登记的 tarball integrity 对照来源；检查工具契约及公共宿主 API 差异，局部吸收所需改动，更新 sources.json、许可证及本登记，再运行对应契约与宿主检查。来源校验用于确保版权和基线可追踪，不以构建产物哈希代替功能验证。

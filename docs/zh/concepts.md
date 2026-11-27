# 基本概念

[文档索引](index.md)

本页说明所有模块共用的规则。各模块页面引用这里，不再重复。

## 一个扩展，多个模块

Pi 只加载一个入口 `src/index.ts`。首次 `session_start` 时，它读取该会话工作目录的配置，并启用已开启的模块：ask、tasks、jobs、goal 和 agents。这些模块共用一个 Dock、一套浏览器与阅读视图、一个通知队列、一个 JSON 存储层和一个 `wait` 工具。

模块开关（`modules.*`）在 Pi 激活扩展时生效，修改后需要 `/reload`。切换到新建、恢复或 fork 的会话，或在会话树中移动，都沿用同一组模块，只重新绑定到新会话。

## 执行的生命周期

job、子代理和 workflow 在当前 Pi 进程内运行，归启动它们的会话所有。

- `/reload`、`/new`、`/resume`、`/fork` 和树导航不会停止它们，本套件只重新绑定界面和通知。
- 退出 Pi（`/quit` 或本套件的 `/exit`）会停止所有受管的 job、PTY、子代理和 workflow，并等待清理。job 共用 10 秒的停止期限，届时仍无法确认清理的 job 记为 `unconfirmed`。
- Pi 重启后仍可读取保存的记录和日志，但无法重新接管或控制旧 Pi 进程中的进程或 PTY。

## ID

| 前缀或形式 | 对象 |
| --- | --- |
| `job_3fa1c2d0` | 后台 job（`job_` 加 8 位十六进制）。 |
| `agent_…` | 子代理。恢复执行时 ID 不变。 |
| `run_…` | 子代理的一次执行。每次恢复都会产生新的 run。 |
| `wf_…` | 一次 workflow 运行。 |
| `1`、`1.2` | 任务组和子任务。任务引用还需携带清单的 `generation`，见 [Tasks](modules/tasks.md#代次)。 |
| `goalId` | 当前目标。模型会在目标上下文中收到准确的 ID。 |

## 可见范围

列表工具和浏览器提供两种范围：

- **session**（默认）：当前会话拥有、且起始位置位于当前分支上的对象。对 job 而言还包括可见子代理启动的 job；对 agent 而言是直接子代理。
- **workspace**：整个工作区的保存记录。job 的工作区是 job cwd 所在的 Git 顶层目录，不在仓库中或未安装 Git 时为 cwd 本身；agent 的工作区是会话的工作目录。

能列出不等于能控制。其他会话、其他分支或先前 Pi 进程拥有的记录可以阅读，但不能停止、恢复或写入。

## 通知

job、子代理或 workflow 结束，或子代理向父级提问时，本套件向所属会话发送一条 `pi-suite:notification` 消息。尚未投递的通知会合并为一条消息，只唤醒模型一次。

- 显示 `ask_user` 问题、浏览器或详情视图期间暂缓投递，关闭后恢复。
- 按 Esc 中断模型后，待投递的结果不再自动唤醒模型，而是随你的下一条消息送达。
- 如果 `wait`、`job_stop` 等调用先返回了某个结果，对应通知会被撤销。
- 不在当前绑定的会话的通知会保留，直到该会话再次绑定。

## `wait` 工具

`wait` 阻塞，直到 job、子代理或 workflow 结束。

| 参数 | 含义 |
| --- | --- |
| `ids` | 1–50 个带 `job_`、`agent_` 或 `wf_` 前缀的 ID。 |
| `mode` | `all`（默认）或 `any`。 |
| `timeoutMs` | 默认 300000（5 分钟），最大 3600000。 |

以下情况 `wait` 也会提前返回：其他可见对象结束、job 的监视器事件或 hands-free 更新到达、直接子代理提问、用户发送消息。`details.reason` 报告 `condition`、`question`、`event`、`other`、`user` 或 `timeout`。超时或取消只结束这次等待，从不停止对象。

## 超时各管各的

多个工具都接受毫秒超时，但控制的对象不同：

- `ask_user.timeoutMs`：用户空闲多久后自动作答。
- `wait.timeoutMs`：这一次 `wait` 调用最多阻塞多久。
- `job_start.timeoutMs`：job 的运行期限，到期后停止进程。

## 读取输出

`job_read` 和 `agent_read` 共用同一个读取器：

- `limitBytes` 默认 4096，上限 65536。
- 不带 `offset` 时，长输出按头部、类似错误的行和尾部汇总，并报告被跳过的字节范围，供你按需读取。
- `offset` 读取原始字节并返回 `nextOffset`，它总是落在 UTF-8 字符边界上，续读时使用返回值。job 仍在写入时，日志末尾可能是不完整的字符，此时 `nextOffset` 停在它之前，等其余字节到达。
- `search` 接受 JavaScript 正则表达式，可写成 `/re/flags`，或写成不区分大小写匹配的裸模式。`context` 设置前后上下文行数（默认 2）。

## 错误

工具错误以错误码开头，随后是原因和建议的下一步。全部错误码见 [模型工具](tools.md#错误码)。

## 数据存放位置

`<agentDir>` 是 Pi 的 agent 目录（默认 `~/.pi/agent`，或由 `PI_CODING_AGENT_DIR` 指定）。

| 数据 | 位置 |
| --- | --- |
| 用户配置 | `<agentDir>/pi-suite.json` |
| 项目配置 | `<会话 cwd>/.pi/pi-suite.json`（不向上级目录查找） |
| 任务 | `<cwd>/.pi/tasks/tasks-<sessionId>.json` |
| 目标 | `<agentDir>/pi-suite/goals/session-<sessionId>/state.json` |
| Job | `<agentDir>/pi-suite/jobs/<workspaceHash>/<jobId>/` |
| 定时调度 | `<agentDir>/pi-suite/agents/schedules/<sessionId>.json` |
| Workflow 运行 | `<agentDir>/pi-suite/agents/workflows/<sessionId>/<wfId>/` |

未保存到磁盘的会话只在内存中保存任务和目标。所有 JSON 文件都原子写入（先写临时文件再重命名）。配置、任务、目标、定时调度和 workflow 运行另外在跨进程锁下写入；job 元数据与 PTY 屏幕快照不加锁。损坏的文件会报错，并且不会被覆盖。

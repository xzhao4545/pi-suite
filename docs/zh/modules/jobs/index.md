# Jobs

[文档索引](../../index.md) · [CLI 预设与 PTY 监督](cli-and-hands-free.md)

jobs 模块在当前 Pi 进程的后台运行命令，并让模型读取输出、发送输入和停止它们。开关：`modules.jobs`。显示：`jobs.display`。

## pipe 与 PTY

| 模式 | 用途 | 日志 |
| --- | --- | --- |
| `pipe`（默认） | 构建、测试和批处理命令。 | 分开保存 `stdout` 和 `stderr`，另有 `input` 记录。 |
| `pty` | 交互程序、REPL、登录提示和编码 agent CLI。 | 终端 `output` 和 `input`，另保存最终屏幕。 |

两种模式都使用 Pi 自身的 Bash 选择：Pi 设置中的 `shellPath`，否则使用 Pi 的默认查找。在 Windows 上，WSL 的 `C:\Windows\System32\bash.exe` 从 stdin 读取脚本：PTY job 拒绝使用它；pipe job 可以运行，但不能接收 `job_write` 输入，也不能使用 `monitor.detector`。把 `shellPath` 设为 Git Bash 可避免这些限制。

job 按工作区归类：job cwd 所在的 Git 顶层目录；不在仓库中或未安装 Git 时为 cwd 本身。

## 工具

| 工具 | 参数 |
| --- | --- |
| `job_start` | `command` 或 `agent`（[CLI 预设](cli-and-hands-free.md#cli-预设)）、`mode?`、`name?`、`cwd?`、`timeoutMs?`（默认不限时）、`taskId?` 与 `taskGeneration?`、`attach?`、`monitor?`、`handsFree?`。立即返回 job ID。不要加 `&` 或 `nohup`。 |
| `job_list` | `state?`（默认 `active`，可选 `finished`、`all`）、`scope?`（默认 `session`，可选 `workspace`）、`cursor?`、`limit?`（默认 10，最大 100）。 |
| `job_get` | `id`、`detail?`。`detail: true` 增加完整命令、cwd、时间、归属和监督设置。 |
| `job_read` | `id`、`stream?`、`offset?`、`limitBytes?`、`search?`、`context?`。pipe 的流：`stdout`（默认）、`stderr`、`input`。PTY 的流：`output`（默认）、`input`。带监视器的 job 另有 `events`。见 [读取输出](../../concepts.md#读取输出)。 |
| `job_write` | `id`，以及 `input`、`keys`（命名按键，如 `enter`、`up`、`ctrl+c`；仅 PTY）、`paste` 三者之一。`submit` 追加回车。`sensitive` 不把正文写入输入日志。`endInput` 关闭 pipe 的 stdin。也可以不带正文，只传 `submit` 或 `endInput`。 |
| `job_stop` | `id`。返回真实结果：`requested`、`cleanup` 和 `affected`。 |

`attach: true` 用于需要你亲自操作的 PTY job，例如登录。它立即打开终端视图，并直接处于接管态，你离开视图后工具返回。从 Dock 或 `/jobs` 打开时处于浏览态。

结果以摘要行开头，例如 `job_3fa1c2d0 completed · exit 0 · 12.4s · pipe`。

## job 如何结束

只有观测到进程真实退出，job 才会结算：

| 状态 | 条件 |
| --- | --- |
| `completed` | 退出码为 0 且没有信号。 |
| `failed` | 其他退出情况，或达到 100 MiB 日志上限。 |
| `stopped` | 被 `job_stop`、用户或静默退出规则停止。 |
| `timed_out` | `timeoutMs` 到期。 |

停止结果按平台核实，范围是停止开始时捕获的进程。在 Linux 上，本套件从 `/proc` 记录进程组及其后代，核对每个 PID 的启动时间，先发 SIGTERM，250 ms 后仍有进程存活才发 SIGKILL，并检查它们全部退出。在 Windows 上，通过 CIM 记录进程树，执行 `taskkill /T /F`，并检查进程树已消失。脱离捕获范围的进程不在覆盖之内。期限（10 秒）内无法确认清理时，结果显示 `unconfirmed`；在观测到根进程退出之前，该 job 计为活动。没有这些证据，停止从不报告为成功。

Pi 重启后从历史加载的 job 没有控制句柄，停止它会返回 `HISTORY_READ_ONLY`；本套件从不向历史记录中的 PID 发送信号。

## 通知

job 结算后，其结果（附最多 2 KiB 输出预览）按 [通知](../../concepts.md#通知) 的规则向所属会话投递一次。如果 `wait` 或 `job_stop` 先返回了结果，通知会被消费。

## 监视器

`monitor` 在输出匹配时唤醒模型，免去轮询。两种模式都可用。

| 字段 | 含义 |
| --- | --- |
| `strategy` | `stream`（默认）：逐行匹配完整的输出行。`poll-diff`：每隔 `poll.intervalMs`（默认 5000，最小 250）重新执行 `command`，输出变化时匹配；第一次结果作为基线。`file-watch`：监视 `fileWatch.path`（可带 `recursive?`，以及取值为 `rename`/`change` 的 `events?`），此时不提供 `command` 或 `agent`。 |
| `triggers` | 1–20 个触发器，`id` 唯一，各自使用 `literal` 或 `regex`（`/re/flags`，或不区分大小写的裸模式）。`threshold: { captureGroup, op, value }` 用 `lt`、`lte`、`gt`、`gte` 或 `eq` 比较捕获的数值。 |
| `dedupeExactLine` | 默认 `true`：同一行只触发一次。 |
| `cooldownMs` | 同一触发器两次触发的最小间隔。触发器自身的 `cooldownMs` 优先。 |
| `detector` | `{ command, timeoutMs? }`。从 stdin 接收 JSON 格式的候选事件，输出 `true`/`false` 或 `{"emit": bool, ...}`。默认超时 3000 ms。detector 失败时，事件附带 `detectorError` 照常投递。 |

示例：开发服务器就绪或输出错误时唤醒模型。

```json
{
  "command": "pnpm dev",
  "name": "dev server",
  "monitor": {
    "triggers": [
      { "id": "ready", "literal": "Local:" },
      { "id": "error", "regex": "/error|failed/i" }
    ]
  }
}
```

事件保存在 `events` 流中。同一 job 尚未投递的事件合并为一条通知，附最新 10 条。`wait` 在监视器事件到达时提前返回，`goal_wait` 也会因此恢复。

## job 浏览器

`/jobs [finished|all] [workspace]` 打开 `Jobs ▸ List`，默认显示当前会话的全部 job，活动 job 排在前面。

| 按键 | 操作 |
| --- | --- |
| `w` | 切换范围：This session 或 Workspace。 |
| `s` | 切换状态：All 或 Finished。 |
| `/`、Tab、Esc | 筛选、进入详情、返回，见 [浏览器](../../interface.md#浏览器与阅读视图)。 |
| Enter | 打开 job 查看器。 |

job 查看器同时显示命令和实时输出。从 Dock 打开 job 时直接进入此视图。

| 按键 | 操作 |
| --- | --- |
| `c` | 展开或收起命令。 |
| `d` | 显示全部字段：完整命令、ID、cwd、归属、清理、监视器和 hands-free 设置。 |
| `s` | 切换流：stdout、stderr、input、events；PTY 为屏幕及其日志。 |
| `[` / `]` / `f` | 载入前一段或后一段 64 KiB 日志，或跳到最新输出并跟随。 |
| `i` | 接管运行中 PTY 的输入（见 [终端视图](cli-and-hands-free.md#终端视图)）。 |
| 按两次 `x` | 停止 job。 |
| 按两次 Delete | 删除已结算 job 的记录、日志和屏幕快照。仅在清理已确认且当前 Pi 进程可控制该记录时提供；只读历史不能删除。 |

离开查看器从不停止 job。查看器打开期间，job 结算通知暂缓，关闭后送达。

## 存储与上限

记录位于 `<agentDir>/pi-suite/jobs/<workspaceHash>/<jobId>/`：`job.json`、日志文件、`input.jsonl`，有监视器时另有 `events.jsonl`，PTY 的最终屏幕保存在 `terminal.json`。最终屏幕尽力保存，上限为 1000 行回滚与 4 MiB；保存失败时日志仍可读取。sensitive 输入只记录时间、来源和字节数。单个 job 的日志上限为 100 MiB；工作区历史达到 1 GiB 后以 `WORKSPACE_CAPACITY` 拒绝新 job。

## 错误

除 [通用错误码](../../tools.md#错误码) 外：同一 Pi 进程中先前加载的不兼容套件版本仍持有运行中的 job 时返回 `RUNTIME_UNAVAILABLE`（历史、日志和停止仍可用；这些 job 结束后执行 `/reload` 即可替换）；用户已接管 PTY 时返回 `USER_CONTROL`；搜索正则耗尽引擎资源时返回 `REGEX_RESOURCE_LIMIT`。

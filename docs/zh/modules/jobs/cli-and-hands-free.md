# CLI 预设与 PTY 监督

[Jobs](index.md) · [文档索引](../../index.md)

## CLI 预设

`job_start` 可以用 `agent` 代替 `command`，以原文任务提示启动编码 agent CLI：

| `agent` 字段 | 含义 |
| --- | --- |
| `preset` | `jobs.agents` 中的键：以小写字母开头，其后为小写字母、数字或 `-`，最长 64 个字符。 |
| `prompt` | 任务，1–16000 个字符，原样传递；空格、换行、引号、`$` 和反引号都会保留。 |
| `fork` | 仅 `pi`。以 `--fork <当前会话文件>` 启动，要求当前会话已保存。 |

内置预设：

| 预设 | 命令 | 默认参数 |
| --- | --- | --- |
| `pi` | `pi` | 无 |
| `codex` | `codex` | 无 |
| `claude` | `claude` | 无 |
| `cursor` | `agent` | `--model composer-2-fast` |

本套件不会安装这些 CLI。命令不存在时，表现为 job 的真实退出结果。

提示作为 `--` 之后的单个位置参数传入，因此以 `--` 开头的提示仍被当作文本。对 `pi` 预设，以 `@` 开头的提示通过专用参数传递，避免 Pi 把它当作文件附件。

使用默认的 `pipe` 模式时，`pi` 预设在启动后关闭 stdin，让 Pi 执行任务后退出。需要继续与 CLI 交互时使用 `mode: "pty"`。配置为 RPC 模式的 `pi` 预设会被拒绝，因为 RPC 模式不执行初始提示。

### 自定义预设

`jobs.agents` 在内置、用户和项目三层之间按预设、按字段合并。`command` 是一个可执行文件名或路径，不是 shell 命令行。`args` 是数组，整体替换前一层的数组。

```json
{
  "jobs": {
    "agents": {
      "claude": { "args": ["--model", "sonnet"] },
      "local": { "command": "local-cli", "args": ["--verbose"] }
    }
  }
}
```

新增的预设必须有 `command`。修改后执行 `/reload` 生效。

## Hands-free 监督

`handsFree` 让模型通过定期更新监督 PTY 程序，而不必反复读取日志。它要求 `mode: "pty"`，可以与 `monitor` 同时使用。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `mode` | `hands-free` | `hands-free` 发送进度更新；`dispatch` 只发送最终结果。 |
| `updateMode` | `onQuiet` | `onQuiet` 在程序静默后发送新输出；`interval` 按固定周期发送。 |
| `quietMs` | 8000 | 视为静默的时长。可见输出和模型输入会重新计时。 |
| `updateIntervalMs` | 60000 | `interval` 的周期，或 `onQuiet` 在输出持续不断时的最长间隔。 |
| `autoExitOnQuiet` | hands-free 为 `false`，dispatch 为 `true` | 宽限期过后程序静默时停止程序。 |
| `graceMs` | 15000 | 启动后多久才允许静默停止，`0` 表示没有宽限期。 |
| `updateMaxChars` | 1500 | 每次更新的输出字符数，1–65536。 |
| `maxTotalChars` | 100000 | 所有更新的输出字符预算，0–1000000。用完后更新只包含状态。 |

一次性委派给另一个 agent CLI：

```json
{
  "agent": { "preset": "pi", "prompt": "阅读 PLAN.md 中的计划并继续实现", "fork": true },
  "mode": "pty",
  "handsFree": { "mode": "dispatch" }
}
```

输出静默不代表程序成功。以这种方式停止的 job 结算为 `stopped`，且 `completionReason: "quiet"`。更新以通知送达；`wait` 会因更新提前返回，`goal_wait` 也会因此恢复。`job_start.timeoutMs` 仍限制总运行时间。

## 终端视图

终端视图显示 PTY 的实时屏幕，包括颜色、光标和回滚历史。可通过 `attach: true`、Dock 或 `/jobs` 打开。从 Dock 或 `/jobs` 打开时以浏览态开始，浏览态从不向程序发送按键；`attach: true` 打开时直接处于接管态。

| 按键 | 状态 | 操作 |
| --- | --- | --- |
| ↑ / ↓、PageUp / PageDown、Home / End、滚轮 | 浏览 | 滚动回滚历史。End 或 `f` 跟随新输出。 |
| `i` | 浏览 | 接管输入。 |
| 任意按键 | 接管 | 原样发送给程序。 |
| Ctrl+G（`jobs.returnKey`） | 接管 | 把输入交还模型，留在视图中。 |
| Ctrl+T（`jobs.transferKey`） | 接管 | 离开视图，并把当前屏幕发送给模型。 |
| Ctrl+]（`jobs.detachKey`） | 任意 | 离开视图，job 继续运行。 |
| Shift+↑ / ↓ | 接管 | 滚动回滚历史。 |
| 按两次 `x` | 浏览 | 停止 job。 |
| Esc，或 ← ← | 浏览 | 返回，或关闭整条浏览链。 |

你接管输入期间，模型写入返回 `USER_CONTROL`，hands-free 更新和静默停止暂停。离开视图总会把控制权交还模型。你输入的按键按 `sensitive` 方式记录：只记录时间、来源和字节数。

PTY job 结束时，会保存最终屏幕和最多 1000 行回滚历史，因此 Pi 重启后仍可查看屏幕。没有保存屏幕的记录显示 `Logs only`。

对 PTY 执行 `job_read` 返回可见文本：回车覆写和行内编辑已应用，密码回显被遮盖，但全屏布局不会还原为二维画面。`offset` 仍指原始日志字节。

## 已验证的 CLI

Linux 上已检查 Pi 1.5.0、Codex 0.166.0 和 Claude Code 2.1.153 的 PTY 文本交互；Windows 上已检查 Pi 1.5.0、Codex 0.162.1 和 Claude Code 2.1.301。`cursor` 预设尚未用真实 CLI 检查。

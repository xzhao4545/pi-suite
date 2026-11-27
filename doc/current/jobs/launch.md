# CLI 预设与直接启动

job_start 的 agent 参数用结构化配置代替 command，启动 pi、codex、claude 等 CLI 并传入初始任务。预设解析与命令构造位于 `src/jobs/launch`；生成的命令进入同一个 JobManager，输入、日志、退出、停止与通知与普通 job 相同。

## 预设与请求

| agent 字段 | 行为 |
| --- | --- |
| preset | jobs.agents 中的键：小写字母开头，可含小写字母、数字和短横线，最长 64 字符；未知键返回 INVALID_ARGS 并列出已配置的键 |
| prompt | 1–16000 字符、非空白的任务原文，空格、换行、中文、引号、`$` 和反引号原样保留。通常作为一个位置参数传入；pi 预设下以 `@` 开头的 prompt 走 [Pi 原文桥](#pi-原文桥) |
| fork | 默认 false。仅 pi 预设可用，以 `--fork <当前会话文件>` 启动；其他预设返回 INVALID_ARGS；当前会话没有持久文件时返回 INVALID_ARGS |

内置预设：

| 键 | command | 默认 args |
| --- | --- | --- |
| pi | pi | 无 |
| codex | codex | 无 |
| claude | claude | 无 |
| cursor | agent | `--model composer-2-fast` |

本包不安装 CLI，执行文件和默认参数按已安装版本配置。命令不存在时按实际进程退出结果记录，不换用其他程序。

jobs.agents 按内置、用户、项目的顺序逐键、逐字段合并：

- command 是一个可执行文件路径或名称（≤4096 字符），整体作为一个参数转义，不能写整段 shell 命令；需要直接执行 shell 代码时用 job_start.command。
- args 是默认参数数组（≤100 项，每项 ≤4096 字符），整体覆盖，不与低优先级的 args 拼接；省略时为空数组。
- 新增的键合并后必须有 command，否则配置加载报错 `jobs.agents.<键> needs command`。

命令构造规则：

1. 全部参数按 Bash 单引号规则转义（Windows 上同样使用 Git Bash）。
2. args 中没有 `--` 时，在 prompt 前追加 `--`，以 `--` 开头的 prompt 仍作为数据；自定义 CLI 需要支持这一位置参数约定。
3. fork 的 `--fork <文件>` 插入在 args 中第一个实际的 `--` 之前，没有时追加在末尾。
4. pi 预设的 args 指定 RPC 模式时，启动前返回 INVALID_ARGS：Pi RPC 模式不执行初始 CLI prompt，RPC 客户端应使用消息协议。

command 与 agent 互斥；file-watch monitor 自行生成命令，不能与 command 或 agent 合用。mode 默认 pipe；需要交互终端的 CLI 用 mode=pty，监督参数见 [PTY 监督与委派](hands-free.md)。

pi 预设在默认 pipe 模式下，启动后立即关闭 stdin：Pi 收到 EOF 后执行初始任务并自然退出。需要后续输入时用 mode=pty，PTY 保持交互输入。

```json
{"agent":{"preset":"pi","prompt":"阅读项目计划并继续实现","fork":true},"mode":"pty","handsFree":{"mode":"dispatch"}}
```

## Pi 原文桥

Pi 1.5.0 把以 `@` 开头的位置参数解析为文件附件，即使它位于 `--` 之后。pi 预设的 prompt 以 `@` 开头时，本包用原文桥传递正文；调用方仍直接填写 agent.prompt，不需要加前缀或转义。预设 args 中已有的 `@file` 附件和图片保持 Pi 原生语义；不以 `@` 开头的 prompt 使用普通位置参数。

构造方式（`launch/presets.ts` 的 `agentCommand`）：

1. 在 args 中第一个实际的 `-e`、`--extension` 或 `--` 之前（没有时在末尾）插入 `-e <本包 src/index.ts>` 和 `--suite-prompt=<原文>`。
2. 没有 `--` 时追加 `--`，再追加触发文本 `pi-suite:cli-prompt` 作为唯一的位置参数。
3. 判断"实际选项位置"时调用 Pi 公共 `parseArgs`，以区分选项和其他选项的字面值（例如 `--system-prompt '-e'`），并保留 `node cli.js` 形式的包装前缀。显式加载的入口与自动发现的同一扩展由 Pi 规范化去重；使用 `--no-extensions` 时显式入口仍会加载。

接收方式（`src/runtime/cli-prompt.ts`）：

1. 入口最先注册 string flag `suite-prompt` 和 input 钩子。
2. 只在 session_start 原因为 startup 时保存待用正文；CLI `--fork` 启动的新进程也是 startup，正常使用正文。
3. 初始输入以触发文本结尾时，把触发文本替换为原文，保留其前面的附件文本与图片。正文只使用一次，reload、new 和 UI fork 不会重放。
4. 替换后的正文继续经过 Pi 的普通 input 处理：TUI 中启用 @handle 时，已知类型/handle 按提及分派，路径与未知 handle 原样保留；print/JSON 模式的提及处理照常放行。

## 实际 CLI 支持范围

| 环境 | CLI 与版本 | 结论 |
| --- | --- | --- |
| Linux | Pi 1.5.0 | print、JSON、默认 pipe、fork 与 PTY 组合下，前导 `@` 的复杂正文逐字进入模型，同名文件存在也不读取；原生附件与 JSON 事件保留；reload/new 不重放。见 [原文初始任务阶段](../../finished/pi-suite/jobs/literal-prompt.md) |
| Linux | Pi 1.5.0、Codex 0.166.0、Claude Code 2.1.153 | PTY 文本交互：初始 prompt 逐字传入，用户接管期间模型写入返回 USER_CONTROL，交还后可继续，停止得到 managed_scope_confirmed。见 [实际文本 PTY 阶段](../../finished/pi-suite/jobs/cli-pty.md) |
| Linux | Codex、Claude Code | 工具执行：CLI 实际执行命令并回传结果，自然退出；另起进程组的长任务被停止确认，其他 job 不受影响。见 [工具执行阶段](../../finished/pi-suite/jobs/cli-tools.md)，屏幕与日志的读取范围见 [屏幕范围](../../finished/pi-suite/jobs/screen-range.md) |
| Windows | Pi 1.5.0 | PTY 与默认 pipe：前导 `@` 正文、reload/new 不重放、自然 `/quit`、print/JSON、文本/PNG 附件与 CLI fork。见 [Windows Pi 预设契约](../../finished/pi-suite/jobs/windows-pi-presets.md) |
| Windows | Codex 0.162.1、Claude Code 2.1.301 | 复杂初始正文、用户输入、交还模型输入、TUI 回复与进程树停止确认。见 [Windows CLI 阶段](../../finished/pi-suite/jobs/windows-cli-ui.md) |
| 全部 | Cursor（`agent` 命令） | 只验证了参数构造，未用实际 CLI 验收，见 [Windows 收尾记录](../../finished/pi-suite/windows-completion.md) |

Codex/Claude 验收使用隔离配置和本地受控服务，这些参数不改变内置预设的默认值。

## 启动行为

job_start 在参数与任务引用检查通过后直接启动，与 Pi 内置命令一致。普通 command、CLI 预设、monitor 生成的命令与 detector 命令都使用同一个 JobManager；TUI、print/JSON 与 RPC 中不带 attach 的启动规则相同。`attach: true` 需要 PTY 与交互终端。

CLI 预设可以在用户和项目配置中逐字段覆盖，修改后执行 /reload 或重新绑定会话生效：

```json
{
  "jobs": {
    "agents": { "local": { "command": "local-cli", "args": ["--verbose"] } }
  }
}
```

[返回执行任务](index.md)

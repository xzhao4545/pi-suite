# CLI 预设与启动授权

job_start 的 agent 用结构化配置代替 command。预设解析与参数构造位于 src/jobs/launch，启动仍进入同一 JobManager，输入、日志、退出、停止与通知使用现有 job 接口。

## 预设与请求

| agent 字段 | 行为 |
| --- | --- |
| preset | jobs.agents 的键；小写字母开头，支持小写字母、数字和短横线，最长 64 字符 |
| prompt | 1–16000 字符的非空任务；保留原文中的空格、换行、中文、引号、美元符号和反引号；通常作为一个位置参数传入，pi 前导 `@` 使用下述原生输入桥 |
| fork | 默认 false；true 仅用于 pi，以 `--fork <当前会话文件>` 启动；当前会话没有持久文件时报 INVALID_ARGS |

默认预设：pi→pi、codex→codex、claude→claude、cursor→agent；前三者默认参数为空，cursor 默认参数为 `--model composer-2-fast`。工具不安装 CLI，执行文件和默认参数可按已安装版本配置。缺失命令按实际进程退出结果记录，不换用其他程序。

jobs.agents 按内置、用户、项目顺序，逐键、逐字段合并。每项 command 为一个可执行文件路径或名称，args 为默认参数数组；新键必须在合并后具有 command，args 默认空数组。command 不能包含整段 shell 命令，需要直接执行 shell 代码时使用 job_start.command。参数数组整体覆盖；不会把项目 args 与用户 args 拼接。

所有参数按 Pi 使用的 Bash 规则转义；prompt 前添加 `--` 结束选项解析，prompt 以 `--` 开头时仍作为数据。自定义 CLI 应支持这一位置参数约定。command 与 agent 互斥；file-watch 自行生成命令，不能提供 command 或 agent。mode 仍默认 pipe；需要交互终端的 CLI 用 mode=pty，监督参数见 [hands-free 与 dispatch](hands-free.md)。

Pi 预设支持以 `@` 开头的原文任务，调用方仍直接填写 agent.prompt，无需添加前缀或转义。Pi 1.5.0 会把前导 `@` 位置参数解析为附件，即使位于 `--` 之后；本包通过原生输入桥传递正文，预设中已有的 `@file` 附件及图片保持 Pi 原生语义。正常文本中的 `@` 与以 `--` 开头的文本沿用位置参数约定。

前导 `@` 命令显式加载本包规范入口，并用单个 `--suite-prompt=<原文>` 参数承载正文，位置参数只传启动触发文本。src/runtime/cli-prompt.ts 在入口最先注册原生 string flag 和 input transform；仅 startup 保存待消费正文，在原生初始输入中替换触发后缀，保留之前的附件文本与图片。正文消费一次，reload/new/UI fork 不重放；CLI --fork 的新启动正常消费。恢复后的正文继续走普通 input 处理：启用 @handle 时，TUI 已知类型/handle 沿用提及分派，路径与未知 handle 透传；print/JSON 的提及处理继续放行，不强制绕过共享输入链。预设复用 Pi 公共 parseArgs 判断实际选项边界，区分 `-e`/`--` 选项与其他选项的字面值，并保留 `node cli.js` 包装前缀；显式入口与自动发现由 Pi 规范化去重。生成后的完整命令仍交给现有 launchPolicy 授权。

Pi agent 请求使用默认 pipe 时，在启动后通过现有 closeInput 关闭 stdin，让 Pi 收到 EOF 后执行初始任务并自然退出；需要后续输入时指定 mode=pty，PTY 保持交互输入。Pi RPC 模式不执行初始 CLI prompt，pi 预设配置为 RPC 时在启动前返回 INVALID_ARGS；RPC 客户端应使用相应消息协议。

```json
{"agent":{"preset":"pi","prompt":"阅读项目计划并继续实现","fork":true},"mode":"pty","handsFree":{"mode":"dispatch"}}
```

## 实际 CLI 支持范围

Pi 原文桥在 Linux 实际 Pi 1.5.0 通过 print、JSON、默认 pipe、fork 与 PTY 组合验收：前导 `@` 复杂正文逐字进入模型，同名文件存在也不读取；原生附件与 JSON 事件保留；fork 创建新会话且源上下文/文件字节不变。实际 job_start 默认 pipe 与精确 allow、PTY 后续用户/模型输入、reload/new 不重放与自然 quit 均通过，范围见 [原文初始任务阶段](../../finished/pi-suite/jobs/literal-prompt.md)。

Linux 上的 Pi 1.5.0、Codex 0.166.0 与 Claude Code 2.1.153 已通过实际 CLI 的 PTY 文本交互检查。三者均使用现有预设合并、命令构造与 JobManager；初始位置 prompt 保留以 `--` 开头的中文、引号、美元表达式、反引号和换行。用户接管期间模型写入返回 USER_CONTROL，交还后可继续模型输入，停止取得 managed_scope_confirmed 清理证据。

Windows 上的 Pi 1.5.0 实际 PTY 验收前导 `@` 复杂正文、`/reload` 保留原 session 且不重放、`/new` 创建新 session 且不重放、后续输入归属和自然 `/quit`。同版本另通过实际 job_start 默认 pipe、print/JSON、选项值与结束标记、普通复杂正文、文本/PNG 附件和 CLI fork：新会话身份及 parentSession 正确，源上下文保留且源文件字节不变，见 [Windows Pi 预设契约](../../finished/pi-suite/jobs/windows-pi-presets.md)。Windows Codex 0.162.1 与 Claude Code 2.1.301 通过隔离配置和本地受控 SSE 验收复杂初始正文、用户输入、模型交还输入、TUI 回复及受管进程树停止确认。平台和交互组合细节见 [Windows CLI 阶段](../../finished/pi-suite/jobs/windows-cli-ui.md)。

Codex 使用隔离配置、本地 Responses SSE 服务和 `--no-daemon`；Claude 使用 `--bare`、空 settings/MCP/tools、本地服务和测试密钥，并在 PTY 完成首次密钥确认。上述参数是隔离验收配置，不改变内置预设默认值。初始文本、用户输入与交还后的模型输入均逐字进入 CLI 主对话 HTTP 请求，CLI 显示对应 SSE 回复；任务标题与会话辅助请求不作为主对话正文的证据。该范围仅覆盖文本交互，不包含 CLI 工具执行、付费模型、Windows；Cursor 对应的 `agent` 命令尚缺环境。文本验收结论见 [实际文本 PTY 阶段](../../finished/pi-suite/jobs/cli-pty.md)；Cursor 预设的实际 CLI 验收不在本轮范围，见 [Windows 收尾记录](../../finished/pi-suite/windows-completion.md)。

Linux 工具执行另通过本地受控服务验收：Codex 实际 exec_command 创建文件并回传输出/退出码，Ctrl+D 后自然退出；长工具另起进程组时，由现有 Linux 后端捕获身份并确认停止，另一独立 job 保持运行。该环境的 workspace-write 被 bwrap 权限限制阻断，成功执行使用隔离临时 danger-full-access 配置。Claude bare 模式显式开放 Bash/Read，默认权限界面只确认本次临时命令，真实文件与 tool_result 一致，`/exit` 自然退出，再次 stop 不改写结果。当前屏幕与线性日志各按 [屏幕范围](../../finished/pi-suite/jobs/screen-range.md) 读取；本结论仅覆盖上述工具和 Linux，完整范围见 [工具执行阶段](../../finished/pi-suite/jobs/cli-tools.md)。

## 启动策略

jobs.launchPolicy 只允许写入用户文件 `<getAgentDir()>/pi-suite.json`；项目 `.pi/pi-suite.json` 出现该字段即报错，包括空数组。配置在会话绑定时读取，修改后使用 /reload 或重新绑定会话生效。

```json
{
  "jobs": {
    "agents": { "local": { "command": "local-cli", "args": ["--verbose"] } },
    "launchPolicy": [
      { "command": "echo allowed", "decision": "allow" },
      { "command": "echo denied", "decision": "deny" }
    ]
  }
}
```

每条规则含 command 与 decision（allow/ask/deny），按最终完整命令字符串精确匹配。没有规则或未命中时默认 ask；不裁剪空白，不解析 shell，不支持通配符或仅按可执行文件匹配。同一命令多条规则按 deny > ask > allow 决定。规则最多 1000 条，command 最长 32768 字符。

策略用于全部 job_start：原始 command、拼装后的 CLI 命令、poll-diff 循环和生成的 file-watch 命令。detector.command 作为另一个待执行命令，在 job 启动前单独授权；两者都允许后才分配 job ID、创建日志并启动进程。调用的临时授权回调不留在长期 manager 中。

allow 直接启动；deny 返回 LAUNCH_DENIED；ask 复用共享 ask 队列，显示精确命令与 cwd，明确确认后只启动本次。超时、取消或绑定撤销返回未确认并结束本轮，不创建进程或历史；非交互模式的 ask 返回 LAUNCH_CONFIRMATION_REQUIRED，需配置精确 allow 规则。完整按键见 [执行任务操作](index.md#用户操作)。

[返回执行任务](index.md)

# Windows Pi CLI 预设契约

Windows Node 24.22.2、Pi 1.5.0 使用实际 CLI 发布入口、Git Bash 与现有 JobManager 验收。每个子进程使用独立 agentDir、显式离线 provider 和隔离会话目录；provider 在实际 CLI 内捕获模型上下文，不读取用户凭据、不请求外部模型。此专项补齐 [Windows CLI 阶段](windows-cli-ui.md) 的预设、附件与非交互剩余范围，已有 PTY 接管、reload/new 与退出证据直接复用。

## 实际参数与输出

- 通过真实 SDK 父会话调用 job_start，仅提供 agent，不传 mode；按最终完整命令命中 allow 规则。job 采用 pipe，stdin 由现有 Pi 预设逻辑关闭，实际 CLI 恰好执行一轮并自然退出 0，stdout 只包含最终回复。
- 默认参数中 `--system-prompt -e` 与 `--append-system-prompt --` 保留字面选项值，模型 system sections 分别得到 `-e` 和 `--`。正文以 `--mode=rpc` 开头，仍完整成为模型 user 文本，没有进入 RPC。
- 预设已有真实 `--` 时不重复解释后续参数：其后的 `--mode=rpc` 按位置文本执行第一轮，随后追加的复杂正文执行第二轮，模型上下文保留两个 user 文本。
- 显式 `--print` 的普通正文包含中文、正文内 `@`、引号、反斜杠、换行、美元表达式、反引号及命令替换字面量，逐字进入模型且仅执行一轮；未创建注入哨兵文件。
- JSON 模式保留原生文本附件与 PNG 附件。文本文件内容出现在最终 user 文本中，选项形状正文保持原文；provider 收到的 PNG MIME 与解码字节和输入一致。stdout 每行均为有效 JSON，只有一个 agent_start，message_end 的 user 内容与 provider 收到的文本、图片完全一致，包含正常 turn/agent 结束事件。
- 前导 `@` 原文桥与相同文本/PNG 附件、上述选项值及已有 `--` 同时运行；附件内容保留，原文正文作为文本后缀恢复一次，PNG 字节保持一致，CLI 自然退出 0。

这些进程均正常结束，job cleanup 为 not_required；该状态表示自然退出无需停止清理，不替代受管进程树 stop 的专项证据。

## Fork 会话身份

源会话由实际 CLI 创建，完成包含哨兵正文和回复的一轮后自然退出。随后通过现有 agentCommand 的 fork 请求，将 `--fork <源文件>` 插入真实选项结束位置前，以前导 `@` 复杂正文启动实际 CLI。

fork 恰好调用模型一次，上下文保留源 user 和 assistant，并追加完整的新正文。新文件 session header ID 与源 ID 不同，header.parentSession 指向源文件，provider 运行时 session ID 与新 header 一致；fork 前后源 JSONL 的 SHA-256 完全相同。源 CLI 先退出，避免把父会话自身的异步 job 通知误判成 fork 写入。

本专项无需修改实现。验收覆盖 Windows Pi 1.5.0 的预设参数边界、普通正文、原生文本/图片附件、默认 pipe、print、JSON 与 CLI fork；其他版本、外部模型服务以及 Cursor 不由此结论推断。

[返回完成索引](../../index.md)

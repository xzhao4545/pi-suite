# Windows CLI 文本 PTY 与原生 footer 阶段

Windows Node 24.22.2 使用实际 Codex 0.162.1、Claude Code 2.1.301、Pi 1.5.0 与现有 JobManager/ConPTY 验收。Codex 和 Claude 由隔离配置连接本机受控 SSE 服务，不使用真实凭据或付费模型；复杂初始正文含中文、换行、引号、美元表达式、反引号及命令替换字面量。

两种 CLI 的初始正文、用户接管输入和 Ctrl+G 交还后的模型输入均逐字到达主对话请求，实际 TUI 显示 SSE 回复。userControlled 期间模型写入返回 USER_CONTROL；停止记录 managed_scope_confirmed，独立 CIM 查询确认范围中的全部进程已退出。Codex 可能另外发送任务标题生成请求，正文与输入验收按真实 Responses 对话消息区分，不将标题辅助请求混作主对话。

Pi 1.5.0 使用独立 agentDir 和离线 provider。实际 PTY 中前导 `@` 复杂初始正文逐字进入首个模型请求且不执行 shell 字面量；`/reload` 保留 session ID、不重放正文，后续用户输入进入原上下文；`/new` 创建新 session ID、不重放正文，后续输入只包含新会话内容；`/quit` 自然退出码为 0。已有实际 Pi attach、尺寸缩放及接管/交还证据见 [Windows 运行时阶段](windows-runtime.md)。默认 pipe、print/JSON、附件、fork 和完整预设参数的 Windows 组合仍待验收。

## Footer 与多模块界面

完整 `@narumitw/pi-starship` 0.65.2 发布入口、Pi 原生 footer 与 pi-suite 原生扩展在实际 CLI 中同时运行。隔离的有效 `extension_status` format 下，40×24、60×30、120×40 均显示 goal/task/agent/job 状态；数量摘要去重，询问打开时活动计数仍可见且询问草稿可提交或取消。压缩摘要按终端宽度换行，不越过宽度。

以用户当前 pi-starship.toml 的原样副本验证：根 format 不含 `$extension_status`，因此 footer 不显示 goal/agent/job 数量；goal.display=dock 时数量改由原生 Dock 显示，hidden 时常驻状态隐藏。用户原配置的部分模块字段触发 pi-starship 0.65.2 设置校验警告；验收未改动用户配置。该警告与缺少 format 插槽是两项独立的外部配置边界。

此阶段没有核对鼠标焦点、历史/详情往返、缩放期间询问草稿保持、实际终端输出浏览或用户配置修正。剩余组合与范围见 [Windows 待办](../../../todo/pi-suite/index.md)。

[返回完成索引](../../index.md)

# 设置与退出操作

`/suite` 使用 Pi 原生 SettingsList，输入文字搜索字段，方向键选择，Enter 编辑，Esc 返回。入口按配置 schema 提供 commands、modules、ui、ask、goal、tasks、agents 和 jobs 的全部字段；每项展示有效值、默认值、用户值、项目值及来源。模块和命令显示当前激活值，用于区分已保存设置与运行状态。

选择字段后可编辑用户层、项目层，或恢复指定层的继承。默认选择已有项目覆盖，否则选择用户层；上层覆盖存在时修改用户值仍展示实际有效值。布尔和枚举使用选择器，整数、文本和快捷键使用输入框，包白名单、CLI 预设与 Types 覆盖可按字段编辑 JSON；`agents.types` 另提供原生类型模型/思考强度入口。

保存复用 config-fields、严格 schema 和 JsonStore 的锁内重读/原子写入，只编辑目标字段，保留其他设置；错误配置与 I/O 失败明确报错，不覆盖损坏文件。恢复继承删除指定层字段并清理空对象。类型菜单的 Use definition 同时清除两层启用覆盖。

通用字段保存后 `/reload` 应用；保存不重新绑定会话或停止现有执行。Types 菜单保存后按其现有规则立即刷新新调用的类型设置、补全和 workflow 描述，已准入 run 保持自身契约。非 TUI 的 `/suite` 显示有效配置。

`ui.highlightBuiltinCommands` 为严格布尔字段，默认 true，按默认值 → 用户层 → 项目层逐字段继承。`/suite` 展示该项的来源、默认值、用户值、项目值、有效值与保存后的 reload 提示。它只控制内置模型 `bash` / `powershell` 调用区的语法高亮：false 完整保留原生调用显示，不改变执行、结果、外壳、计时或超时；Jobs 顶部与 Suite 展开的 command 字段始终高亮，用户 `!` / `!!` 不受影响。保存不会修改当前 renderer 的选项快照，`/reload` 应用新值；childSuite 传入 `run.config.ui.highlightBuiltinCommands`，使用准入时配置目录的快照，不读取 child 执行目录的覆盖。历史与 child 的显示定义通过统一 renderer 登记/lookup 复用。

`commands.exit` 默认 true，独立于业务模块开关。`/exit` 在忙碌时通过公开 abort 与 waitForIdle 等待当前操作取消，再请求宿主 shutdown；随后由原生 quit 流程恢复终端、触发 session_shutdown 并等待 jobs/agents/workflow owner 清理。设置 false 后 `/reload` 撤销本扩展的 `/exit` 注册；原生 `/quit` 始终可用。

## 历史净化命令

`/responses fork` 无需选择提供商，一次性净化当前有效历史并进入独立副本，沿用当前模型/thinking；要求 idle 且没有排队消息。新会话等待用户输入，不自动请求模型；active goal 的副本为 paused，原目标及外部执行保持原归属。取消不创建副本，无法安全迁移的密文内容明确拒绝。宿主版本、正常后续请求与账号/文件限制见 [Responses 历史净化 fork](responses-fork.md)。

[返回公共运行时](index.md)

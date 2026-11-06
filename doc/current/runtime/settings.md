# 设置与退出操作

`/suite` 使用 Pi 原生 SettingsList，输入文字搜索字段，方向键选择，Enter 编辑，Esc 返回。入口按配置 schema 提供 commands、modules、ui、ask、goal、tasks、agents 和 jobs 的全部字段；每项展示有效值、默认值、用户值、项目值及来源。模块和命令显示当前激活值，用于区分已保存设置与运行状态。

选择字段后可编辑用户层、项目层，或恢复指定层的继承。默认选择已有项目覆盖，否则选择用户层；上层覆盖存在时修改用户值仍展示实际有效值。`jobs.launchPolicy` 只提供用户层操作。布尔和枚举使用选择器，整数、文本和快捷键使用输入框，包白名单、CLI 预设、启动策略与 Types 覆盖可按字段编辑 JSON；`agents.types` 另提供原生类型模型/思考强度入口。

保存复用 config-fields、严格 schema 和 JsonStore 的锁内重读/原子写入，只编辑目标字段，保留其他设置；错误配置与 I/O 失败明确报错，不覆盖损坏文件。恢复继承删除指定层字段并清理空对象。类型菜单的 Use definition 同时清除两层启用覆盖。

通用字段保存后 `/reload` 应用；保存不重新绑定会话或停止现有执行。Types 菜单保存后按其现有规则立即刷新新调用的类型设置、补全和 workflow 描述，已准入 run 保持自身契约。非 TUI 的 `/suite` 显示有效配置，其中启动策略展示用户保存的数组。

`commands.exit` 默认 true，独立于业务模块开关。`/exit` 在忙碌时通过公开 abort 与 waitForIdle 等待当前操作取消，再请求宿主 shutdown；随后由原生 quit 流程恢复终端、触发 session_shutdown 并等待 jobs/agents/workflow owner 清理。设置 false 后 `/reload` 撤销本扩展的 `/exit` 注册；原生 `/quit` 始终可用。

[返回公共运行时](index.md)

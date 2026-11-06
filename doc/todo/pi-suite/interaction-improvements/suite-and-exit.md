# Suite 设置与原生退出别名

## Suite 设置入口

- [ ] `/suite` 提供可编辑设置界面，并显示有效值、来源、写入范围和生效方式。
- [ ] 设置保存复用公共配置 schema、合并与写入能力，保留未修改字段。

### 已确认的问题

`src/index.ts` 注册的 `/suite` handler 只有一次 `ctx.ui.notify`，完全没有编辑、校验或持久化入口。因此“只能看不能设置”是功能未实现，不是权限问题。摘要还混用了 ask 的配置值和其他模块的实例存在状态；模块开关写入配置但尚未 reload 时，不能清晰表达当前启用状态。

`src/runtime/config.ts` 已维护默认值、严格 schema、用户/项目两层覆盖及 `jobs.launchPolicy` 仅用户可写的限制。`src/runtime/config-edit.ts` 仅针对 agent 类型提供按字段定位和原子写入，尚无通用设置编辑接口。模块实例集合在首次真实 session_start 固定，不能只改配置变量就宣称模块已启用或停用。

### 修改方案

将命令界面移至 runtime 配置相关模块，复用 Pi 原生 `SettingsList` 的搜索、选择和子菜单；按 modules、ui、ask、goal、tasks、agents、jobs、commands 分组。布尔/枚举直接选择，数值、快捷键及文本经现有 schema 校验；模型和 Types 复用已有选择器。复杂设置也须有可达编辑入口：CLI 预设、包白名单和启动策略使用专用子编辑或按单个配置字段编辑 JSON，不要求重写整份文件。

扩展现有 `config-edit` 成公共字段读写能力，Types 写入一并复用。界面展示内置默认、用户值、项目值和合并后有效值，默认在已有覆盖的来源层编辑；无覆盖时默认用户层，可显式切换项目层。修改被上层遮盖的用户值时说明实际有效值。恢复继承只删除选定层的字段；`Use definition` 等已有多层清除语义单独保留。`jobs.launchPolicy` 始终只写用户配置。

保存前重读最新文件、只修改目标字段并校验，保留其他设置。复用 `JsonStore` 的串行/锁内重读和原子保存能力；不新增配置锁系统。无效配置、校验或 I/O 失败必须报告，失败不能显示“已保存”。不把 `loadConfig` 生成的函数等运行对象序列化回文件。

界面区分“已保存配置”和“当前运行状态”。第一阶段通用设置统一提示 `/reload` 生效，保留 Types 已有的保存后刷新能力；不为通用设置实现半套热更新。模块开关和命令注册必须经过新激活；设置保存本身不取消已有 agent/job，不触发全量会话重绑定。后续若增加即时应用，必须沿用统一绑定与状态发布入口，逐字段明确契约。

验收：可实际修改、保存并重新读取配置；用户/项目覆盖及恢复继承正确；错误文件不会被覆盖；模块关闭/开启与 `/reload` 后的实际注册一致，界面不误报即时生效。已有 Types 配置和用户专属启动策略的约束不变。

## Exit 原生退出别名

- [ ] 添加 `/exit`，默认启用，可在 `/suite` 和配置文件中关闭。
- [ ] 退出调用原生 quit 处理链，保持其退出时机和清理语义。

### 配置与注册方案

建议新增 `commands.exit: boolean`，默认 `true`，纳入同一默认值、schema 和用户/项目合并规则。首次真实 session_start 按有效配置决定是否注册，变更后 `/reload` 生效。该开关独立于 agents/jobs 等业务模块；所有业务模块关闭时仍可使用 `/suite` 和启用的 `/exit`。关闭时不注册本扩展的 `/exit`，不影响原生 `/quit`。

### 宿主边界与必须解决的差异

Pi 1.5.0 的交互层对 `/quit` 直接调用 `InteractiveMode.shutdown()`；扩展公开 API 提供 `ctx.shutdown()`，最终进入同一宿主退出清理流程。不过，绑定的 shutdown handler 在主会话忙碌时只设置 `shutdownRequested`，等待 `agent_settled`；原生 `/quit` 直接开始退出。当前公开 API 没有调用内置命令 handler 的通用入口，`pi.sendUserMessage('/quit')` 也不等价于执行该内置命令，不能用它实现转发。

为满足“直接调用原有 quit”的要求，实施前须补齐宿主公开的 quit 调用/命令别名能力，或统一公开 shutdown 与原生 quit 的即时退出契约，再由 `/exit` 的薄 handler 调用。仅调用现有 `ctx.shutdown()` 并忽略忙碌状态差异不能视为完成。若通过依赖升级解决，需验证实际安装的修复版本；若需修改宿主，应让能力回到 Pi 的公共命令/生命周期层，不从扩展访问 `InteractiveMode` 私有成员。

扩展不得复制进程清理代码、直接 `process.exit`、向自身发信号、模拟按键，或自行发送 `session_shutdown`。agents/jobs/workflows、调度和通知清理继续由原生退出触发的现有 `session_shutdown(reason='quit')` 链负责。

验收：默认注册、关闭后消失、重载重新准入；空闲及正在生成/执行工具时，`/exit` 与 `/quit` 的退出时机、终端恢复和清理结果一致。有活动子代理、job、workflow，以及业务模块关闭但仍有既有 owner 时，均完成原生清理，不能留下孤立任务。

关联当前文档：[公共运行时与配置](../../../current/runtime/index.md)、[统一界面](../../../current/ui/index.md)、[agents 生命周期](../../../current/agents/runtime.md)、[jobs 结算与停止](../../../current/jobs/index.md#结算与停止)。

[返回需求清单](index.md)

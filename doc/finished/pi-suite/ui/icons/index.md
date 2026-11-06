# 状态栏图标与 simple 布局

完成 goal 动态状态图标和 `🤖N · ⚙M` 活动数量摘要；复用 StatusPublisher 与既有 goal 生命周期，详细等待与错误保留在 `/goal`，零数量项隐藏。命名 simple 布局使用 `git main ↑N ↓M`，保留配色与其他模块，接入 extension_status 并保留发布方 goal 图标；上下文显示项明确设置 `hidden = false`。保存 profile 与应用活动配置分别进行。

验证：类型检查及 34 项相关既有检查通过，覆盖 goal 生命周期、通知协调、数量可见性与完整 footer 联动。已安装 pi-starship 0.66.0 通过 Pi 原生扩展加载器读取配置，无语义告警；40/60/120 列下动态 goal 图标与数量正常显示，Git 本地跟踪分支的领先/落后渲染通过。指定 profile 的语法校验和带基线比对、持久备份的原子写入通过；活动配置保持原样。

稳定事实见 [统一界面](../../../../current/ui/index.md) 和 [目标操作](../../../../current/goal/operations.md)。

[返回已完成专项](../../../index.md)

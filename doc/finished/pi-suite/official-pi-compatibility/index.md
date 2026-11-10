# 官方 Pi 插件兼容实施

## 状态与执行权限

本专项保留已确认的方案、实施授权与依赖审计细节，U1、T1、M1、净化专用实现及三组补丁清理已实施。用户明确授权修改源码、测试及仓库依赖配置，并确认净化专用实现/测试、三组宿主补丁和定制入口的清理范围。源会话 JSONL、用户任务/执行记录、用户 shell 和全局 Pi 安装不修改；新增疑问或未列明的破坏性操作必须提前询问。

当前使用官方未修改的 Pi 1.5.0；三个 Pi peer/dev 均精确固定为 `1.5.0`，`private:true` 保持，未实际 npm 发布。stock U1 定向 18/18、T1 定向 16/16、全量 215/215 与 typecheck 通过；官方 bin/RPC 原有三项实际入口验收通过。新增真实 bundled CLI 补验在 regular/fullscreen 下覆盖 Dock 选择、Subagent 正文搜索定位、keyboard o、合法 active child 中文 Editor 草稿与 Esc 取消及退出清理。

消费者安装按用户明确指示延期，见 [官方 Pi 干净消费者安装验收](../../../todo/official-pi-installation.md)；官方加载/运行入口通过不等于 Git/本地包及 tarball 安装已验收，也不宣称整体发布完成。

## 已确认决策

| 议题 | 确认方案 | 保留目标 | 接受的边界 |
| --- | --- | --- | --- |
| 阅读 UI | U1：原版公开组件、键盘优先 | 搜索、翻页、首次末尾、暂停/跟随、工具展开、全屏遮盖、PTY | 不要求完整原生 overlay 滚动条、复杂鼠标命中或与宿主 viewport 完全同构 |
| Tasks fork | T1：只保证持久化会话任务继承 | 独立清单、完整编号计数器、状态/依赖、执行原归属 | 内存 fork 的任务自动继承不作为保证；正常内存任务仍保留，不偷偷落盘 |
| Subagent 模型运行时 | M1：保留现有私有桥接并明确风险 | 使用父会话同一 runtime 的 Provider、认证和路由状态 | 依赖私有 `ModelRegistry.runtime`；限定验证范围，升级复核，不伪称公开 API |
| Responses phase | 遵循原版行为，不另立功能 | 不改生成来源，正常保存和重放 | 不额外保证跨 API/provider/model 的 wire phase；不增加请求恢复层 |
| 历史净化 | 产品能力暂缓，专用实现/注册/测试及暂停副本 helper 已移除 | 普通 Pi fork、会话及 Provider 行为 | 不保留隐藏入口、无效占位命令或长期请求过滤器 |

## 文档索引

- [宿主依赖审计与职责分类](audit.md) — 迁移前三组补丁审计基线、插件可替代能力、间接部署后果与实施边界。
- [U1 阅读方案](reading-ui.md) — 共享框架、保留交互、取消保证的范围、资源/全屏预算及验收。
- [T1 任务分叉方案](task-fork.md) — 持久与内存范围、完整快照、执行 owner 和失败提示。
- [M1 私有运行时桥接](runtime-bridge.md) — 保留理由、统一 helper 与 manager/runner/mentions.clone 调用、版本风险及明确失效边界。
- [清理范围与官方入口验收](cleanup-and-release.md) — 净化/phase/patch/入口清理、已验证加载范围及延期安装项。
- [官方入口验收与边界](validation.md) — stock 检查与实际 CLI/RPC 的结论、适用范围及未覆盖项。

## 任务列表

- [x] 核对未打补丁 Pi 1.5.0 的公开声明、实现及补丁调用链。
- [x] 用户确认 U1、T1、M1、原版 phase 行为及净化暂缓方向。
- [x] 仅将决策、优缺点、权限与验证边界写入文档。
- [x] 获得明确的源码、测试及依赖清理实施授权。
- [x] 实施 U1 与 T1，保留 M1 并说明私有桥接风险。
- [x] 移除净化专用实现/检查，以及额外 phase 行为。
- [x] 替换依赖后移除宿主补丁及定制 CLI/RPC 启动要求。
- [x] 使用官方未修改 Pi 1.5.0 验证原有三项 bin/RPC 加载与实际运行入口。
- [ ] 消费者 Git/本地包及 tarball 安装验收按用户指示延期，统一维护在 [安装待办](../../../todo/official-pi-installation.md)，不得标记为通过。
- [x] 完成真实 CLI Dock、正文搜索与合法 active child 中文 Editor 补验；范围见 [U1 清单](reading-ui.md#验收与任务列表)。
- [x] 稳定事实局部同步至 current，专项归档至 finished。
- [x] 完成最终复验与文档审核，提交获授权的实现和文档。

[返回已完成索引](../../index.md) · [当前 UI](../../../current/ui/index.md) · [当前运行时](../../../current/runtime/index.md)

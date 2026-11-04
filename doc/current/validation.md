# 基线与验证

开发依赖锁定 @earendil-works/pi-coding-agent、pi-ai、pi-tui 1.5.0 和 typebox 1.3.27，使用新作用域 API。Windows 实际 CLI 为 Pi 1.5.0；Linux 使用同版本 SDK。项目要求 Node.js 24+ 和 pnpm 12.6.0。Linux 按操作系统能力验证，使用已有环境，不安排发行版专项或安装新发行版。

Linux 检查复用已有 Node.js/nvm 环境；非交互 shell 应先加载 nvm 初始化脚本，再解析 node 命令。pnpm-workspace.yaml 的 supportedArchitectures 为 Windows/Linux 保留平台可选依赖，使共享依赖目录包含 TypeScript 7 的两平台编译器。

发布包来源、tarball integrity、可用 gitHead 和仓库字段见 [来源元数据](../../third-party/sources.json)。ask 以 pi-ask-user 0.17.2 的工具契约为基线，将交互重构到公共 runtime/ui；其完整许可证保存在 [许可证](../../third-party/licenses/pi-ask-user.txt)。所有来源及更新方式见 [上游登记](../../third-party/UPSTREAM.md)。

goal 参考 @narumitw/pi-goal 0.54.15 的工具契约与控制语义，生命周期接入 Pi 1.5.0 的公共最终结算接口，许可证见 [pi-goal MIT](../../third-party/licenses/pi-goal.txt)。

## 检查

```sh
pnpm typecheck
pnpm test
```

Node 内置测试运行器使用 experimental-transform-types 加载 TypeScript。检查包括外部参数契约、混合批量最终确认、预选/推荐身份、排队及超时竞态、配置覆盖、会话撤销、通知合并、状态去重和原生消息呈现。实际 Pi SDK 通过原生工具包装器验证注册及结果；TUI 组件检查 40×24、60×30、120×40 的询问高度和可见宽度。目标检查使用 SDK 自带 faux provider，通过真实宿主核对正常继续、重试成功/耗尽、手动与阈值/溢出压缩、压缩取消、Esc、未回答询问、预算、reload、新建/恢复/fork、树切换和期限恢复；压缩摘要由公共 hook 提供。原生 footer 核对 40、60、120 列的状态行与宽度。

以上 27 项离线检查及类型检查在 Windows（Node 24.22.2）和 Linux（已有 WSL/nvm 环境，Node 24.14.0）通过，日常检查在 5 分钟内。另在 Windows 执行 pi-starship 0.65.2 实际 extension_status 模块，验证 goal/runtime 槽位读取、数量上限与空状态。这些检查证明当前询问、目标及共享组件的契约；真实手机 SSH 输入、完整第三方 footer 布局和后续业务模块综合生命周期由 [完整实施计划](../todo/pi-suite/implementation.md) 管理。

[返回当前文档](./index.md)

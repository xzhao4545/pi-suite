# 基线与验证

开发依赖锁定 @earendil-works/pi-coding-agent、pi-ai、pi-tui 1.5.0 和 typebox 1.3.27，使用新作用域 API。Windows 实际 CLI 为 Pi 1.5.0；Ubuntu 使用同版本 SDK。项目要求 Node.js 24+ 和 pnpm 12.6.0。

发布包来源、tarball integrity、可用 gitHead 和仓库字段见 [来源元数据](../../third-party/sources.json)。ask 以 pi-ask-user 0.17.2 的工具契约为基线，将交互重构到公共 runtime/ui；其完整许可证保存在 [许可证](../../third-party/licenses/pi-ask-user.txt)。所有来源及更新方式见 [上游登记](../../third-party/UPSTREAM.md)。

## 检查

```sh
pnpm typecheck
pnpm test
```

Node 内置测试运行器使用 experimental-transform-types 加载 TypeScript。检查包括外部参数契约、混合批量最终确认、预选/推荐身份、排队及超时竞态、配置覆盖、会话撤销、通知合并、状态去重和原生消息呈现。实际 Pi SDK 通过原生工具包装器验证注册及结果；TUI 组件检查 40×24、60×30、120×40 的询问高度和可见宽度。

以上离线检查在 Windows（Node 24.22.2）和 Ubuntu 24.04（Node 24.12.0）通过。它们证明当前询问及共享组件的契约，不证明真实手机 SSH 输入传输、第三方 footer 布局或全部业务模块的综合生命周期；这些场景的验收要求仍由 [完整实施计划](../todo/pi-suite/implementation.md) 管理。

[返回当前文档](./index.md)

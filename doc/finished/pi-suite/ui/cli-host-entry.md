# Patched Node 宿主发布入口验收

用户实际打开 Subagents/Jobs 时出现 `renderLayout is not a function`。已定位：coding-agent 的发布 bin/RPC export 指向预构建 bundle，其内置 TUI/adapter 和静态 virtualModules 不包含单包 patch；直接 SDK/TUI 验证不能替代该发布路径。

## 修复与验收

- [x] coding-agent patch 将 Node bin、RPC export 分别指向 `dist/cli.js`、`dist/rpc-entry.js`，与 SDK 和实际 patched 依赖共用模块图；不加页面 fallback，不编辑 minified bundle。
- [x] 实际启动 package bin，经 PTY/xterm/真实扩展登记执行工具与 child/job，再打开 Subagents、Jobs、Tasks，验证返回、原生工具点击、模块身份及 resize。
- [x] 实际 CLI 与导出 RPC 入口验证 prepared-fork、独立会话/任务、副本无旧私有状态、新响应正常保存，无自动模型请求。
- [x] 扩展加载边界检查必需的原生布局 API；stock 1.5.0 bundle 作为负对照，启动明确拒绝并提示安装/重启，不发生异步 `renderLayout` TypeError 或注册部分 Suite。
- [x] 当前文档说明入口及补丁变更后的进程重启要求，`/reload` 不替换宿主模块图。
- [x] 最终 frozen-lockfile 安装、typecheck、全量测试及文档链接/patch 差异审查。
- [x] 将完成结论补入原专项验收记录，移除本活跃入口。

最终 typecheck、离线 frozen-lockfile 安装及全量 **220/220** 测试通过，约 52.3 秒；真实 CLI/RPC 两项集成检查约 11 秒。该验收使用实际包入口与真实扩展加载器，证明原生类身份、页面绘制/返回/鼠标、resize 和 prepared-fork，不以版本号或配置字符串替代。

验证限于 Linux 的真实 Node CLI、PTY、xterm、SDK/RPC 和离线 faux provider，不宣称实体人工终端、Windows 或真实账号解密/权限/中转粘性通过。

[当前运行时](../../../current/runtime/responses-fork.md) · [原生 UI 专项](ui-native-integration/validation.md)

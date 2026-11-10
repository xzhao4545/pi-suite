# 官方 Pi 1.5.0 兼容实施验收

## 基线与结论

依赖、lockfile 及实际加载包均为官方未修改的 Pi 1.5.0。三组宿主 patch、patchedDependencies、定制 bin/RPC 和 patched-layout 加载门禁已移除；不是以旧 patched 环境的 220/220 结果替代官方验收。三个 Pi peer 与开发依赖精确限定为 `1.5.0`，包保持 `private:true`，未实际 npm 发布。最终 `pnpm typecheck` 与 `pnpm test` 通过：215/215，失败、跳过、取消均为 0，完整测试 50.6 秒。

消费者安装验收按用户要求延期，独立维护在 [安装待办](../../../todo/official-pi-installation.md)。官方运行入口通过不等于 Git/本地包或 tarball 安装通过，也不证明包管理器资源发现已经完成。

## 逐项契约与证据

| 契约 | 结论与适用证据 |
| --- | --- |
| U1 共享阅读预算 | 公开 Container、ScrollView、VStack/HStack；一次正文渲染后 updateLayout、按唯一 scrollTop 切片并填足窗口。共享 readingRows 扣除标题、底部信息、输入和操作栏；代表尺寸及动态 resize 通过。 |
| 原生工具外壳 | 正常/错误背景与单层 outputPad 由 Pi 管理；摘要接替、partial/final、完整错误及敏感字段边界保留。工具/历史/Transcript 聚合通过，实际 CLI 的 `o` 展开成功且不产生新输出提示。 |
| Dock 与 Tasks 反馈 | 公开 getFocusedComponent 支持空编辑器 Left 选择；等宽前缀、列和状态角色保留。实际 CLI 的选择/退出通过，任务聚合覆盖恢复不反馈和真实完成 5 秒反馈。 |
| 首次末尾及阅读状态 | 新建 reader 首次定位末尾；暂停、搜索、子页返回、结算及正文变短保留暂停，End 恢复跟随；展开和 resize 不当成 Provider 新输出。共享 reader/Agents/Jobs 聚合及 CLI 正文搜索通过。 |
| 全屏、footer 与焦点 | 原版 focused overlay 使用 top-left、100% width/maxHeight 与零 margin；readingWindow 自行填行，背景 lease 覆盖异步子页间隙。短正文、退出、构造失败和嵌套作用域聚合通过，不销毁或替换原生/第三方 footer。 |
| 原生 Editor 与退出 | 真实官方 CLI 的 regular/fullscreen 中通过合法活动 child 打开 ViewerEditor，中文草稿可见并用 Esc 取消；结束记录不绕过 Message 权限。共享输入聚合覆盖多行预算、失败保留和旧 run 拒绝；关闭查看器不停止执行，正常 quit 完成清理。 |
| Jobs pipe/PTY | 逐流字节窗口、搜索及最终输出补读保留；PTY 使用既有 xterm 二维屏幕和实际尺寸/输入控制。真实进程、终端、resize、接管/交还/离开聚合通过，CLI Jobs 输出及返回通过。 |
| T1 持久 Tasks fork | previousSessionFile 的首个非空会话头按 UTF-8/LF 只读解析，接受 EOF 无 LF 与字符串内 U+2028/U+2029。完整快照含空清单 nextId/nextChild、状态/依赖，在目标锁内首次播种；跨 cwd、源字节/mtime 不变、目标独立及 resume/reload 聚合通过，官方 RPC 持久 clone 的两份任务快照相同。 |
| T1 错误和内存边界 | 源缺失/损坏/无效会话头明确通知错误，不修复、不伪造来源、不宣称继承成功。内存 fork 明确 warning 并使用独立清单，不偷偷落盘；普通内存任务及 captured child/assigned 原清单与执行归属聚合通过。 |
| M1 私有父 runtime | parentModelRuntime 集中读取受守卫的私有 ModelRegistry.runtime；manager 在准入前校验，runner 在 SDK 启动前校验以覆盖 reload 保留的旧执行，类型克隆在异步准备前捕获。无 Execution 新字段、无 snapshot/工具结果/日志的 runtime 扩展字段，无 undefined/default-runtime 兜底。 |
| M1 Provider/认证/路由 | 实际官方 bundle 中动态 faux Provider 的普通 child/RPC 子调用可用；官方 SDK 聚合验证同一 runtime 对象、运行时 API key、虚拟路由分支状态、nested/resume 和类型提及克隆。模型变更、workflow/调度/RPC 共享入口与失效拒绝通过；这些受控证据不等于外部账号或真实中转粘性。 |
| 原版 Responses phase | 实际官方 RPC 与本地 HTTP SSE 的持久化、重启 resume、同模型文本签名/message ID/phase 和跨模型原版转换通过。Suite 不注册净化命令、不注入 phase 恢复、API aliases、自动 400 重试或伪造来源。 |
| 净化与 Goal/owner 清理 | 专用实现、注册、测试、夹具流程、pausedGoalCopy 及宿主 prepared-fork/helper patch 已移除。普通 Goal 恢复/显式暂停/waiting、预算、绑定代次、执行 owner 与通知聚合通过；未整体 revert 既有 UI/入口专项。 |

## 实际入口与范围

- Node bin 为官方 `dist/bundle/cli.js`，RPC export 为官方 `dist/bundle/rpc-entry.js`；通过原版 loader，不使用自建身份适配层、unbundled 私有入口或 shell 别名。
- 实际 CLI 在 Linux PTY/xterm 验证 regular/fullscreen 下的 Subagents/Jobs/Tasks、正文搜索、工具展开、活动 child 中文 Editor、Dock、普通持久 clone、40×24/80×30/120×40 与 resize、返回及自然退出。宿主 TUI 与扩展的公开类身份一致。
- 实际 RPC 验证扩展命令加载、净化命令不存在、普通持久 clone/Tasks 继承、正常工具及后续请求。Responses 验证使用本地 HTTP SSE，不把受控密文字符串当成真实解密成功。
- U1 不保证复杂 overlay 的区域鼠标焦点、嵌套单项工具命中、scrollbar 轨道/拖动或与宿主 viewport 完全同构；没有自绘 scrollbar 或新增平行鼠标系统。Ask 表单与 TerminalView 既有本地鼠标范围见 [终端操作](../../../current/ui/terminal.md#原生阅读与鼠标)。
- M1 是明确接受的私有例外；其他 Pi 版本、实体人工终端、Windows 人工交互、外网凭据/组织权限和真实中转路由未在本专项验收，不计为通过。升级须复核私有字段、官方入口及模块协议并重启宿主。

## 文档与维护

实现、操作和支持范围已局部同步到 current；历史 patched 专项保留原有限定，不改写为官方兼容证明。消费者安装及资源发现仍在独立 TODO，后续执行前确认网络/缓存权限，不改全局 Pi、shell 或用户会话/任务/执行数据。

[返回专项索引](index.md) · [当前验证基线](../../../current/validation.md) · [安装待办](../../../todo/official-pi-installation.md)

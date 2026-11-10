# Responses 历史净化 fork

## 操作

`/responses fork` 在当前会话 idle 且没有排队消息时，一次性净化当前叶子的完整有效分支并切入独立副本。命令没有 Provider、账号、模型或历史消息选择器，也不要求当前模型使用 Responses；模型与 thinking 继承执行命令时的配置。用户可在执行前或之后用 Pi 原生入口切换渠道。

命令不发模型请求、不生成新摘要、不执行历史工具、不自动发送“继续”。成功后等待下一条用户输入；复制的 active goal 变为 paused，停止继承自动许可、等待期限和外部唤醒，可通过 `/goal resume` 明确恢复。原会话的 goal、任务、child/job/workflow 执行和通知 owner 保持原归属；返回原会话仍可观察其真实状态。

空有效历史、忙碌、源会话/叶子变化、不可识别的 reasoning 签名、仅有不透明压缩或未完成 deferred 响应会明确拒绝。没有需要清理的私有字段时仍创建分支副本，并明确提示净化数量为 0，不虚报已删除状态。原生 before-fork 取消发生在副本写入之前。持久化、cwd 与 sessionDir 遵循宿主 fork 规则；内存会话没有伪造文件路径。副本写入/运行时建立失败由宿主错误边界报告，不重试或降级为普通 fork。

## 净化边界

- 保留用户/可见 assistant 原文、工具名称、业务参数、真实结果与错误结果、角色和顺序。不会递归删除业务字段中的 `id`、`signature`、文件/容器引用或文字中的密文样式内容。
- 仅对 `openai-responses`、`azure-openai-responses`、`openai-codex-responses` 来源的消息处理协议私有状态：移除旧 responseId、reasoning 签名及 redacted 不透明块、旧工具 item 部分与 thoughtSignature。可阅读 thinking 保持原角色，不拼成普通回复；非 Responses 签名不改动。
- 复合 `callId|itemId` 保留 call ID，结果使用同一映射；出现冲突时分配独立合法本地 call ID。context edit 省略调用时仍用源消息来源识别其保留结果，不把其他 Provider 的任意 ID 当作 Responses 状态。工具参数不重写、不补执行结果。
- textSignature 的旧资源 ID 删除；commentary/final_answer 使用公开签名编码与新本地消息 ID 保存。跨模型/Provider 的正常转换保留 phase，不伪造历史来源。
- 当前分支的最新 context edits 物化为替换贡献；省略内容和 edit 本身不进入副本。可导航的压缩前消息同样净化，保留可阅读 compaction/branch summary、系统/工具 checkpoint 与 retained-range 引用，不展开所有旧消息为请求。兄弟分支不复制。
- 原历史条目不被重写。宿主 shutdown 可以正常追加状态记录；源会话可通过 `/resume` 返回。副本记录 `pi-suite:responses-fork` 来源身份，普通 fork 头记录 parentSession/parentSessionId；这些是本地结构与来源，不是远端资源引用。

新 session ID 隔离旧 WebSocket 连接、previous_response_id 和增量输入基线；第一次请求使用完整净化上下文。之后产生的新 item、加密 reasoning 与正常缓存续接按 adapter 保存和重放，没有永久请求过滤器、portable 标记或禁用缓存策略。

## 宿主能力与版本

仓库通过 `pnpm-workspace.yaml`、lockfile 与 `patches/` 管理 Pi 1.5.0 的公开能力扩展。`SessionManager.supportsPreparedFork` 标明宿主支持 `ctx.fork(..., { position: 'at', prepare, withSession })`：prepare 接收独立的分支副本，在目标持久化和 session_start 之前完成；源变化时停止，正常 fork 生命周期负责任务播种与重新绑定。协议 phase 的解析/编码、复合工具 ID 解析由 pi-ai 公共模块 `api/responses-signatures` 提供，adapter 与净化器共用协议语义。

Node CLI 的 `pi` bin 使用 `dist/cli.js`，导出的 RPC 入口使用 `dist/rpc-entry.js`，SDK 使用 `dist/index.js`；三者共用实际安装的 patched coding-agent、pi-ai、pi-tui 模块图。预构建 Node bundle、Bun/SEA 的内置模块不属于这组单包补丁的运行入口，不能用其静态 virtualModules 代替公开模块。Suite 在扩展加载边界检查必需的原生布局 API；不支持的宿主明确拒绝并提示安装/重启，不等到异步页面渲染时崩溃。入口验证必须实际启动包的 bin/RPC，不能只用 `createAgentSession()` 或直接构造 TUI 替代。

安装使用 `pnpm install`，宿主运行使用本仓库解析到的依赖，例如 `pnpm exec pi -e ./src/index.ts`。本包要求宿主的公共布局、adapter 子路径解析与 fork 准备能力均包含同一组版本补丁；仅用未扩展的全局 Pi 加载本包不满足要求。安装或升级补丁后须重启 Pi 进程；`/reload` 只重载扩展，不替换宿主模块图。需要保留当前目标时用该入口配合 `--resume` 恢复原会话，不新建或 fork 目标。可用宿主缺少 prepared-fork 能力时，命令明确拒绝，不先复制私有历史再追加 context_edit。升级 Pi 时必须核对并更新受版本管理的 patch 与对应验收。生成 patch 后核查其应用范围，只保留必要代码与类型声明变更，保留 CLI 可执行权限及上游示例资源；以 frozen-lockfile 安装确认补丁内容和 lockfile 一致。

## 支持与限制

本地受控协议服务覆盖 OpenAI/Azure SSE、Codex 完整 WebSocket 与 websocket-cached：持久副本第一轮不发送旧私有状态，第二轮重放新状态，缓存续接只属于新 session。Linux SDK 的真实命令入口覆盖配置继承、正常 fork/恢复/reload、独立持久/内存任务和暂停 goal。

受控服务不能证明真实账号的加密有效性、权限或中转站粘性。加密 reasoning 不能解密或无损迁移；账号专属文件、容器需原内容/重新上传或原账号；纯密文压缩缺少可阅读上下文时拒绝净化。中转后续轮换至不兼容账号仍可能失败；普通参数、schema、额度及其他 400 不属于修复承诺。不进行真实网络认证探测，不泄露密文或 API Key。

[返回公共运行时](index.md)

# M1：保留父模型运行时的私有桥接

## 决策与当前调用

用户明确接受保留 `ModelRegistry.runtime` 私有依赖，优先沿用父会话的模型运行时，不改为独立公开 runtime，不为暴露该字段修改宿主。

当前私有读取统一在 `src/agents/models.ts` 的 parentModelRuntime：结构化读取 `ctx.modelRegistry.runtime`，校验 getModel、streamSimple、resolveModel 协议后返回同一父 runtime。Manager.start 在任务 I/O 和分配 run 前守卫；`src/agents/runner.ts` 在资源/SDK 启动前复核捕获的父 registry，`src/agents/mentions/clone.ts` 在异步准备前捕获并传入父 runtime。Pi 1.5.0 的原版声明将该字段列为 private；运行时可以读取不代表它成为公开兼容契约。

## 保留理由和优势

- 模型名称相同不代表认证、Provider、路由及临时状态相同；共享 runtime 避免无声创建另一份模型环境。
- 不为 child 重新加载整套 Provider 扩展，不额外产生初始化副作用。
- 普通 child、嵌套启动、恢复与 @类型 克隆保持既有模型解析链；模型、thinking 及 individual/type/parameter 优先级不变。
- 这是插件中的私有桥接，不需要维持 pi-coding-agent patch 或修改官方 CLI。

## 风险与支持边界

- Pi 可以重命名字段、改变对象协议或改为真正的私有属性；公开 API 和 semver 不保证其稳定。
- “锁定 Pi 版本”只缩小核查范围，不能把一次 SDK 成功当成所有官方 CLI/bundle 路径都兼容。
- 共享的是父运行时，不承诺完整运行时状态独立隔离；子代理的模型选择、会话、工具与 owner 仍按既有边界隔离。
- 父 Provider、临时认证及虚拟路由是否在子请求中正常继承，按实际入口和验证范围报告，不以配置字符串或同名模型证明。
- 三个 Pi peer/dev 均精确固定为 `1.5.0`，支持范围与官方原有 bin/RPC 三项实际加载入口的验证一致；升级仍须复核私有结构，固定版本不能消除风险。消费者安装验收按用户指示 [延期](../../../todo/official-pi-installation.md)，不能根据加载结果宣称安装通过。
- 不读取更多私有状态来拼装父 runtime，不伪造 provider/model 来源，不把私有桥接称作“只用公开 API”。

## 实施边界

代码实施已完成，读取和版本失效报告收敛在既有 models helper 与模型/SDK 边界，manager 准入、runner、mentions.clone 共用守卫，避免调用处实现分歧；不新增平行 Provider 注册系统或过度抽象，不向 Execution 增加字段、不序列化 runtime，也不改变执行持久协议。

已知风险是在字段缺失时，向 SDK 传入 undefined 可能导致其创建默认独立 runtime。因此字段或协议不可用时明确报 MODEL_RUNTIME_UNAVAILABLE，在建立新 run/发送请求前拒绝相关启动，不静默降级、忽略失败或换一份认证状态继续请求，不假装完整继承仍成立；判断使用结构协议，不跨 bundle 使用 instanceof。

M1 的选择不授权改 Pi 源码、增加公开导出、修改宿主 Jiti aliases 或改 CLI/RPC 入口。若未来私有字段失效，重新报告后由用户决定适配、改用公开方案或缩窄能力。

## 验收与任务列表

- [x] 文档明确当前私有读取位置、保留理由及非公开性质。
- [x] 核查并统一必要桥接边界及失效错误，不引入静默 runtime 替换。
- [x] 官方 Pi 1.5.0 原有实际加载入口验证 child 与 @类型 克隆使用父 runtime 引用。
- [x] 用父 runtime 引用与结构协议核查继承，不仅检查模型名；动态 Provider/临时认证及路由继承仅按已有受控验证范围声明，不据此保证外部认证或全部虚拟路由组合。
- [x] 原有模型配置检查验证运行中模型修改不打断当前请求、不改变主会话或其他 child 的模型选择。
- [x] 核查 child 恢复、workflow/调度/RPC 等共享 Manager.start 入口遵循桥接守卫和来源解析，不增加 Execution 字段或 runtime 持久化。
- [x] 对未覆盖 Provider、外部认证或虚拟路由明确标注范围；Pi 升级时复核私有字段及实际入口。

[返回专项索引](index.md) · [当前模型配置](../../../current/agents/models.md) · [当前执行与记录](../../../current/agents/runtime.md)

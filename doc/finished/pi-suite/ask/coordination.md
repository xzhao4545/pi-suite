# 询问与后台通知协调阶段

目标：真实询问阻塞期间保留 goal、child 问题和 job 完成状态，并在恢复时只请求一次模型继续。

## 完成项

- [x] 使用 Pi 1.5.0 公共 UI 包装器和实际 AskView 输入，核对 answered、timed_out、cancelled 三种结算以及 goal 待答状态。
- [x] 两个真实 SDK child 的 ask_user 经父级协议进入共享 Notifications，只交直接父级；实际 pipe job 完成时和问题一起暂存，不打断当前询问。
- [x] 回答后在一个边界合并 job 结果、两个 child 问题及 goal 继续请求；超时与取消须等待新的用户 prompt 恢复，后台消息不自动解除 waiting_user。
- [x] 父级依次调用原生询问；第二题排队时不启动展示期限，第一题结束后才展示。父级回答两个 child 后完成实际 child 执行，已消费通知不再次唤醒。

1 项 Linux（Node 24.22.2）真实 SDK 聚合检查通过，覆盖三种结算与真实进程；类型检查通过。UI 使用原生组件的键盘输入和真实定时器，终端呈现通过受控 UI 上下文驱动；Windows 组合、真实手机 SSH 输入、滚轮及缩放仍由 [询问交互](../../../todo/pi-suite/ask/interaction.md) 和 [详情滚动](../../../todo/pi-suite/ask/details-scroll.md) 验收。

child 问题的父级协议期限与原生 AskQueue 的展示期限分别管理。本阶段 child 问题使用 timeoutMs:0，由父级实际询问验证排队期限，未新增询问或通知框架。

稳定接口与操作见 [ask 当前文档](../../../current/ask/index.md)。

[返回已完成专项](../../index.md)

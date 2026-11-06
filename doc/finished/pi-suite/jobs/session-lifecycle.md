# 同一 Pi 进程内保活

目标：让后台任务跨 reload、resume 等界面与会话操作继续执行。

当前状态：已完成；长期 manager 与可撤销会话绑定、reload/new/resume/fork 后重新订阅、分支引用通知与去重通过两平台宿主检查，见 [执行任务](../../../current/jobs/index.md)。quit 策略、独立版本控制桥、协议不兼容时的受限查询/停止、空闲替换与升级期间退出清理通过 Linux 和 Windows 真实 SDK/进程检查；Windows 完整检查和实际 CLI 退出范围见 [Windows 阶段](windows-runtime.md)。

影响范围：运行进程、PTY、日志、会话绑定及通知归属。

约束：manager 不持有 Pi context；会话变更不转移任务所有权。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [x] 拆分长期 manager 和可撤销的会话/UI 绑定
- [x] 实现 reload/new/resume/fork 后重新订阅
- [x] 处理分支引用、旧回调和通知去重
- [x] 实现 quit 策略与协议不兼容升级的控制边界
- [x] 在 Windows 核对控制桥受限模式、空闲替换与升级期间 quit 清理（真实 SDK reload 与受控进程，含旧桥和不同 agentDir 拒绝）

## 验收方式

受控长任务跨会话操作后仍是原进程，日志继续，结果不串会话；正常 quit 策略明确。

## 关联计划

- [执行模式](../../../todo/pi-suite/jobs/execution.md)
- [退出清理范围](exit-scope.md)
- [目标调度](../../../todo/pi-suite/goal.md)

### 6.1 第一版的保活承诺

必做范围是 **同一个 Pi 进程内**，跨轮次、compact、reload、new、resume、fork 保留运行任务。

manager 持有进程/PTY/日志，不持有 Pi context。扩展运行时持有可撤销的会话/UI 绑定：

- reload：撤销旧绑定，保留 manager，重新绑定；旧回调不能使用已经失效的 API。
- resume/new/fork：任务继续，所有权仍属于原会话；当前会话只订阅其应看到的对象。
- 分支切换：只调整显示和通知，不改任务是否运行。
- quit：按明确的退出策略清理；不能再把每一种 session_shutdown 都当成进程退出。

用户明确停止 subagent 时，它及其后代创建的后台 job 一并停止，按创建归属通过同一 JobManager 控制；这是执行停止操作，与上述会话/UI 绑定变更分开。关闭 child 查看器、detach 或 reload 不解除创建归属，具体规则见 [子代理运行控制](../../../finished/pi-suite/agents/runs.md)。

活跃 manager 的协议不兼容升级不能无声热替换；先保留既有运行任务和可用控制，再给出明确的升级状态。

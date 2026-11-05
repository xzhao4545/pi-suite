# 执行与记录

每个可恢复会话使用稳定 `agent_` ID，每次执行使用独立 `run_` ID。运行句柄、取消信号、父级引用、用量与槽位归属于 run；同一 agent 只能有一个未结算执行。恢复通过 agent_send 发起新执行，读取或打开历史不启动模型。

## 并发与生命周期

顶级 child 进入一个共享队列，分别按后台与前台池空位取最早可运行项，保持各池 FIFO。后台默认 10，前台默认不限。启动时保存 chargedPool，动态调整上限时既有槽位的收费归属保持稳定；结算释放槽位，停止排队项释放其等待者。嵌套 child 不占池，避免父级等待其 child 时互相占位。

状态包括 queued、starting、running、waiting、stopping、completed、failed、stopped 和 limited。排队项在 queued 列表单独查看；启动、运行、等待与清理中的 child 计入活动数量。等待父级回答仍计入活动数量；maxTurns 限制的执行为 limited。用量按 Pi SessionStats 计算本次执行的差值；耗时从实际开始到结束，包含工具与父级回答等待。

后台启动立即返回 ID。前台启动等待最终结果，当前父级的任一直接 child 提问都会使其提前返回；提前返回后的最终结果进入统一通知。父级 Esc 取消尚未返回的前台调用与其 child，后台 child 继续运行。reload、会话切换和树导航更换监听绑定，执行 owner 保持稳定；quit 取消活动执行。

[RPC 分离启动](rpc.md) 使用同一队列与 run 生命周期：非后台的分离运行不占前台槽位，后台与绕过队列的运行保持实际收费归属。SDK 就绪与最终结算使用独立通知点；完成事件的同步消费在公共通知准入之前执行。

## 取消与 job 归属

停止先关闭对应运行子树的准入，再取消真实 child 会话与工具信号、等待结算，并调用 JobManager.stopCreatedBy 清理所属活动 job。child 的 job_start 自动携带 agentId、runId 和 ancestors；模型不维护归属名单。JobManager 在异步授权与启动期间仍识别已关闭的 creator，防止停止期间启动遗漏的进程。

agent_stop 不指定 runId 时覆盖该 agent 各次运行及其后代创建的活动 job；指定时限定该次运行子树。已结束 child 留下的 job 也参与清理。同一范围的重复停止加入原操作，不影响同级或主会话创建的 job。父 child 结算会取消尚未结束的直接嵌套 child。

## 会话与历史

默认顶级 child 使用 SessionManager 保存完整 Pi 会话，嵌套默认内存会话，可由类型 persist_session 覆盖。父级和 child 保存 `pi-suite:agent-record` custom entry；记录包含输入、结果、错误、状态、时间、用量、模型来源、单独模型覆盖 individual 和 child sessionFile。父级离开后，历史读取仍可从 startup 引用解析 child 的最终记录。

每次结算保存 endLeafId。该次 transcript 从对应叶子读取，后续恢复新增消息属于新 run。内存会话在同一 Pi 进程内可读取和恢复；进程退出后仅持久引用可用。

Pi 1.5.0 的 ExtensionContext 提供 ModelRegistry，而 createAgentSession 只接受 ModelRuntime。执行层沿用上游在该边界读取 registry.runtime，保持父级认证、Provider 和虚拟模型路由；此访问集中在 runner，公共 context.modelRuntime 可用时替换。

child 的 task_list/task_edit、taskId 与 job 引用使用父级捕获的 TaskStore，嵌套逐级沿用。agent 恢复保持任务关联；删除任务不停止执行，child 结算不自动修改任务完成状态。

指定目标 cwd 的运行记录保存实际工具目录与 configCwd；工作区列表与手动停止按配置目录归属，类型与资源使用父级配置目录，嵌套沿用同一配置根。结构化运行将验证后的 JSON 保存为 structuredJson 与 result，模型后续文本不覆盖该结果；会话读取与恢复仍通过普通 run 记录。

[返回 agents](index.md)

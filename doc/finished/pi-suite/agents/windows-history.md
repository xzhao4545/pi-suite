# Windows 持久历史与主从交互验收

Windows、Node 24.22.2、Pi 1.5.0 实际 CLI 与 ConPTY 中，使用隔离目录和 SDK 离线 provider 运行真实 child、真实 workflow Worker；没有访问付费模型或外部凭据。任务并发、reload/fork 与 Execution 回收恢复见 [Windows 两级任务阶段](../tasks/windows-combination.md)。

## 发现目录与持久引用

普通 child 在 SDK 默认工作区会话目录落盘；另一 child 使用类型 frontmatter 的自定义 session_dir，目录经 Windows junction 指向实际存储。首个 CLI 自然退出后，将默认工作区编码目录也改为 junction，使用全新 CLI 进程和新的主会话重新发现，避免以旧 Manager 的内存记录冒充持久历史读取。

发现结果包含两个普通 child 的三个 run，以及真实 workflow 的一个 archive child。fork 的父会话引用、父级保存的 agent 引用和 workflow 保存的 child/sessionFile 与 recordPath 均参与发现；workflow child 保留 workflowId，不混入普通 workspace 列表。

## 实际工具与原生查看

新 CLI 的实际模型请求通过已注册 agent_list 工具，以 workspace/all、limit=1 连续读取三页普通 run；随后针对指定旧 run 的 transcript 以 1024 字节预算连续读取六页。历史发现与分页未恢复模型执行。实际 agent_send 对 foreign owner 明确返回错误，未产生新 child。

`/agents workspace finished` 原生记录列表能够选中 run，foreign 已结束记录菜单仅提供 Transcript 和 Jobs。进入 Transcript 可读原始 task_edit 参数、工具结果及 child 回复；只读菜单没有 Model / thinking 和 Stop child 控制。历史 owner、child JSONL 与 workflow 快照在发现、工具分页、拒绝发送及原生阅读前后 SHA256 一致。

两次 `/quit` 均自然退出码 0。此阶段完成默认/自定义 junction、fork/workflow 引用、分页与 foreign 原生只读入口的组合验收。

## 嵌套提问、进度与所属 jobs

追加实际 Pi CLI 与 ConPTY 会话，离线 provider 仅驱动模型回复；agent_start、agent_send、ask_user、job_start、agent_list、agent_read 均使用真实注册工具、child 会话和进程后端。观察扩展读取现有 Manager 的记录与实际 owner 会话，不创建替代执行或伪造通知。

父 child 以前台 agent_start 创建嵌套 child，嵌套 ask_user 挂起后状态为 waiting，parentAgentId、parentRunId 与 ancestors 均指向直接父级。父 child 的前台工具提前返回并获得问题，再通过 agent_send 回答；嵌套结果保留选项 ID 和 source=parent，两个 child 均 completed。两个顶级 child 的父级问题与原生用户回答组合见 [Windows 询问验收](../ask/windows-combination.md)，不将父 child 的回答标为用户直接授权。

另一父 child 与其嵌套 child 各自通过 job_start 创建一个真实长运行 pipe job。嵌套工具持续返回部分进度并等待取消，运行记录显示对应工具名和真实参数；主模型通过 agent_list 读取轮数、工具次数、耗时、最近更新时间及本次 run 用量，所属 jobs 包含父 run 与 ancestors 匹配的两个活动 job，读提示均携带正确 ID。原生 Transcript 的流式进度、工具参数、所属 Jobs 日志、单独停止与 foreign 只读入口见 [Windows workflow 与 child 查看验收](windows-workflow-viewer.md)。

## 同步停止与级联清理

上述两个 jobs 仍运行时，在实际 CLI 扩展命令中调用现有 AgentManager.stop；同一同步调用栈内连续停止两次，并从父 run 的 abort 回调中再次重入。同一范围三次返回严格相同的 Promise，随后统一返回 stopped、cleanup=confirmed；affected 包含父 child、嵌套 child 和两个 job。

两个 job 的 stopReason=agent、cleanup=managed_scope_confirmed、rootExited=true、taskkillExitCode=0；逐个检查停止前 scope 捕获的 Windows shell 与后代 PID，全部已结束。此补验证明真实运行上的同步重入与级联清理；原生双 x 确认和单独停止 job 的按键边界由查看验收覆盖，不以直接 Manager 调用代替该键位证据。

## Run 用量与错误通知消费

主模型启动一个真实后台 child，离线 provider 将其首个 run 结算为 failed。主模型在自身请求尚未结束时通过指定 runId 的 agent_read 消费结果；消费标记为 true。随后 agent_send 恢复同一稳定 agent ID，创建不同 runId 的第二次 failed 执行。

第二次执行的 usage 来自恢复起点后的会话统计差值，保留 input、output、cacheRead、cacheWrite、total 和 cost，不累加首个 run 的用量。两次失败均保留各自错误与结果正文；主会话落盘的公共通知恰有一条包含该 agent，且只含第二 runId、其错误、用量和指定 runId 的读取提示。首个结果的提前消费没有撤销新 run，也没有留下重复失败通知。离线 provider 的 cost 为零，此验收不证明外部模型实际计费。

追加会话通过 `/quit` 自然退出码 0。结合上述历史、任务、询问和查看验收，Windows 持久历史与主从交互组合已覆盖；其他平台与外部服务仍按各自专项核对。当前契约见 [持久历史](../../../current/agents/history.md)、[进度与通知](../../../current/agents/progress.md) 和 [执行与记录](../../../current/agents/runtime.md)。

[返回完成索引](../../index.md)

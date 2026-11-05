# 宿主、资源与记录

WorkflowManager 按 agentDir 保存在进程级运行时中；WorkflowsModule 按当前会话与分支绑定读取、等待、Dock 和通知。运行在准入时捕获 cwd、模型目录、thinking、项目信任、系统提示与 owner/anchor；reload、new、resume 和树导航只更换监听绑定。Pi 1.5 的 ExtensionContext 在替换会话后失效，后台执行使用捕获的父级事实。

## Child 与 gate

workflow child 使用公共 AgentManager 和 Pi SDK 会话，记录带 workflowId，恢复沿用原类型、模型、thinking、schema、工具选择与配置。结构化 child 的续接仍使用原 CompiledSchema 验证，并在脚本 realm 内解析为对象。它们由 workflow 自身的并发控制调度，不占普通前台/后台池，也不出现在普通 agents 列表和状态数量中。顶层 workflow child 的 ask_user 通过公共父级问答路径交给主会话；agent_send 可回答该问题，普通引导与会话恢复由 workflow 控制。

gate 使用公共 JobManager 的 pipe 执行、Pi shell 解析、cwd、所属会话和 workflow creator，默认期限 10 分钟，启动后关闭 stdin。stdout/stderr 保存在 job 日志中，结果使用共享有界读取规则；失败作为 agent 进度错误返回，保留已经发生的 child 用量。gate 不进入普通 jobs 列表、状态数量与结果通知，可从 workflow 详情读取日志。

停止、跳过、重试和 quit 使用同一 child/job 取消路径。JobManager 按本次传入的 run/workflow ID 与 ancestors 确定清理范围，累计关闭的 creator 仅用于拒绝后续准入；同级运行的 job 不进入本次清理结果。运行的终态通知在 Worker 终止、child 与所属 job 清理、结果写入和快照保存后发出；清理未确认或写入失败显示错误。

## 保存资源

按名称读取 `.js` 的优先级为项目 `.pi/workflows`、项目 `.agents/workflows`、用户 `<agentDir>/workflows`、Pi 已安装包声明的 workflows。项目目录与项目包受父级项目信任约束，packageWorkflows 使用共享 packageResources 的包门控。名称最长 128 字符，使用字母、数字、点、短横线和下划线，以字母或数字开头。

保存列表只显示带 `export const meta` 声明的 JavaScript。按名称找到高优先级同名文件后，缺少 metadata 明确报错；读取失败也报错。scriptPath 相对 workflow cwd 解析；script、scriptPath、name 必须恰好提供一项。命名的嵌套 workflow 使用同一资源解析与信任规则。仅提供 workflow/agent 资源的 Pi 包使用标准 manifest 的 `pi.extensions: []` 声明无扩展；没有 extensions 声明时，Pi 按默认模块入口解析包目录。

## 持久化与通知

每次运行在 `<agentDir>/pi-suite/agents/workflows/<ownerSessionId>/<wfId>/` 保存 script.js、journal.jsonl、run.json 与 result.txt。准入 Worker 前先写脚本副本、空 journal 和初始快照。WorkflowStore 使用公共 JsonStore 的锁内重读与原子保存，I/O 失败不切换为内存存储。

父级 `pi-suite:workflow-record` 保存归属、状态、进度、路径、消费标记与 child 引用。完整 child 会话、工具结果和结构化正文从公共 SDK 会话读取。进程外恢复时，结束快照按结束时间选择当前记录；缺少进程执行 owner 的活动快照显示 failed，journal 可显式重放。

共享 wait 接受 wf_ ID；goal_wait.waitFor 也接受 workflow。结果只有所属主会话与当前分支可见，离开期间的结果在该 owner 再次绑定时进入统一通知。wait 消费结果后撤销该通知，消费标记写入父级记录；通知摘要附 result.txt 的 read 路径。

[返回 Workflow](index.md)

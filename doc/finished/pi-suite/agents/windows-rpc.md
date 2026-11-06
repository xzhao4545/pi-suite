# Windows 原生 CLI 跨扩展 RPC 阶段

Windows Node 24.22.2、Pi 1.5.0 和 ConPTY 使用隔离资源、离线 provider 与独立 consumer 扩展验收。consumer 仅使用公开 pi.events 请求和生命周期事件，不导入本包内部 API，也不使用 SDK 测试宿主。实际 CLI 显式加载 consumer 在本包前、后的两种次序，均收到 ready；原生命令验证 ping 协议版本为 2，以及 spawn、steer、consume 和 stop。

目标 cwd 的真实 child 使用原生 read 读取仅目标目录存在的文件；consumer 的 child session_start 记录实际 cwd 为目标目录、isProjectTrusted 为 false。目标 `.pi/extensions` 的写入标记没有出现，目标资源未借用父级信任。类型 frontmatter 显式选择 consumer 路径用于观察 child，未将父 CLI 的临时扩展入口假定为 child 默认资源。

活动 child 收到 RPC steer，后续实际 provider 请求包含该输入。StructuredOutput 返回验证后的 JSON；生命周期 completed.result 精确保存该 JSON，之后模型的结束正文没有替换结果。consumer 在 completed/failed 监听器同步部分直接发 consume，再重复消费也成功。两种加载次序的 provider 请求均仅来自目标 child，没有公共结果通知唤醒父模型。

每个原始 requestId 只记录一份回复；`/reload` 后 ready 重新到达，ping 和再次 spawn 均正常。RPC stop 与 reload 后的 `/quit` 各中断一个持有真实 Node job 的 child，使用隔离用户配置中完整命令的精确允许规则。两个 CLI 均自然退出码为 0；四个 job 保存 stopped 与 managed_scope_confirmed，独立 CIM 查询确认其全部记录进程范围均不存在。

## 实际业务扩展

同一 Windows/Pi 版本显式加载本机安装的 `@tintinweb/pi-tasks 0.9.1`，分别以业务扩展在本包前、后的顺序运行实际 CLI。保留业务扩展原有 TaskCreate、TaskExecute、TaskOutput、TaskStop 和 RPC 监听逻辑，仅使用隔离任务文件及离线 provider 控制 child 请求；没有以临时 consumer 代替业务实现。

TaskExecute 启动的 child 进入真实 SDK 请求；活动 run 跨 `/reload` 保持 ID 和执行，重新注册后业务扩展接收 completed，TaskOutput 返回 completed 与精确 child result，公共 run 标记 consumed。随后创建另一任务，TaskStop 中断请求并返回 stopped，Suite run 记录为 stopped，没有残留 running run。两种次序均观察到 ready、created、started、completed/failed 与 disposed，CLI 自然退出码均为 0。

pi-tasks 将 TaskStop 后的任务状态记为 completed，Suite 的执行状态仍为 stopped；二者分别表示业务任务状态与实际执行结算。pi-tasks 的上述工具不暴露 steer、跨 cwd 或 StructuredOutput 参数，这些协议边界由前述独立公共 consumer 验证。此阶段证明该安装版本的真实业务启动、结果消费、停止与 reload 组合，不推及任意业务扩展或远端模型服务。Linux 对应阶段见 [独立扩展 RPC](rpc-cli.md)，稳定协议见 [跨扩展 RPC](../../../current/agents/rpc.md)。未增加源码或永久测试。

[返回完成索引](../../index.md)

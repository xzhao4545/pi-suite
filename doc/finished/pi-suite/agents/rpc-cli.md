# 实际 Pi CLI 独立扩展 RPC 组合阶段

Linux 使用真实 Pi 1.5.0 发布 CLI、JobManager PTY、本包与离线 provider，显式加载独立 consumer 扩展。consumer 只通过公开 pi.events 和结构化契约调用，不导入本包内部类或测试宿主。真实 `/rpc-check` 命令验证 ping、spawn、steer、consume、stop；consumer 在本包前后加载的两种次序均收到 ready，ping 为协议版本 2，reload 后注册和调用正常，每个 requestId 只有一次回复。

指定目标 cwd 的真实 child 用原生 read 读取仅目标目录存在的文件，实际 cwd 正确、项目可信状态为 false，目标 `.pi` 扩展未执行。类型 extensions 显式声明 consumer 路径以观察 child；父 CLI 的临时 `-e` source 按配置资源契约选择，不自动加入 child 默认资源。

活动 child 收到真实 steer，后续 SDK 请求包含该输入；StructuredOutput 验证后的生命周期 result 为预期 JSON，结束正文没有替换结构化结果。consumer 在完成事件同步部分 consume，重复消费成功，未唤醒父模型。stop 及 reload 后的 quit 均中断真实 child，清理其创建的受管 sleep 进程，CLI 自然退出码为 0。

本阶段验证受控独立 consumer 的实际公开协议组合，未发现产品缺陷，未新增源码或永久测试；不代表任意第三方业务扩展或 Windows 集成都已验收。稳定协议见 [跨扩展 RPC](../../../current/agents/rpc.md)，基础范围见 [RPC 基础阶段](rpc-core.md)，未完成组合见 [扩展待办](../../../todo/pi-suite/agents/extensions.md)。

[返回完成索引](../../index.md)

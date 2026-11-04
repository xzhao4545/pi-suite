# 统一执行任务管理

目标：融合交互 shell 和非交互后台任务，共用管理、日志与通知。

当前状态：待实施；项目已有扩展骨架，本专项业务能力尚未实现。

影响范围：JobManager、pipe/PTY 后端、工具入口、日志和任务元数据。

约束：pipe 与 PTY 保持各自语义；Windows 控制代码不能视作 Ubuntu 支持。

相关当前文档：[项目当前状态](../../../current/index.md)。

## 任务列表

- [ ] 统一任务元数据、日志和通知入口
- [ ] 实现 pipe 与 PTY 两种执行模式
- [ ] 实现输入、查看、attach/detach 和停止
- [ ] 保留已结束 job 历史及起止时间、耗时，向共享状态栏提供活动数量
- [ ] 分别验证 Windows 与 Ubuntu 平台后端

## 验收方式

核对日志、输入、终端缩放、退出码和任务归属；两个平台分别验证。

## 关联计划

- [同进程保活](session-lifecycle.md)
- [跨进程保活](persistent-runtime.md)
- [架构与发布](../architecture.md)
- [运行记录与手动控制](history-control.md)

## 6. jobs：融合交互 shell 与后台执行

统一 JobManager，但保留两种执行模式：

| 模式 | 使用场景 | 输出/交互方式 |
| --- | --- | --- |
| `pipe` | 构建、测试、批处理、日志采集 | stdout/stderr 文件与分页读取，不模拟终端 |
| `pty` | REPL、交互程序、需要 TTY 的命令 | PTY、终端尺寸变化、输入、attach/detach |

job 元数据统一包括 ID、workspace、ownerSession、可选 taskId/agentId、mode、status、创建/开始/结束时间、耗时、退出与停止/清理信息、输入记录和日志位置。通知按照原会话和分支引用投递；切换到其他会话不会把旧任务结果误发给新模型。

保留已有常用工具名作为适配入口，内部走同一个 manager。新功能可以集中到 `job_start/list/read/write/attach/detach/stop` 这样的接口，但第一版不要求一次性删除所有旧调用方式。

平台后端：Windows 使用经过实际验证的 ConPTY 兼容 PTY 提供者和 Windows 进程停止实现；Ubuntu 使用原生 PTY 和 POSIX 进程组。`pi-background-jobs` 的 Windows 控制代码不能直接当作 Ubuntu 支持。

运行中和已结束的 job 都可以查询和查看；命令、输入、输出、时间与退出结果按需读取，手动停止保留历史，detach 或关闭查看器不终止执行。完整契约见 [job 记录、输入输出与手动控制](history-control.md)。活动数量由 manager 提供给 [共享状态栏](../status.md)，不由独立 widget 各自计数。

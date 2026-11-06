# Windows 原生两级任务与并发 child 组合

Windows、Node 24.22.2、Pi 1.5.0 下，实际 Pi CLI 通过 zigpty ConPTY 启动原生 pi-suite，使用 SDK 自带离线 provider 驱动真实 child 会话。验收使用隔离 cwd、agentDir 和持久会话，不读取用户模型凭据。

## 原生任务操作

清单包含两个父组，首组四个子任务：两个执行项、一个依赖未完成执行项的 blocked 项、一个已完成项。初始 Dock 显示 `1/4 todo · blocked 1`；完成筛选与折叠不改变分母。

40×24、60×30、120×40 三种 ConPTY 尺寸分别使用 `/tasks 1` 打开原生详情，经方向键与 Enter 执行折叠、展开、显示/隐藏完成项；未完成视图隐藏完成项，all 展开视图显示完成项，折叠视图保留父级摘要。Esc 返回后 Dock 保留 `> #1` 选组标记。两个 child 更新后重新打开原 owner 的详情，Dock 显示 `1/4 doing · blocked 1`，执行结算没有将任务自动改为 done。

## Owner、fork 与恢复

两个真实 SDK child 同时启动并等待独立执行门，随后各自调用 task_edit 更新 #2、#3。运行期间主会话执行实际 `/reload`，再由 Pi 原生命令上下文 fork 当前叶子。释放 child 后，两项更新均保存在原 owner 清单；child 的 ownerSessionId 和 taskId 未改变，fork 清单逐字保持播种快照。

已结束前台 child 经 Manager 的十分钟回收入口释放 Execution 后，实际 CLI 切回原持久会话并恢复其中一个 child。恢复保持稳定 agent ID、taskId 和原 TaskStore，分配新 runId；恢复的 task_edit 只更新原清单，fork 文件仍逐字不变。原生详情与 Dock 能读到恢复后的 doing 状态和进度。

两次实际 CLI 均通过 `/quit` 自然退出，退出码为 0。此专项补充原生界面和真实执行的组合证据，不以重复运行已有存储/SDK 单项测试代替验收；实现未发现需要修复的缺陷。

持久目录、fork/workflow 引用和只读历史的同次组合见 [Windows 持久历史阶段](../agents/windows-history.md)。

[返回完成索引](../../index.md)

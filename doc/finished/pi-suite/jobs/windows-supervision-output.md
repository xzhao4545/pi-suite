# Windows 终端监督、输出与启动策略

2026-11-06，Windows、Node 24.22.2、Pi 1.5.0、zigpty 0.1.6 ConPTY、Git Bash。实际 Pi CLI 加载本包与隔离的离线 Provider，模型通过真实注册工具启动、等待、读取、写入和停止 job；原生询问与终端视图使用实际键盘输入。Provider 只确定模型响应与请求时机，进程、日志、监督、权限询问、TUI 和结算路径使用当前实现。

## 监督与启动

- stream 的 literal、正则数值阈值、同一行去重、trigger 冷却与 detector 丢弃/改名均得到实际 events 日志；coverage 91% 不触发低于 80 的阈值，72% 触发，重复 ERROR 和冷却内第二条 WARN 不产生重复事件。
- poll-diff 比较实际完整命令轮次，状态从 idle 改为 ready 后产生差异；file-watch 无 command 启动实际监听进程，创建目标文件后产生 rename/change 事件。读取和停止使用同一 job ID。
- PTY hands-free 的定时增量更新实际发生 9 次，总投递字符为 45，没有超出单次/总预算；程序自然 completed。实际原生接管期间 updates 保持不变，模型 job_write 返回 USER_CONTROL；Ctrl+G 交还后模型输入进入同一程序。
- dispatch 仅等待最终结果，graceMs=1700、quietMs=400 的持有进程在宽限期后因静默终止；结果为 stopped、completionReason=quiet、updates=0，cleanup=managed_scope_confirmed。静默停止不解释为业务成功；停止结果等待清理，早于清理的列表快照可能仍显示 pending。
- 不匹配精确规则的命令显示原生 job launch 询问。Allow once 经选择及 Confirm 启动并自然 completed；Do not launch 返回 LAUNCH_DENIED；Esc 返回 started=false、LAUNCH_NOT_CONFIRMED 并结束该模型轮。只有允许命令产生 job 记录，拒绝和取消命令没有进程或历史。隔离用户配置中的精确 allow 规则用于其他实际监督命令，没有修改用户配置。

monitor 最终命令与用户级规则优先级、detector 授权、quiet/interval、总运行超时及停止竞争的组件契约与真实进程检查同时纳入 Windows 完整检查。原生询问取消与目标 waiting=user 的协调见 [Windows 询问组合](../ask/windows-combination.md)，实际 Codex/Claude 输入接管见 [Windows CLI 阶段](windows-cli-ui.md)。

## 大日志、UTF-8 与搜索

实际 pipe 程序输出 5000 行中文/emoji、一个约 205 KiB 单长行及独立 stderr，总 stdout 为 313938 字节。默认 job_read 返回头部、关键行及尾部，保留 HEAD_BEGIN、ERROR needle、TAIL_END 和 truncated 原始字节范围；省略提示明确要求 offset 或 search 读取中间区域。

257 字节预算的显式分页在完整 UTF-8 字符处结束，下一页使用返回的 nextOffset。两页拼接与原始字节对应区间相同，无替换字符、重复或缺失；不能将 offset+limitBytes 当作下一页起点。search 返回实际 ERROR 匹配及前后各一行，行号和原始匹配偏移保持；匹配长行末尾 LONG_END 后裁剪返回正文并标记 truncated，matches=1，不以裁剪后的前缀判断是否命中。stderr 读取返回独立哨兵。

自然 completed 后重复 job_stop 均为 requested=false，退出状态、原始日志及结果没有改写。100 MiB 多行/单行、匹配上限续读、预算及正则资源失败由 Windows 完整检查覆盖；此原生 CLI 场景的实际日志规模为上述 313938 字节。

## PTY 可见文本、当前与最后屏幕

实际 `/jobs` Attach terminal 中，程序显示密码提示，用户键入的回显在原始日志与 xterm 画面保留；模型 job_read 与终态 outputPreview 隐藏回显，密码输入日志只保留 sensitive 元数据。原生程序的 CR/CSI 横向重绘显示 FINAL_REDRAW 与 abcXYZ；备用屏幕中显示当前 ALT_CURRENT_SCREEN，返回主屏并自然退出后显示 MAIN_LAST_SCREEN 与 exit 0，finished 菜单可重新打开最后一屏。

全屏日志读取包含线性片段 ALT_LINEAR_FRAGMENT 和 fullScreen 提示；不声称还原二维历史。冷启动 CLI 从实际已结束 PTY 日志的密码字节中段执行 offset 页和 search，保持原始偏移、无密码匹配，input 读取也不返回密码正文；同一历史入口只有磁盘日志，没有 Attach terminal、View last screen 或 Stop job。Pi 退出后不恢复内存屏幕。

原生 `/jobs all workspace` 另读取受控导入的 stopped/cleanup=unconfirmed 历史：详情和日志可读，Clear history、Stop job、Attach terminal 和 View last screen 均不可用，退出后保存记录字节不变。该场景证明未确认历史的原生入口约束，不伪造一次实际清理失败；真实停止与级联范围消失见 [Windows 历史与交互](../agents/windows-history.md)。foreign agents 的只读所属 Jobs 与单独停止见 [Workflow 与 child 查看](../agents/windows-workflow-viewer.md)，正常历史删除确认见 [Windows 运行时阶段](windows-runtime.md)。

各实际 CLI 均自然退出码 0。稳定规则见 [执行任务](../../../current/jobs/index.md)、[PTY 监督](../../../current/jobs/hands-free.md) 和 [启动策略](../../../current/jobs/launch.md)。Cursor 实际 CLI 验收按用户要求移出本轮范围，收尾见 [Windows 记录](../windows-completion.md)。

[返回完成索引](../../index.md)

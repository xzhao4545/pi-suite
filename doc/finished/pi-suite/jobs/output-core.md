# 输出读取与真实 PTY 组合阶段

共享 reader 为 job/agent 提供默认截断、原始字节分页与搜索。关键行带前后各一行，truncated.keys 保存所选原始范围；正文、上下文与前缀共同计入搜索预算，超长返回行按 UTF-8 显式裁剪。实际 agent_read/job_read 的 more 提示保留 search/context/limitBytes；既有 14 项读取/SDK 聚合通过，未新增测试项。

1 项 Linux 真实 PTY 聚合通过，核对密码提示至 LF 的回显隐藏及跨原始 offset/search、CSI/BS/中文宽字素、重复两行计数和 fullScreen 提示；原始 output 日志保留实际字节，sensitive input 不保存正文。至多 2 KiB 的 outputPreview 在终态发布前捕获；既有真实 JobsModule 通知聚合核对预览与结果同条投递。

该范围使用 Pi 1.5.0、Linux Node.js 24。大单逻辑行的完整正则匹配仍需单行缓冲，内存/拼接性能尚未保证；垂直光标和任意全屏历史不提供完整线性屏幕还原。Windows、手机 SSH 与这些边界继续保留在 [输出待办](../../../todo/pi-suite/index.md)，本阶段不代表整个专项验收完成。

当前 reader、参数与操作见 [执行任务](../../../current/jobs/index.md#输出读取) 和 [公共工具契约](../../../current/runtime/tools.md)。

后续 [超长逻辑行阶段](long-line.md) 核对一次合并、完整匹配与 V8 资源失败，[屏幕范围阶段](screen-range.md) 明确垂直/全屏线性片段和同 owner 最后一屏；平台组合继续由输出待办管理。

[返回完成索引](../../index.md)

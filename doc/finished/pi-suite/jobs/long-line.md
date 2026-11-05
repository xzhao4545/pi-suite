# 超长逻辑行读取与正则资源边界

共享 runtime/read 的逻辑行分块累积，仅在 LF/EOF 合并一次；新块只扫描一次。完整 JavaScript 正则与关键行检测先求值，再按页面预算保存上下文；预览仅编码需要的前缀。job_read、agent_read、日志查看与完成预览继续复用同一 reader。

Linux Node.js 24.22.2 的 100 MiB 文件单行检查通过，覆盖全文起止锚定、未命中、中文跨块、空行、原始 offset 续读和默认关键行预算。新增 1 项聚合；单行组装成本为线性，整行缓冲与解码内存随最长逻辑行增长。

相同环境的 100 MiB 含中文单行与 `/^START.*END$/u` 复现 V8 正则栈资源失败。求值 RangeError 转为 REGEX_RESOURCE_LIMIT，报告失败行原始字节数与 offset、引擎原因及分页建议；整次搜索失败，完整匹配输入保持原样。任意正则不提供常量内存或执行时限保证。

真实 Pi SDK 的 job_read/agent_read 直接调用和原生工具执行管线均保留该错误，后者报告 isError:true；失败不消费 child 结果，不增加模型调用或父会话消息。job 的 100 MiB 日志由实际 pipe 进程生成；agent 输入注入真实已结束 child 的未消费记录，验证读取边界，不代表模型生成了 100 MiB 结果。同一全文普通正则成功后才消费 agent 结果，原始首尾分页保持 UTF-8 边界。

Pi 公共 read/truncate 与两个 jobs 上游没有可直接替代的完整 JavaScript 正则流式搜索器；rg 使用的正则语义不能替代该契约。本阶段只扩展共享 reader，不添加另一套日志或查询框架。平台组合见 [输出待办](../../../todo/pi-suite/jobs/output.md)，屏幕范围见 [PTY 屏幕阶段](screen-range.md)。

当前机制见 [工具契约](../../../current/runtime/tools.md) 与 [jobs 输出读取](../../../current/jobs/index.md#输出读取)。

[返回完成索引](../../index.md)

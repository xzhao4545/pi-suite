# Subagents：无闪屏导航与自适应信息栏

## 闪屏根因

- `src/ui/browser.ts` 的 [ ] 最终调用页面 select；`src/agents/ui/index.ts` 的 select 设置 next 并调用 done。
- 原版 Pi 的 custom done 先 hide 自己的 overlay、恢复可用焦点并请求绘制，然后返回结果；showSubagents 的循环随后才创建下一页。键盘路径的立即绘制与这段异步交接之间可能出现没有子页 overlay 的主会话中间帧。
- `showRuns` 从列表进入消息历史也先结束 browse，再调用 showAgent；workspace discover、动态模块和页面构建还会扩大间隙。
- withReadingScreen 主要覆盖已进入的消息历史阅读链，不覆盖整个 root 页面切换；背景 cover 在下一次 openReading factory 中才取得 TUI，因此不能保证列表关闭到首个历史页面打开的交接。空白背景也不能替代旧页面连续呈现。

这是页面生命周期交接问题，不应通过隐藏/销毁主 footer、终端 clear、延时重绘或修改宿主来修补。

## 建议方案

扩展共享 reading 框架的导航会话：root tabs、列表/消息历史、所属 Jobs、详情和选择器统一继承交接作用域，保留各页 BrowseState、reader、查询与选择。

采用稳定阅读宿主或两阶段 overlay 交接：旧页完成选择后冻结其自有画面/输入，直到新页准备并挂载才释放交接画面；正常退出才恢复主会话。交接只缓存 Suite 自己的最后一帧，不复制私有主 layout root，也不创建第二份正文滚动状态。组件订阅、Editor、reader 回调按实际 owner 清理，不能让旧页 dispose 清除新页共享 reader 的回调。

继续使用公开 ctx.ui.custom/showOverlay/OverlayHandle/onHandle 管理自己的层级，保留普通/全屏预算、构造失败及退出的焦点恢复。不仅添加空白覆盖层；新页异步加载时也应保持旧页可见，防止主会话闪回或空白闪烁。

验收必须检查切换过程的每个实际输出帧：快速 [ ]、列表进入历史、返回、延迟加载与 resize 均不出现主会话；仅最终页面存在不能证明无闪屏。

## 信息栏空行根因与方案

`agentInformation` 已按宽度返回一行或两行；`src/ui/details.ts` 却把 informationRows 固定为 3（分隔线+两行），并用 readingWindow 补齐。因此一行状态信息也被补上一个空行。

由共享 DetailsView 按实际一/两行元信息决定预算，空出的一行归还正文；不是只过滤空字符串。阅读位置会随 viewport clamp/follow-end 改变，需先测量正文、结算视口再确定信息栏和输出切片，避免重复渲染整份 Transcript 或切换 1/2 行后位置错乱。完整全屏输出仍按 readingRows 填足；消除的是信息区内部多余行，而不是缩短整体 overlay 导致主 footer 露出。

## 任务列表

- [x] 在共享 reading 导航实现连续交接，选择器继承同一作用域，不用页面私有绕行或宿主 patch。
- [x] 验证页间间隙、异常/正常退出、当前输入/焦点与旧/新组件 dispose 的边界。
- [x] 动态预算元信息行数，保留分隔线与窄屏必要的第二行，将余行回收为正文。
- [x] 验证真实 CLI 中间帧以及首次末尾/暂停/End/搜索/Editor/resize，复用现有聚合。
- [x] 同步 UI、Agents 和终端操作说明，实施后归档结论。

[当前 UI](../../../current/ui/index.md) · [子代理操作](../../../current/agents/operations.md) · [终端边界](../../../current/ui/terminal.md) · [返回专项](index.md)

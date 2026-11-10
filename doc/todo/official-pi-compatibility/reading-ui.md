# U1：公开组件与键盘优先阅读

## 决策、优点与代价

用户选择 U1，不采用 U2 的有限鼠标适配，也不因 U3 的完整原生交互目标而等待或维护定制宿主。

优点是普通插件分发、宿主依赖最少、交互维护范围明确。代价是插件承担自身正文预算/裁剪，不保证 overlay 与宿主 viewport 完全同构；完整原生 scrollbar 的 hover、轨道、拖动、capture 和复杂嵌套鼠标命中不在交付范围。

本页是待实施方案，现有源码仍使用 patched 原生布局和鼠标链；当前文档中的交互说明尚不能据此改成 U1 已生效。

## 共享框架与组件职责

变更集中在 `src/ui` 的 Browser、Details、Scroll、Transcript、reading scope 和共享选择器；Agents、Jobs、Tasks、Ask History、workflow 复用这一框架，不为每个页面单独造阅读系统。

- 原版公开 VStack/HStack/Container、ScrollView、Text、Editor、Input、SelectList、SettingsList 可按用途复用。
- 根视图根据终端实际 rows/columns 显式分配正文、chrome、metadata、actions、search 和 Editor；各区计入同一高度预算。
- 使用公开滚动方法或既有插件 reader 状态确定正文窗口；仅有一个权威偏移，不再同时维护宿主补丁偏移和插件影子偏移。
- 不复制私有主 layout root，不新增终端 renderer，不接管 stdout，不把宿主源码搬入插件。
- 不依赖新增 renderLayout/dispatchLayoutMouse、prepareLayout/renderAfterLayout、overlay.height 或补丁 dispose；具体方法以官方公开声明为准。
- 自有资源按现有阅读作用域管理，复用统一订阅、焦点和关闭边界，不另建全局安全/回退系统。

## 保留的功能契约

### 工具和展示

- Pi 原生工具组件负责状态背景、外壳及单层 padding；插件仅提供正文。
- 调用、partial、final 的摘要接替保持单份，完整错误始终可读。
- 敏感输入、结构化展开、原始历史及 child renderer 的职责不变。
- 保留已有键盘工具展开入口和完整结果阅读。不为替代鼠标临时添加未经确认的键位；确需操作变化时同步模块操作文档。
- 文本精简只影响展示，不删除原文、错误或权限信息，不改变只读准入。

### 阅读状态

- 首次打开运行中、结束或只读 run 时只初始化一次到末尾。
- 向上阅读、暂停、搜索、返回子页、结算后保留位置与查询；End/已有跟随操作显式恢复跟随。
- 新输出由记录 revision 或实际日志字节增长判断，不以工具展开、resize 或测量高度增长判断。
- 内容 clamp 只校正合法位置，不悄悄恢复 following。
- 复用稳定 entry/tool renderer，展开或 resize 不重新解析整份历史，不进行全文件高频扫描。

### 全屏、焦点与 footer

- 原版 top-left overlay、width/maxHeight 与零 margin 配合终端行数预算，短正文也填充到阅读覆盖范围。
- 背景阅读作用域覆盖异步子页间隙；隐藏 Editor 不继续收到输入。
- 不替换、销毁或另造 footer。关闭后恢复原实例、最新内容与焦点。
- resize 更新各区预算，不能只给正文更多行而漏算底部 Editor 或 action 行。
- 关闭、构造失败和往返时释放自有计时器、订阅、焦点和 overlay lease；不停止 child/job，不切换执行归属。

### Jobs 与其他消费者

- pipe 日志保留逐流、有界字节窗口、搜索、暂停与补读。
- PTY 继续使用 xterm 二维屏幕及真实输出区尺寸，接管、交还、离开和重新接管契约不变。
- PTY 本身的终端交互不是复杂阅读 overlay 的鼠标保证；不能因 U1 去掉 PTY 能力或把屏幕转成线性日志。
- Ask History、workflow 详情与共享选择器继续使用统一预算和关闭流程。

## 明确不保证的能力

- 不保证阅读 overlay 的完整原生 scrollbar 绘制与拖动。
- 不保证非零偏移、嵌套/分栏工具的鼠标单项展开。
- 不为弥补这些能力新增坐标猜测、文字扫描命中、自绘 scrollbar 或平行鼠标分发系统。
- 原版主会话或具体公开组件自身已有的鼠标行为不主动禁用，也不据此宣称整个查看器支持复杂鼠标。
- regular 模式的终端选择、复制和 OSC 8 行为按实际宿主/终端能力验收；不劫持未处理的输入或复制通道。

## 验收与任务列表

- [ ] 获得实施授权后替换共享布局、偏移和生命周期调用。
- [ ] 对照 Pi 原生工具壳核查正常/错误背景、单层 padding、摘要接替与敏感边界。
- [ ] 官方 CLI 下验证 Dock、列表/详情、搜索、工具键盘展开及原生 Editor。
- [ ] 用代表尺寸 40×24、80×30、120×40 和一次动态 resize 验证正文/底部预算，不做无目的组合。
- [ ] 验证首次末尾、暂停/搜索/子页返回、结算保留与 End 恢复；展开和 resize 不误触发跟随。
- [ ] 验证短正文、异步子页间隙、退出/构造失败的 footer 覆盖与实例/焦点恢复。
- [ ] 核查 pipe 逐流阅读和 PTY 二维尺寸、接管/交还，执行及通知 owner 不变。
- [ ] 删除或调整把补丁鼠标/scrollbar 当必需能力的断言，保留键盘和生命周期风险检查。
- [ ] 实施后同步 Agents、Jobs、Tasks、Ask、workflow 及终端操作文档；未实施前不宣称键位/能力已经变化。

[返回专项索引](index.md) · [当前 UI](../../current/ui/index.md) · [当前终端操作](../../current/ui/terminal.md)

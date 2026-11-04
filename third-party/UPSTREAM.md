# 上游来源

下表记录核对过的版本。npm 发布元数据、tarball integrity 和已提供的 gitHead 固定在 [sources.json](./sources.json)；没有 gitHead 或 repository 的来源保持空值，不推测其提交或仓库。

| 包 | 核对版本 | 源仓库 |
| --- | --- | --- |
| pi-ask-user | 0.17.2 | https://github.com/edlsh/pi-ask-user |
| @tintinweb/pi-tasks | 0.9.1 | https://github.com/tintinweb/pi-tasks |
| pi-interactive-shell | 0.18.0 | https://github.com/nicobailon/pi-interactive-shell |
| @narumitw/pi-goal | 0.54.15 | https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal |
| @tintinweb/pi-subagents | 0.23.0 | https://github.com/tintinweb/pi-subagents |
| pi-background-jobs | 0.1.3 | npm 发布元数据未提供仓库，以发布包为核对来源 |

## 实现来源与更新

ask_user 以 pi-ask-user 0.17.2 的参数与 response/details 契约为来源，交互在 src/ask 与共享 src/ui 中重构；保留其 [完整 MIT 许可证](./licenses/pi-ask-user.txt)。没有串联加载其独立 UI、设置或旧作用域兼容逻辑。

其他五个业务扩展目前作为设计参考，尚未导入其实现。pi-starship 0.65.2 仅用于外部 footer 契约参考，不是本包依赖。导入其他模块时同步记录路径、许可证及具体重构边界。

更新时先取得指定版本的 npm 发布包，与登记的 tarball integrity 对照来源；检查工具契约及公共宿主 API 差异，局部吸收所需改动，更新 sources.json、许可证及本登记，再运行对应契约与宿主检查。来源校验用于确保版权和基线可追踪，不以构建产物哈希代替功能验证。

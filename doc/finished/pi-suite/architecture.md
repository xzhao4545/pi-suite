# 扩展包架构与发布

目标：确定单包模块化结构、配置边界和上游来源维护方式。

当前状态：单包唯一入口、按真实会话目录的模块准入、公共布局、会话绑定、通知协调、统一工具/命令注册与配置优先级已实现；上游版本、许可证及逐文件改造边界已登记。首次 session_start 与 reload 的模块开关通过 Linux 真实 SDK 检查，稳定事实见 [公共运行时](../../current/runtime/index.md)；业务模块的平台组合验收由 [实施计划](design/implementation.md) 管理。

影响范围：src/index.ts、公共 ui/runtime 模块、包配置与来源记录。

约束：遵循统一框架和模块边界；不添加多语言支持。

相关当前文档：[项目当前状态](../../current/index.md)。

## 任务列表

- [x] 确定唯一扩展入口与模块开关
- [x] 实现共享布局、会话绑定及通知协调边界
- [x] 记录导入版本、许可证及更新方式，按 [上游导入](design/upstream-import.md) 逐文件登记
- [x] 统一工具、命令、快捷键注册和配置优先级，工具按 [统一工具设计](tool-design.md)

## 验收方式

逐项核对包结构、配置与注册职责；上游版权及来源可追踪，依赖版本和加载列表明确。

## 验收结论

唯一入口与来源登记完成；首次真实 session_start 的模块准入通过 1 项 Linux（Node 24.22.2）SDK 聚合检查。覆盖 process.cwd 与 ctx.cwd 不同、项目模块覆盖、工具/命令与手动 active-tool 选择、首次 mentions 初始化、new/resume/fork/tree 重绑与 reload 重新准入；child 的 configCwd 保持 owner 项目、cwd 保持目标工具目录。goal 模块未实际创建时，绑定、重绑、reload 与 quit 保留其他 provider 的共享 goal 键；ownership 沿本次模块集合。全禁用模块的 reload 保留既有 job、SDK child 和 workflow Worker，quit 等待已注册 owner 的真实结算与清理，不创建新 owner。平台与完整业务组合由 [实施计划](design/implementation.md) 管理。

## 关联计划

- [上游基线](design/upstream-baseline.md)
- [上游导入](design/upstream-import.md)
- [统一工具设计](tool-design.md)
- [统一界面](design/ui.md)
- [实施与验收](design/implementation.md)

## 1. 推荐交付形式

采用 **一个仓库、一个可安装的 npm/Pi 扩展包、内部按职责拆分模块**。

第一版不单独发布六个 fork，不把六个原扩展直接串联加载。将需要的上游代码作为可追踪来源导入，并围绕共享界面管理和运行时管理重构。用户只安装一个包；各模块可以通过配置开关启用。ask 与 goal 已按上游契约重写；tasks、jobs、agents 以上游源码按文件导入改造，处置清单与目标子目录见 [上游导入](design/upstream-import.md)，下方为模块级结构。

开发包名为 `pi-suite`，package.json 的 Pi extensions 只声明 `src/index.ts`，private 为 true；上游独立扩展不串联加载。

```text
src/
  index.ts                     # 唯一扩展入口，首次真实 session_start 按 ctx.cwd 注册功能
  ui/
    dock.ts                    # 所有本包常驻面板共用高度预算
    status.ts                  # 发布 goal 状态、agent/job 活动数量与显示去重
    details.ts、scroll.ts       # 详情操作、搜索与阅读位置；临时界面沿用状态
    transcript.ts              # 复用 Pi 消息组件的会话查看器
  runtime/
    binding.ts                 # 当前会话绑定及撤销
    notifications.ts           # 合并通知、去重、请求下一轮
  ask/                         # 用户询问、历史/回答焦点与超时策略
  tasks/                       # 两级任务管理与数据存储
  jobs/                        # interactive-shell + background-jobs
    backends/                  # Windows / Linux，PTY / pipe
  goal/                        # 目标状态、预算、续跑策略
  agents/                      # subagent 管理与原生会话查看
third-party/
  UPSTREAM.md                  # 包版本、仓库、提交/发布来源、改动记录
  licenses/                    # 上游许可证
```

这里的共享模块是解决实际冲突所需的少量协调代码，不另建通用插件平台或复杂工作流框架。未来只有出现明确的独立安装需求，才将某个模块拆成独立包。

## 9. 来源、兼容和发布策略

已核对六个发布包均声明 MIT；实际导入代码时保留版权声明和完整许可证。

分别记录 npm 包版本、tarball integrity、源仓库和实际导入提交。单仓库可以导入多个上游来源；没有必要为了安装一个自定义包而在 GitHub 创建六个独立发布 fork。需要持续吸收上游更新的模块可使用 subtree 或来源目录加补丁记录。

`pi-background-jobs@0.1.3` 发布元数据没有 repository 字段；不能编造其源仓库。先以 npm 发布包作为来源，后续找到真实仓库再补充。

同名工具、命令、快捷键和编辑器注册由本包统一负责。安装本包后应从用户实际加载列表移除对应原扩展，防止工具重复注册和多个面板同时出现；本包未启用的功能才保留原扩展作为可选替代。

settings 统一为用户级默认值加当前 ctx.cwd 的项目级覆盖，包括模块开关、面板高度、询问默认超时和 job 退出策略。首次真实 session_start 创建本次激活的模块集合；/reload 按当前会话目录创建新激活，new/resume/fork/tree 只重绑并沿用本次模块集合。mentions 初始化与资源/schema 刷新在同一 bindSession 完成。模块开关不改变既有执行 owner 的生存期，quit 查询当前 agentDir 已注册的 jobs/agents/workflow 并等待真实清理，不因模块全关闭遗漏，不创建新的 manager/registry；避免每个模块再发明一套独立优先级。依赖锁定经验证的版本，不使用无范围的 `*` 承诺兼容所有未来宿主。

goal 增加 status/dock/hidden 显示选择，默认复用 Pi 状态发布接口，不接管 footer；pi-starship 作为可选的外部状态栏扩展保留，不纳入本包 fork 或运行依赖。联动契约见 [goal 状态栏联动](design/goal-status.md)。

agents/jobs 复用相同显示取值，由共享入口合成活动数量状态；运行记录、持久历史和手动停止分别归 AgentManager 与 JobManager，ui 不持有进程控制权。公共契约见 [状态栏摘要](design/status.md)、[子代理运行记录](agents/runs.md) 和 [job 记录](design/jobs/history-control.md)。

用户已明确不添加多语言支持。本包不引入 locale 配置、翻译表或语言切换；界面沿用现有固定文案，问题、说明和回答继续按原文显示。

[返回已完成专项](../index.md)

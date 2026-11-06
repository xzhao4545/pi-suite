# 完整 Starship footer 联动阶段

目标：通过实际发布入口验证共享状态与外部 footer 组合，明确窄屏和状态槽位的真实边界。

## 完成项

- [x] 固定 @narumitw/pi-starship 0.65.2 开发依赖及锁文件，tarball integrity 与 sources.json 一致；通过 Pi loader/Jiti 加载实际 dist，完整 MIT 版权保留于安装包 LICENSE/NOTICES。
- [x] Linux 真实 SDK 同时运行 goal_wait、两级 tasks、child、两个 job 和主级 AskView；40×24、60×30、120×40 核对行宽、共享 Dock/询问预算及 status 不重复进入 Dock。
- [x] 原生询问期间另一真实 job 完成不增加模型调用；实际 emoji 与 24 位颜色按外部配置呈现。
- [x] max_statuses=1 按扩展状态插入顺序截取，较早第三方状态可排挤 goal/runtime；disabled 和根 format 缺少 extension_status 时隐藏摘要，明确 goal.display=dock 可由公共 Dock 显示。
- [x] 40 列的整体 footer 自动换行多于 120 列；Pi 原生 footer 为两条基础行及可选一条扩展状态行，外部 footer 总高度没有可靠公共反馈。

1 项 Linux（Node 24.22.2）真实 SDK 聚合检查通过，终端尺寸由受控 fixture 提供。当前样例 footer、Dock 与询问总高度低于终端的 40%，该结论仅适用于已检查布局；任意用户 format 的高度由外部 footer 控制。Windows 和用户实际配置继续由 [goal 状态栏待办](../../todo/pi-suite/index.md) 与 [活动数量待办](../../todo/pi-suite/index.md) 验收。

Starship 为开发验收依赖，产品状态发布仍使用 Pi 公共 setStatus。稳定规则见 [统一界面](../../current/ui/index.md)。

[返回已完成专项](../index.md)

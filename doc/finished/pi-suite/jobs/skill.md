# jobs 技能发布阶段

包通过 pi.skills 声明发布 77 行的 pi-suite-jobs/SKILL.md，以上游 interactive-shell 技能与 references 为来源，按本包 job 工具、共享 wait、pipe/PTY、监督、授权、接管、读取、停止和主动历史清理适配；来源与完整许可证见 [上游登记](../../../../third-party/UPSTREAM.md)。

Pi 包资源发现独立于模块开关，技能先核对实际工具；jobs 关闭时通过可用的 ask_user 询问启用意愿或说明限制，不自行修改配置。

Linux 的技能格式校验与真实 Pi 包管理器、ResourceLoader、SDK 加载通过；原生 /skill 调用及 jobs=false reload 后保留 ask_user、撤销 jobs 工具的行为通过。该结论覆盖技能发现与调用，Windows/手机终端组合仍由 [jobs 待办](../../../todo/pi-suite/jobs/index.md) 验收。

当前入口见 [执行任务](../../../current/jobs/index.md)，技能正文见 [pi-suite-jobs](../../../../skills/pi-suite-jobs/SKILL.md)。

[返回完成索引](../../index.md)

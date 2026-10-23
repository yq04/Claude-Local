# tests/
> L2 | 父级: ../CLAUDE.md
network.html: 网络页独立 Vite 测试入口，不进入生产构建。
network-fixture.tsx: 真实 VpsPanel、诊断调用记录和可显式释放的虚构 IPC；成功/部分失败/异常/空返回及原生复制拒绝开关，验证隐藏固定链接、复制失败/恢复、只在点击后诊断，无真实剪贴板写入、联网或导航。
identities.html: 独立 Vite 测试入口，生产 rollup 只含 index/browser，不打包本页。
identities-fixture.tsx: 真实 IdentityPanel/Cromma/Motion/TooltipProvider + Tauri 官方 mockIPC；40 个虚构账号、残留清单及可延期命令，官方 runCallback 发送有序 Channel 事件验证真实进度；覆盖不完整统计、部分失败、命令审计与切换/删除/恢复/双语，不读取本机账号或文件。
identities-fixture.tsx 在线扩展：固定合成额度/逐字段网页资料、可控失败与延迟，要求冻结expectedIdentity与目标指纹匹配；验证详情实际调用、按账号读取、请求中身份变化拒收、切号撤销前台开关与保留旧观测，不调用真实额度端点。
执行入口 ../scripts/test-identities-ui.ts 使用 Node.js 原生管道及临时 HOME/XDG/浏览器上下文、阻止外网、保留真实 DOM 输入；不采集截图或用户目录。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

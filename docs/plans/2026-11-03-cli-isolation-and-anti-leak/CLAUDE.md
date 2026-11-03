<!--
[INPUT]: Claude Code 官方网络与沙箱文档、4 个 GitHub 开源参考仓库（openai/codex-plugin-cc、anthropic-experimental/sandbox-runtime、Koushik890/jev-firewall、disler/claude-code-hooks-mastery）本地克隆源码审计、anthropics/claude-code Issues (#71177/#11660/#15212/#39862)、X 社区关于“Claude 调用 Codex 封号”与 CLI 漏 IP 案例交叉核验、Claude-Local v0.2.6 源码全链路审计。
[OUTPUT]: Claude Code CLI 日常使用中的浏览器调用路径、子进程派生（含 Codex 协同）、网络漏流机制的源码级结论与 P0–P2 优化方案。
[POS]: 调研与方案目录；指导后续 CLI 子进程防漏、双协议代理对等核验、全域名反漏规则与浏览器路由收口优化。
[PROTOCOL]: 更新本映射以反映新增或修改的文件。严守 AGENTS.md 红线（绝不中断运行中的 claude.exe、绝不盲写用户 ~/.claude.json、保持零后续阻断）。
-->
# Claude Code CLI 浏览器/子进程调用与 IP 泄露分析及优化方案

00-README.md - 调研范围、核心结论速览、开源借鉴来源与分阶段优化路线图入口。
01-FINDINGS.md - Claude Code CLI 调用浏览器与子进程（含 Codex）的完整源码路径、X 社区“Claude 调 Codex 封号”三层真相拆解、4 个开源项目核心机制拆解、Claude-Local v0.2.6 现存 6 项真实缺口（G1–G6）。
02-OPTIMIZATION-PLAN.md - P0–P2 分阶段优化实施方案（全域名反漏规则补齐、CLI HTTP 与伴侣浏览器 SOCKS5 双协议同端口对等校验、OAuth 跳转路由收口、CLI 代理与遥测收敛模板、可选 PreToolUse 守护 Hook）。

本目录不包含真实账号数据、个人工作站路径、真实 IP 地址、代理凭据或运行截图。

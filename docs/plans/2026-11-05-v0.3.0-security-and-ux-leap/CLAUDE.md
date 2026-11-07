<!--
[INPUT]: @MinLiBuilds X 推文抓包线索、本机 Claude Code CLI (v2.1.318) REA 二进制偏移级逆向取证、6 个开源标杆仓库（yetone/magpie、stablyai/orca、farion1231/cc-switch、realiti4/claude-swap、lbjlaq/Antigravity-Manager、jlcodes99/cockpit-tools）源码与二进制对标审计、Claude-Local v0.2.7 全链路源码审计。
[OUTPUT]: Claude Code CLI 八大类 35+ 外联域名全景表、6 项新发现高危/中高危缺口（V3-G1 至 V3-G6）、6 大开源项目借鉴矩阵，以及 v0.3.0 分阶段分批次（3 阶段 6 批次 + 复审精修阶段）实施蓝图。
[POS]: v0.3.0 大版本调研与分阶段实施方案目录；指导后续安全隔离、防漏风控、智能接力、续杯验真与交互动画跃迁。
[PROTOCOL]: 更新本映射以反映新增或修改的文件。严守 AGENTS.md 红线（绝不中断运行中的 claude.exe、保持既有归档/数据库/种子兼容、未获最终确认前绝不执行本地热更新/打包/上传）。
-->
# Claude-Local v0.3.0 深度调研、开源对标与分阶段跃迁方案

00-README.md - 调研背景、核心结论速览、开源对标总表与 3 阶段 6 批次推进路线图入口。
01-FINDINGS.md - `@MinLiBuilds` 推文逆向验真、`claude.exe v2.1.318` 八大类 35+ 外联域名全景图、6 大开源项目源码级拆解，以及 `Claude-Local v0.2.7` 现存 6 项真实缺口（V3-G1 至 V3-G6）。
02-IMPLEMENTATION-PLAN.md - `v0.3.0` 分阶段分批次（Phase 1–3 共 6 个 Batch + Phase 4 Review 复审精修）详细实施方案、文件职责划分、合同设计与定向测试验收清单。
03-REVIEW-AND-ROADMAP.md - `v0.3.0` 全量实施与二轮双子代理交叉审计报告（含 8 项二轮补漏对照表、前后端全量验证矩阵与后续打包/热更新待确认推进方案）。

本目录不包含真实账号数据、个人工作站路径、真实 IP 地址、代理凭据或运行截图。

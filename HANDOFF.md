<!--
[INPUT]: Verified 0.3.0 delivery receipts, current repository state and the owner's 0.3.0 local update, installer packaging and GitHub release request.
[OUTPUT]: Context-free task/status/next-step guide with exact delivery evidence and operational pitfalls.
[POS]: Repository root handoff; machine paths, PIDs, credentials and private probes stay in ignored .local/.
[PROTOCOL]: Archive this file and verify SHA256 before rewriting. Documentation-only commits never rebuild or move product tags.
-->
# Claude-Local 会话交接

更新日期：2026-10-24。本文件面向完全没有本会话上下文的新会话。先读本文、根目录 `AGENTS.md`、`CLAUDE.md`，修改具体模块前再读相应目录的 `CLAUDE.md` 和源码头部。

**当前事实：0.3.0 已完成源码提交、中性环境 NSIS 安装包打包、13 项私密探针审计、本机备份热更新以及 GitHub `v0.3.0` 正式发布（过往历史 Release 已按用户要求清空，仅发布单个 `Claude-Local_0.3.0_x64-setup.exe` 安装包）。没有发布阻塞，也没有需要继续运行的构建、上传或子代理任务。**

## 1. 我们在做什么任务

Claude-Local 是本仓库独立维护的 Windows x64 桌面产品，React/TypeScript 提供界面，Tauri/Rust 管理本机能力，Python 采集并写入额度账本。主程序 `claude-local.exe`，标识 `ai.local.claude-local`；伴生浏览器为 Claude-Local Browser。数据按用户保存在 `%APPDATA%/ai.local.claude-local`，普通启动不启动浏览器，只有用户动作或 `--browser` 才启动。

本会话承接 0.2.4 交付基线，按用户要求完成了四项核心升级并交付 **0.3.0**：
1. **自定义本地壁纸与 5 层光学级毛玻璃视觉系统（Scheme A）**：新增本地壁纸导入与主色调自动取色引擎（`src/wallpaper-store.ts`）、Rust 原生外观与壁纸持久化模块（`src-tauri/src/ui_appearance.rs`）、5 套一键主题预设、6 色强调色、5 种背景氛围及 3 维连续光学调校滑块（毛玻璃模糊度 `8px–40px`、面板不透明度 `45%–92%`、壁纸暗化遮罩 `0%–65%`）。
2. **活跃账号实时 Token/额度悬浮监控窗（Floating Monitor HUD）**：新增 Tauri v2 独立置顶无边框透明悬浮窗（`src-tauri/src/monitor_window.rs`、`src/floating-monitor.tsx`、`src/floating-monitor-model.ts`），支持一键开关与位置记忆，实时展示当前账号、CLI 运行状态脉冲（运行中 `2.5s` / 空闲 `8s` 自适应本地轮询，零后台网络请求）、5h/7d 剩余额度与重置倒计时、消耗速率与预计耗尽时间（ETA）、以及今日输入/输出/缓存/推理 Token 与最近 5 分钟 `tok/m` 实时流速，并支持主窗口与悬浮窗跨窗口实时同步主题、壁纸、毛玻璃参数与双语切换。
3. **四维防封号与防风控安全加固**：在 `src-tauri/src/windows_process.rs` 中对原生 `claude.exe` / `versions\X.Y.Z.exe` / `cowork-svc.exe` 仅使用 `PROCESS_QUERY_LIMITED_INFORMATION` 句柄并结合 `(pid, created)` 进程缓存，彻底消除 `PROCESS_VM_READ` 与跨进程内存读取；在 `scripts/claude_quota_online.py` 中对齐官方 Claude Code CLI 请求头指纹（`claude-cli/<ver> (external, cli)`、`anthropic-version: 2023-06-01`、`x-app: cli`）并新增 Cloudflare `/cdn-cgi/trace` 出口国家预检门禁。
4. **开源竞品生产力交互体验升级**：新增 5h/7d 额度消耗速率标签、残留清理分类筛选胶囊（全部/缓存/认证/历史/备份）、CLI 环境变量导出预览（PowerShell / Bash / JSON 一键复制）、用量分析 4 维 KPI 摘要卡片（缓存节省比、输出/输入比、日均 Token、活跃模型数），升级物理弹簧点击反馈、View Transitions 平滑切换与 UI/等宽字体栈设置。

## 2. 已经完成了什么

### 2.1 当前用户可见行为

- **身份与本地额度同步 + 悬浮监控窗（HUD）**：
  - 身份页顶栏提供「悬浮监控窗」开关按钮与「同步本地额度」主按钮。
  - 悬浮监控窗独立置顶显示当前活跃账号、5h/7d 剩余进度条与重置倒计时、消耗速率与预计耗尽时间（ETA）、今日 4 维 Token 统计及 5 分钟 `tok/m` 实时流速；所有数据100%源自本地账本与 `~/.claude/projects` JSONL 流式文件，零后台网络轮询。
- **自定义壁纸与 5 层光学毛玻璃设置（`软件设置 -> 外观与布局`）**：
  - 支持一键切换 5 套主题预设（羊皮纸经典、极光毛玻璃、落日琥珀玻璃、沙丘暖金玻璃、星云暗夜玻璃）、6 色强调色与 5 种背景氛围。
  - 支持上传本地 PNG / JPG / WebP / GIF 壁纸（自动等比压缩至 `<= 1920px` 并提取主色调推荐强调色），提供毛玻璃模糊度（`8px–40px`）、面板不透明度（`45%–92%`）与壁纸暗化遮罩（`0%–65%`）滑块，跨重启原生持久化至 `%APPDATA%\ai.local.claude-local\ui-appearance.json` 与 `ui-wallpaper.json`。
- **账号安全、防封号与环境防串号**：
  - 进程探测对原生 Claude 进程严格使用 `PROCESS_QUERY_LIMITED_INFORMATION` 句柄，零 `PROCESS_VM_READ`。
  - 手动在线校准请求严格携带官方 CLI 请求头指纹，并在请求前校验代理出口国家/地区。
  - 内置浏览器启动页遵循全局打码偏好；回环摘要支持 CLI 代理比对提醒；残留扫描检测系统级 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN` 环境变量覆盖告警。

### 2.2 0.3.0 交付基线与证据

- 产品源码提交和远端固定标签 `v0.3.0`：`4779be9cbf7d7a0924d28f5ae827bceb98aca480`。
- [GitHub 正式发布 v0.3.0 (Latest)](https://github.com/yq04/Claude-Local/releases/tag/v0.3.0) 已发布，过往所有历史 Release 与草稿均已按用户要求清理完毕，当前 Release 仅包含唯一安装包文件 `Claude-Local_0.3.0_x64-setup.exe`（`140,444,345` 字节 / `133.94 MiB`）。
- 安装器 `Claude-Local_0.3.0_x64-setup.exe` SHA256：`2447d00a052efa820f429078aedbe1b79f09440fe9dbf873ab1b7ab5f6a98e29`（GitHub 服务端原生资产摘要 `sha256:2447d00a052efa820f429078aedbe1b79f09440fe9dbf873ab1b7ab5f6a98e29` 完全一致）。
- 宿主 `claude-local.exe` SHA256：`3cc7d435a0028f9e2523e83526f38090dededb1e39044a846344de1fcc465149`。
- 独立资源审计 109 项、私密探针 13 项，零发现（`findings: 0`）。本机 102 个安装文件核验通过，13 个变更文件先备份后替换。
- 更新后版本（`0.3.0`）、唯一主窗口句柄、Rust 额度核心（`--quota-core`）检查通过。更新前后未停止任何 `claude.exe` 或浏览器进程（`missingClaudeCount: 0`）。

### 2.3 已执行的验证

- **前端与跨窗口同步单元测试**：`bun test` **21 个测试文件、106 项测试（9,370 断言）全部通过**；`bun run build` 与 `python scripts/browser_ui.py dist` 零错误通过。
- **窗口与侧栏多分辨率几何巡检**：`node scripts/test-usage-statistics.mjs --layout-only`（96/96）与 `--quick-only`（16/16）全部通过。
- **身份与额度 UI 专项回归**：`--online-only`（10/10）、`--quota-reset-only`（6/6）、`--cards-only`（26/26）、`--passive-only`（1/1）全部通过。
- **Python 与 Rust 原生测试**：`test-claude-quota-online.py`（31/31）、`test-claude-quota-local.py`（34/34）、`test-audit-windows-package.py`（9/9）及 Rust `monitor_window`、`ui_appearance`、`local_edition_tests`、`exact_arguments`、`passive_quota_revision` 全部通过。

## 3. 当前卡在哪、遗留什么、设计偏差

**没有交付阻塞。用户授权的 0.3.0 本地更新、安装包打包、历史 Release 清理与 GitHub 上传已全部完成。**

保留以下实际边界：
- 本机采用审计后的文件替换热更新，没有运行 NSIS 安装器。安装、升级、卸载和系统设置的实际修改验收只在一次性 Windows 环境执行。
- 额度代理仅支持当前明确实现的无认证 HTTP CONNECT；不支持的 HTTPS 代理、SOCKS 或代理认证明确拒绝，禁止静默直连。
- 工作分支为 `feature/functional-reliability-20261023`，同时已非强制推送到远端 `main`。保留用户已有的 `AGENTS.md` 修改及未跟踪的 `--help/`、`.planning/`、`.rivet/`、`docs/superpowers/`、`docs/plans/2026-10-22-identity-quota.md`、`p6b-i18n.json`、`TOKEN_MONITOR_RESEARCH_AND_PLAN.md`，不要顺手提交或删除。

## 4. 下一步计划与代码入口

1. 新会话先只读查看 `git status`、最近提交、版本清单、最终回执（`.local/last-local-update.json`）和用户最新反馈。
2. 当前无新增需求，停止在已交付状态。若用户继续提出新需求或反馈，按改动范围精准修改并运行对应验证。

核心源码入口：
- `src/floating-monitor.tsx`、`src/floating-monitor-model.ts`、`src/floating-monitor.css`、`src-tauri/src/monitor_window.rs`：独立置顶 Token/额度悬浮监控窗（HUD）与跨窗口状态同步。
- `src/wallpaper-store.ts`、`src/settings.tsx`、`src/settings-model.ts`、`src/style.css`、`src-tauri/src/ui_appearance.rs`：自定义本地壁纸、主色调自动取色、5 层光学毛玻璃与 Rust 原生持久化。
- `src-tauri/src/windows_process.rs`、`scripts/claude_quota_online.py`：零 `PROCESS_VM_READ` 进程探测、官方 CLI 请求头指纹对齐与 Cloudflare 出口国家门禁。
- `src/identities.tsx`、`src/identity-quota.ts`、`src-tauri/src/identities/profile.rs`、`scripts/claude_quota.py`：身份工牌、本地额度同步与 `reset_inferred` 到期恢复展示。

## 5. 需要历史细节时再读这些文件

- [0.3.0更新说明](docs/RELEASE_NOTES_0.3.0.md)、[0.2.4更新说明](docs/RELEASE_NOTES_0.2.4.md)、[0.2.3更新说明](docs/RELEASE_NOTES_0.2.3.md)：历次升级内容与验证边界。
- [开发说明](docs/DEVELOPMENT.md)、[分发与许可](docs/DISTRIBUTION.md)、`LICENSE`、`NOTICE.md`：独立产品、构建和第三方许可约束。

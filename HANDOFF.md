<!--
[INPUT]: Final owner decisions, released v0.3.0 source/tag c784588e206be85d7bcccda4eadec5cebab3e8dc, passing release-source CI (run 42357163813), audited NSIS installer (SHA256 8d2a56c93ebe7a2cf56a886bb00fcf78c4df2e7b46dbc934f7ee5a8b64f3e8d6), verified local payload deployment (host SHA256 cbe79fbde3cffa2544497d3cfc6a7cbfcc436c823094b787ce02edfce5dbb889, missingClaudeCount = 0), and 2026-11-06 Argon subagent pipeline & Claude CLI risk-control hardening.
[OUTPUT]: Context-free session handoff: project purpose, completed work (v0.3.0 full release & local update + Argon subagent & risk-control upgrade), current state, next actions and verified pitfalls.
[POS]: Root maintenance handoff. Real identities, emails, IP/proxy credentials, process IDs, browser seeds, private probe values, workstation paths and screenshots stay out of tracked files.
[PROTOCOL]: Back up and verify SHA256 before rewriting (backed up to .local/tasks/20261107-release-0.3.0/HANDOFF-pre-v0.3.0-closeout.md.bak, SHA256 6E86EDE8CF906F40F58451DA4C71F3ADA7FA2349834B8FD52713319AC57C3453). This handoff update is documentation-only: no build/deploy, account action, proxy reload, upload or release-tag movement.
-->
# Claude-Local 会话交接（HANDOFF.md）

更新时间：2026-11-07，America/New_York（EST）。

## 接手先读：30 秒速览当前状态

1. **主线一（`Claude-Local v0.3.0` 已完成深度补漏、开源机制融合、全量测试、中性 NSIS 打包、29 项隐私探针审计、本机无感热更新与 GitHub Release 正式发布）**：
   - 围绕 `claude.exe v2.1.318` 二进制逆向证据与 **6 个标杆开源项目**（`yetone/magpie`、`stablyai/orca`、`farion1231/cc-switch`、`realiti4/claude-swap`、`lbjlaq/Antigravity-Manager`、`jlcodes99/cockpit-tools`）源码级横向剖析，完成了 `v0.3.0` 全部 **3 阶段 6 批次** 开发及 **第三轮深度审查与开源精髓补强**。
   - **全量自动化测试 100% 零报错通过**：`bun test` **183 pass / 0 fail**（14,086 次断言）、`bun run build`（`tsc --noEmit && vite build`）**0 errors**、`cargo test --bin claude-local` **315 pass / 0 fail**、Python 核心合成测试 **80 pass / 0 fail**（包审计 9、资源 2、本地额度 34、在线额度 35），GitHub Actions [Windows source checks (`42357163813`)](https://github.com/yq04/Claude-Local/actions/runs/42357163813) 全套步骤（含 101 项 Python 与系统修改夹具）在临时 runner 全部通过。
   - **中性 NSIS 打包、29 项外置隐私探针审计、本机热更新与 GitHub Release 已全部交付**：
     - 发行标签 `v0.3.0` 固定到提交 [`c784588e206be85d7bcccda4eadec5cebab3e8dc`](https://github.com/yq04/Claude-Local/commit/c784588e206be85d7bcccda4eadec5cebab3e8dc)，[GitHub Release `v0.3.0`](https://github.com/yq04/Claude-Local/releases/tag/v0.3.0) 已于 `2026-11-07T09:03:17Z` 发布为 Latest；
     - 安装包 `Claude-Local_0.3.0_x64-setup.exe`（`140,860,505` 字节，SHA-256 `8d2a56c93ebe7a2cf56a886bb00fcf78c4df2e7b46dbc934f7ee5a8b64f3e8d6`）通过 109 文件白名单与 29 项外置隐私探针审计（0 发现）；
     - 本机 102 个应用文件（9 项更新）已完成 SHA-256 备份与热更新部署（宿主 SHA-256 `cbe79fbde3cffa2544497d3cfc6a7cbfcc436c823094b787ce02edfce5dbb889`），桌面主窗口已在交互式桌面启动，且全程零中断运行中的 `claude.exe`（`missingClaudeCount = 0`）。

2. **主线二（2026-11-06 完成：Claude Code CLI 内 `gemini-4-argon-medium` 子代理全链路取证、49 分钟假死根除、840K 上下文扩容与 Claude 风控加固）**：
   - 针对子代理输出截断、`PID=0 | LOG=` 假死与 `256,000 tokens` 早期触发内部摘要压缩问题，定位并修复了 **9 大技术瓶颈**：
     1. **Claude 风控漏口封堵（子进程出口 IP 分裂与遥测阻断）**：补齐 `~/.claude/settings.json`（及隔离配置目录）的 `"env"` 块，显式注入 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `GRPC_PROXY = http://127.0.0.1:7899` 及 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`、`DISABLE_TELEMETRY=1`、`DISABLE_ERROR_REPORTING=1`、`CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1`、`DO_NOT_TRACK=1`。
     2. **Magpie 路由组、`search_web 404` 修复与 10 秒互斥自愈拉起**：在 Magpie (`127.0.0.1:3425`) 中将 `antigravity` 提供商路由升级为 `usage`，配置 `group/argon-medium`、`group/argon-high`、`group/gemini-3.1-flash-lite-preview`，并在 `agy-safe.ps1` 中加入 `Global\AgySafeMagpieStartMutex` + 10 秒就绪轮询。
     3. **`agy-safe.ps1` / `agy-safe.cmd` 全面重构**：采用 `FileStream` + `FileShare.ReadWrite | FileShare.Delete` 共享流读取 `.output` 与 `transcript.jsonl`；`-WaitOutput` 单次等待设为 **90s** 并实时展示 `STEP=<N> | LAST_TOOL=<tool> | BRAIN_KB=<size>KB`；新增 `Global\AgySafeLaunchMutex`（间隔 `1.15s`）确保并发子代理绝不共用秒级 `cli-YYYYMMDD_HHMMSS.log`。
     4. **上下文自动压缩临界值从 `256,000` 扩容至 `840,000 tokens`（`agy-highcap.exe`）**：在不修改全局原版 `agy.exe` 的前提下，生成独立高容量副本 `<local-env>/bin/agy-highcap.exe`（等长替换为 `840000` tokens，实际压缩触发线提升至 `~714,000 tokens`）并注入 `AGY_CLI_DISABLE_AUTO_UPDATE=1`。
     5. **重写全部 5 个子代理提示词与内置 `$QualityGuardrail` 质量护栏**：禁止写盘后向 stdout 重复打印全文，强制分节增量 `write_file(Append: true)`、强制 `Read (limit: 90)` 分块精读与 `<8s` 并发辅助脚本。

3. **接手必读文档顺序**：
   - 第一步：读本文、根目录 `AGENTS.md` 与 `CLAUDE.md`；
   - 第二步：读 [`docs/RELEASE_VERIFICATION_0.3.0.md`](docs/RELEASE_VERIFICATION_0.3.0.md)、[`docs/RELEASE_NOTES_0.3.0.md`](docs/RELEASE_NOTES_0.3.0.md) 与 `docs/plans/2026-11-05-v0.3.0-security-and-ux-leap/`（`00-README.md`、`01-FINDINGS.md`、`02-IMPLEMENTATION-PLAN.md`、`03-REVIEW-AND-ROADMAP.md`）；
   - 第三步：若涉及本机多智能体协同环境与 `agy-safe` 桥接配置，读 `.local/tasks/20261103-magpie-orca-relay-plan/PLAN.md`。

---

## 1. `v0.3.0` 研发、开源机制融合与深度审查交付总结

### 1.1 Phase 1：Claude Code v2.1.309~2.1.318 净室隔离与全栈防漏审计
1. **OAuth 路由守卫升级（[`src-tauri/src/browser/oauth_route.rs`](src-tauri/src/browser/oauth_route.rs)）**：
   - `authorization_endpoint()` 同步支持 `("claude.com", "/cai/oauth/authorize")` 与 `("claude.ai", "/oauth/authorize")`，并严格排除 `platform.claude.com`（API Console 组织管理端点），防止 CLI `/login` 串入 Free 养号槽位。
2. **凭据与账号瞬态缓存净室清理（[`src-tauri/src/cleaner_config.rs`](src-tauri/src/cleaner_config.rs)、[`src-tauri/src/cleaner_identity.rs`](src-tauri/src/cleaner_identity.rs)）**：
   - `CREDENTIAL_KEYS` 扩展至 **7 项**（`claudeAiOauth`、`trustedDeviceToken`、`organizationUuid`、`enterpriseGateway`、`designOauth`、`trustedDeviceEnrolledAfterRefusalAtMs`、`cloudSessionsOauth`）；
   - `ACCOUNT_KEYS` 扩展至 **25 项**（完整吸收 `cc-switch` 账号绑定缓存键集合，同时严格保留 `metricsStatusCacheByPrincipal`、`userID`、`cachedGrowthBookFeatures` 等设备/客户端键，100% 通过 `s13` 设备连续性回归）；
   - `clear_stale_locks()` 按锁类型精确清理僵尸锁（`.claude.json.lock` / `.claude/.lock` 60s 阈值，`.claude/.storage-write.lock` **15s** 阈值）；
   - `maintain_account_caches()` 强制清理 `.claude/statsig`、`.claude/telemetry/1p_failed_events.*.json` 一方遥测死信箱、`groveConfigCache`、异号 `.claude.json.backup.*` / `.corrupted.*` 副本、共享会话 JSONL 中的 `credential_org` / `userEmail` / `thinking.signature` / `api-request-blob` / `bridge-session` 染色字段，并支持跨号中断 `tool_use` 与孤儿 `tool_result` 成对自愈修复；空身份（`acct == None`）或缺失 `org` 的场景下亦能精确裁剪瞬态缓存。
3. **CLI 遥测护盾、全域名防漏与 MCP 供应链安全审计（[`src/risk-model.ts`](src/risk-model.ts)、[`src-tauri/src/risk_check.rs`](src-tauri/src/risk_check.rs)、[`src/risk-verification.tsx`](src/risk-verification.tsx)、[`src/claude-residue-panel.tsx`](src/claude-residue-panel.tsx)）**：
   - 桌面 Mihomo 一键防漏覆写 YAML、移动端四客户端规则与 AI 配置提示词补齐 `DOMAIN-KEYWORD,datadoghq`、`browser-intake-us5-datadoghq.com`、`claude.com`、`growthbook.io`、`claudemcpcontent.com`、`storage.googleapis.com` 等域名（兼容 `rules` / `prepend-rules` / `append-rules`）；
   - 新增只读式 CLI 遥测护盾（4 项核心禁用开关）与 MCP 供应链安全审计（扫描全局及 `projects[*].mcpServers`，精确排除 `localhost` / `127.0.0.1` / `[::1]` 回环地址后统计远程 `http/sse` 服务、识别非 WSL 下的 Windows 裸 `npx/npm/pnpm/yarn/uvx/bunx` 启动器、自定义 `hooks` / `apiKeyHelper` / `awsAuthRefresh` / `otelHeadersHelper` 及 `skipDangerousModePermissionPrompt` / `Bash(*)` 越权配置）。

### 1.2 Phase 2 & Phase 3：智能接力 2.0、实时额度小窗 2.0 与跨页面持久化审计
1. **智能接力 2.0（[`src/smart-relay-model.ts`](src/smart-relay-model.ts)、[`src/identities.tsx`](src/identities.tsx)）**：
   - 融合 `magpie` 的 `WeekLow` 临期周配额抢救规则（`used5h < lowThreshold` 且 `effectiveUsed < effectiveSpentThreshold` 时即使 `used7d >= lowThreshold` 仍保持 `Tier 0` 优先消耗临期周配额）；
   - 融合 `claude-swap` 的 7d 重置后前 24 小时步速静默窗口（抑制重置初期短时突增导致的 `'ahead'` 误报）；
   - 实现动态防乒乓换号裕度（`computeDynamicSwitchMarginPct` / `meetsDynamicSwitchMargin`）与 5h 饥饿态（`rem5h < 10%` 且候选 `+20%` 以上、7d 不劣于当前号）紧急放行、单向防回弹锁（`noReturnAccountId`）、独立下一顺位待命候选（`standbyCandidate`）横幅与限流冷却一键解除。
2. **实时额度小窗 2.0（[`src/floating-monitor-model.ts`](src/floating-monitor-model.ts)、[`src/floating-monitor.tsx`](src/floating-monitor.tsx)、[`src/main.tsx`](src/main.tsx)）**：
   - 新增 `computeMonitorBarFillPct` 双口径极值防虚标渲染（已用与剩余模式下 `99.4%` / `99.6%` 均夹持在 `4%`～`96%` 之间，绝不虚标满格或空槽）；
   - 新增紧凑下一顺位接力待命胶囊（`.monitor-relay-standby-pill`，通过 `localStorage` + `BroadcastChannel` 实时同步）、`Escape` 快捷隐藏小窗与 `Ctrl/Cmd + =/-/0`（含小键盘）无级页面缩放。
3. **跨页面三段式净室审计时间线与 5h 续杯锚点核验（[`src/wakeup-presentation.ts`](src/wakeup-presentation.ts)、[`src/cleaner-activity.tsx`](src/cleaner-activity.tsx)、[`src/identities.tsx`](src/identities.tsx)）**：
   - 实现 `verifyWakeupAnchorAdvancement`（严格校验 `after > before + 60` 且拒绝 `> now + 5.5h` 异常远期时间戳或回退时间戳）；
   - 模块级持久化 `sharedAuditHistory` 与 `persistedWakeupAnchorMap`，切页或关闭进度横幅后仍保留可折叠的最近 5 次操作内存审计时间线（涵盖身份切换、空身份、残留清理与自动续杯/唤醒）。

---

## 2. 当前状态与后续维护须知

**当前没有任何未完成的编码、构建、热更新或发布任务。**

### 核心安全与工程铁律
1. **绝不将伴生浏览器 `Claude-Local-Browser` 设为 Windows 系统默认浏览器**。
2. **绝不中断任何正在运行的 `claude.exe`（Claude Code CLI）进程**。
3. **严守 `s13` 设备指纹保护红线**：切勿将 `userID`、`cachedGrowthBookFeatures` 或 `metricsStatusCacheByPrincipal` 移入 `ACCOUNT_KEYS` 的无条件删除列表。
4. **保持持久化格式 100% 向下兼容**：`BAGAID01`、`.baga`、SQLite `user_version=3`、主密钥、账号 HMAC 与 `CCBaga` 浏览器种子域字符串严禁改动。
5. **严禁触碰 `AGENTS.md` 与私有目录 `.local/`**；**严禁使用 `git add .`、`git add -A`、`git clean`、`git reset --hard`**。

---

## 3. 关键文件与本地证据索引

### 公开文档与核心代码入口
- **发布与核验文档**：[`docs/RELEASE_NOTES_0.3.0.md`](docs/RELEASE_NOTES_0.3.0.md)、[`docs/RELEASE_VERIFICATION_0.3.0.md`](docs/RELEASE_VERIFICATION_0.3.0.md)、[`docs/RELEASE_POLICY.md`](docs/RELEASE_POLICY.md)、[`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md)。
- **`v0.3.0` 完整方案与复审报告**：`docs/plans/2026-11-05-v0.3.0-security-and-ux-leap/`（[`00-README.md`](docs/plans/2026-11-05-v0.3.0-security-and-ux-leap/00-README.md)、[`01-FINDINGS.md`](docs/plans/2026-11-05-v0.3.0-security-and-ux-leap/01-FINDINGS.md)、[`02-IMPLEMENTATION-PLAN.md`](docs/plans/2026-11-05-v0.3.0-security-and-ux-leap/02-IMPLEMENTATION-PLAN.md)、[`03-REVIEW-AND-ROADMAP.md`](docs/plans/2026-11-05-v0.3.0-security-and-ux-leap/03-REVIEW-AND-ROADMAP.md)）。
- **后端核心模块**：[`src-tauri/src/browser/oauth_route.rs`](src-tauri/src/browser/oauth_route.rs)、[`src-tauri/src/cleaner_config.rs`](src-tauri/src/cleaner_config.rs)、[`src-tauri/src/cleaner_identity.rs`](src-tauri/src/cleaner_identity.rs)、[`src-tauri/src/cleaner.rs`](src-tauri/src/cleaner.rs)、[`src-tauri/src/cleaner_residue.rs`](src-tauri/src/cleaner_residue.rs)、[`src-tauri/src/risk_check.rs`](src-tauri/src/risk_check.rs)、[`src-tauri/src/identities/optimization_tests.rs`](src-tauri/src/identities/optimization_tests.rs)。
- **前端核心模块**：[`src/smart-relay-model.ts`](src/smart-relay-model.ts)、[`src/floating-monitor-model.ts`](src/floating-monitor-model.ts)、[`src/floating-monitor.tsx`](src/floating-monitor.tsx)、[`src/identities.tsx`](src/identities.tsx)、[`src/cleaner-activity.tsx`](src/cleaner-activity.tsx)、[`src/wakeup-presentation.ts`](src/wakeup-presentation.ts)、[`src/risk-model.ts`](src/risk-model.ts)、[`src/risk-verification.tsx`](src/risk-verification.tsx)、[`src/claude-residue-panel.tsx`](src/claude-residue-panel.tsx)。

### 本机忽略目录证据（位于 `.local/`，严禁提交或上传）
- `.local/artifacts/20261107T085036Z-52584c0173a844248cbdd998aa03cd43/`：`v0.3.0` 安装包 `Claude-Local_0.3.0_x64-setup.exe`、`SHA256SUMS.txt`、`privacy-audit.json`、`resource-manifest.json`。
- `.local/tasks/20261107-release-0.3.0/`：
  - `artifact.json` / `source-commit.txt`：构建与宿主哈希回执；
  - `github-release-receipt.json`：GitHub Release `v0.3.0` 服务端资产 digest 核验回执；
  - `deploy-audited.ps1` / `deployment-receipt.json` / `deployment-plan.json` / `deployment-backups/`：本机 102 文件核验、9 文件备份替换、交互式桌面启动及 `claude.exe` 零中断快照回执；
  - `HANDOFF-pre-v0.3.0-closeout.md.bak`：`HANDOFF.md` 重写前备份（SHA-256 `6E86EDE8CF906F40F58451DA4C71F3ADA7FA2349834B8FD52713319AC57C3453`）。

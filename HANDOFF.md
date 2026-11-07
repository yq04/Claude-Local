<!--
[INPUT]: Final owner decisions, released v0.3.0 source/tag c784588e206be85d7bcccda4eadec5cebab3e8dc, documentation commit 968c2e0, passing release-source CI (run 42357163813), audited NSIS installer (SHA256 8d2a56c93ebe7a2cf56a886bb00fcf78c4df2e7b46dbc934f7ee5a8b64f3e8d6), verified local payload deployment (host SHA256 cbe79fbde3cffa2544497d3cfc6a7cbfcc436c823094b787ce02edfce5dbb889, missingClaudeCount = 0), and 2026-11-06 Argon subagent pipeline & Claude CLI risk-control hardening.
[OUTPUT]: Context-free session handoff: what task we are doing, what is completed, where we are stuck (none), next steps, and verified pitfalls never to repeat.
[POS]: Root maintenance handoff. Real identities, emails, IP/proxy credentials, process IDs, browser seeds, private probe values, workstation paths and screenshots stay out of tracked files.
[PROTOCOL]: Back up and verify SHA256 before rewriting (backed up to .local/tasks/20261107-release-0.3.0/HANDOFF-pre-session-end-20261107.md.bak, SHA256 8F5747EF8ACB0A784594701577A1C2CC4F3A243D7D06D99D3C327F47020EA4D6). This handoff update is documentation-only: no build/deploy, account action, proxy reload, upload or release-tag movement.
-->
# Claude-Local 会话交接（HANDOFF.md）

更新时间：2026-11-07，America/New_York（EST）。

## 接手先读：当前结论（30 秒速览）

**`Claude-Local v0.3.0` 已 100% 完成深度审查补漏、6 大开源项目源码级精髓融合、全量自动化测试、中性环境 NSIS 打包、29 项外置隐私探针审计、本机无感热更新（零中断运行中的 `claude.exe`）以及 GitHub Release（Latest）正式发布；当前没有任何未完成的编码、打包、热更新或发布任务。**

- **接手阅读顺序**：
  1. 先读本文、根目录 `AGENTS.md` 与 [`CLAUDE.md`](CLAUDE.md)；
  2. 再读 [`docs/RELEASE_VERIFICATION_0.3.0.md`](docs/RELEASE_VERIFICATION_0.3.0.md)、[`docs/RELEASE_NOTES_0.3.0.md`](docs/RELEASE_NOTES_0.3.0.md) 与 `docs/plans/2026-11-05-v0.3.0-security-and-ux-leap/`（`00-README.md`、`01-FINDINGS.md`、`02-IMPLEMENTATION-PLAN.md`、`03-REVIEW-AND-ROADMAP.md`）；
  3. 修改任何模块前，先读对应目录的 `CLAUDE.md` 和目标源文件头部的 `[INPUT]/[OUTPUT]/[POS]` 注释。

---

## 1. 我们在做什么任务

### 1.1 项目定位
`Claude-Local` 是独立拥有并维护的 Windows 10/11 x64 桌面工作台（主程序 `claude-local.exe`，Bundle ID `ai.local.claude-local`，伴生指纹浏览器注册名 `Claude-Local-Browser`），技术栈为 **Tauri 2 (Rust) + React 19 (TypeScript) + Python 单写者额度账本采集器**。

### 1.2 本阶段核心任务（`v0.3.0` 深度打磨与正式发布）
1. **对既有的 `v0.3.0` 升级内容做全量审查与补漏**：结合 `claude.exe v2.1.309~2.1.318` 二进制逆向证据，逐行排查前后端实现中的遗漏、边界缺陷与测试盲区。
2. **深入剖析 6 个优质开源项目源码并融合高价值机制**：不仅阅读项目介绍，更深入剖析 `.local/research/v0.3.0-benchmark/` 下克隆的 `yetone/magpie`、`farion1231/cc-switch`、`realiti4/claude-swap`、`stablyai/orca`、`lbjlaq/Antigravity-Manager`、`jlcodes99/cockpit-tools` 源码，将其核心调度算法、账号缓存键集合与 MCP 安全体检规则补充进 `Claude-Local`。
3. **完成 `v0.3.0` 版本递增、打包审计、本机无感热更新、上传与 GitHub Release 发布**：在不中断任何运行中 `claude.exe` 的前提下，更新本机桌面端并发布公开 Release。

---

## 2. 已经完成了什么

### 2.1 `v0.3.0` 核心功能、遗漏修复与开源源码精髓融合
1. **Claude Code v2.1.309~2.1.318 净室切号与跨号防染色（[`src-tauri/src/cleaner_config.rs`](src-tauri/src/cleaner_config.rs)、[`src-tauri/src/cleaner_identity.rs`](src-tauri/src/cleaner_identity.rs)、[`src-tauri/src/browser/oauth_route.rs`](src-tauri/src/browser/oauth_route.rs)）**：
   - **OAuth 路由守卫升级**：`authorization_endpoint()` 同时支持 `("claude.com", "/cai/oauth/authorize")` 与 `("claude.ai", "/oauth/authorize")`，并严格排除 `platform.claude.com`（API Console 端点），防止 CLI `/login` 误落入 Free 养号浏览器槽位。
   - **凭据白名单（`CREDENTIAL_KEYS`）扩展至 7 项**：涵盖 `claudeAiOauth`、`trustedDeviceToken`、`organizationUuid`、`enterpriseGateway`、`designOauth`、`trustedDeviceEnrolledAfterRefusalAtMs`、`cloudSessionsOauth`。
   - **账号瞬态缓存（`ACCOUNT_KEYS`）扩展至 25 项**：吸收 `cc-switch` 账号绑定缓存键集合（新增 `additionalModelOptionsAnsweredAt`、`additionalModelCostsCache`、`artifactRosterDenied`、`lastSeenOrgDefaultUpdatedAt`、`autoCompactWindowsCache`、`metricsStatusCache`、`unusedLimitResetStatusCache`、`startupPrefetchedAt`、`cachedExtraUsageDisabledReason`），同时**严格保留 `metricsStatusCacheByPrincipal`、`userID`、`cachedGrowthBookFeatures` 等设备/客户端键**，确保 `s13` 设备连续性测试 100% 通过。
   - **分锁类型僵尸锁回收与净室自愈**：[`clear_stale_locks()`](src-tauri/src/cleaner_identity.rs) 对 `.claude.json.lock` / `.claude/.lock` 采用 **60s** 阈值、对 `.claude/.storage-write.lock` 采用 **15s** 阈值；[`maintain_account_caches()`](src-tauri/src/cleaner_identity.rs) 强制清理 `.claude/statsig`、`.claude/telemetry/1p_failed_events.*.json` 一方遥测死信箱、`groveConfigCache`、异号 `.claude.json.backup.*` / `.corrupted.*` 副本、共享会话 JSONL 中的 `credential_org` / `userEmail` / `thinking.signature` / `api-request-blob` / `bridge-session` 染色字段，并支持跨号中断 `tool_use` 与孤儿 `tool_result` 成对自愈修复；空身份（`acct == None`）或缺失 `org` 场景下亦能精确裁剪瞬态缓存。

2. **CLI 遥测护盾、全栈防漏域名锁与 MCP 供应链安全审计（[`src/risk-model.ts`](src/risk-model.ts)、[`src-tauri/src/risk_check.rs`](src-tauri/src/risk_check.rs)、[`src/risk-verification.tsx`](src/risk-verification.tsx)、[`src/claude-residue-panel.tsx`](src/claude-residue-panel.tsx)、[`src/vps.tsx`](src/vps.tsx)）**：
   - 桌面 Mihomo 一键防漏覆写 YAML、移动端四客户端规则、AI 配置提示词与原生风险检查同步锁定 `DOMAIN-KEYWORD,datadoghq`、`browser-intake-us5-datadoghq.com`、`claude.com`、`growthbook.io`、`claudemcpcontent.com`、`storage.googleapis.com` 等域名（兼容 `rules` / `prepend-rules` / `append-rules`）。
   - 前后端统一实现 CLI 遥测护盾（`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`、`DISABLE_TELEMETRY`、`DISABLE_ERROR_REPORTING`、`CLAUDE_CODE_DisableFileessler`）与 MCP 供应链只读安全审计：扫描全局及 `.claude.json` 下 `projects[*].mcpServers`，精确排除 `localhost` / `127.0.0.1` / `[::1]` / `0.0.0.0` 回环地址后统计远程 `http/sse` 服务，对标 `cc-switch/src-tauri/src/claude_mcp.rs` 识别非 WSL 下的 Windows 裸 `npx/npm/pnpm/yarn/uvx/bunx` 启动器、自定义 `hooks` / `apiKeyHelper` / `awsAuthRefresh` / `otelHeadersHelper` 及 `skipDangerousModePermissionPrompt` / `dangerouslySkipPermissions` / `Bash(*)` 越权配置，并同步反映在「风控验证」与「身份页文件残留」状态徽章中。

3. **智能接力 2.0（Smart Relay 2.0）融合 `magpie` 与 `claude-swap` 算法（[`src/smart-relay-model.ts`](src/smart-relay-model.ts)、[`src/smart-relay-model.test.ts`](src/smart-relay-model.test.ts)、[`src/identities.tsx`](src/identities.tsx)）**：
   - **吸收 `magpie` `WeekLow` 临期周配额抢救规则（`internal/routes/strategies.go`）**：在 `'smart'` 与 `'pace'` 策略下，当账号 5h 窗口充裕（`used5h < lowThreshold`）且距 7d 重置时间的有效消耗偏低（`effectiveUsed < effectiveSpentThreshold`）时，即使 `used7d >= lowThreshold` 仍保持 `Tier 0` 优先消耗，避免周额度白白过期。
   - **吸收 `claude-swap` 7d 重置后前 24 小时步速静默窗口（`src/claude_swap/pace.py`）**：在 168 小时周窗口开启后的前 24 小时内抑制 `'ahead'` 超前消耗预警（归为 `'on_track'`），消除周重置初期短时突增导致的误报。
   - **动态防乒乓换号裕度、5h 饥饿态紧急放行与独立 `standbyCandidate`**：实现 `computeDynamicSwitchMarginPct` / `meetsDynamicSwitchMargin`，并在当前账号 `rem5h < 10%` 且候选账号 `rem5h >= active.rem5h + 20%`、7d 余量不劣于当前号时紧急放行；新增单向防回弹锁（`noReturnAccountId`）与独立 `standbyCandidate` 下一顺位待命候选，确保即使 `recommended` 被防抖抑制，顶部待命提示条与一键切号按钮依然可用。

4. **实时额度悬浮小窗 2.0（Quota HUD 2.0）与跨页面持久化审计时间线（[`src/floating-monitor-model.ts`](src/floating-monitor-model.ts)、[`src/floating-monitor.tsx`](src/floating-monitor.tsx)、[`src/main.tsx`](src/main.tsx)、[`src/wakeup-presentation.ts`](src/wakeup-presentation.ts)、[`src/cleaner-activity.tsx`](src/cleaner-activity.tsx)）**：
   - 新增 `computeMonitorBarFillPct` 双口径极值防虚标渲染（已用与剩余模式下 `99.4%` / `99.6%` 均夹持在 `4%`～`96%` 之间，绝不虚标满格或空槽）。
   - 小窗内置紧凑「下一顺位接力待命胶囊」（`.monitor-relay-standby-pill`，通过 `localStorage` + `BroadcastChannel` 实时同步），新增 `Escape` 快捷隐藏小窗与 `Ctrl/Cmd + =/-/0`（含小键盘及输入框焦点守卫）全局缩放。
   - 强化 `verifyWakeupAnchorAdvancement`（校验 `after > before + 60` 并拒绝回退或 `> now + 5.5h` 的异常远期时间戳）；将 `sharedAuditHistory` 与 `persistedWakeupAnchorMap` 提升为模块级持久化状态，切页或关闭横幅后仍保留可折叠的最近 5 次操作内存审计时间线。

### 2.2 全套测试、打包审计、本机热更新与 GitHub Release `v0.3.0` 交付回执
- **自动化测试全绿**：
  - `bun test`：**183 pass / 0 fail**（26 个文件，14,086 次断言）；`bun run build`（`tsc --noEmit && vite build`）**0 errors**。
  - `cargo test --manifest-path src-tauri/Cargo.toml --bin claude-local`：**315 pass / 0 fail**。
  - Python 合成测试：本地额度 34/34、在线额度 35/35、运行资源 2/2、包审计 9/9 通过。
  - GitHub Actions CI：源码提交 [`c784588e206be85d7bcccda4eadec5cebab3e8dc`](https://github.com/yq04/Claude-Local/commit/c784588e206be85d7bcccda4eadec5cebab3e8dc) 触发 [Windows source checks (`#42357163813`)](https://github.com/yq04/Claude-Local/actions/runs/42357163813) 全流程 `success`（含全部 101 项 Python 与系统修改夹具）。
- **中性 NSIS 打包与 29 项外置隐私探针审计**：
  - 安装包：`Claude-Local_0.3.0_x64-setup.exe`（`140,860,505` 字节 / `134.34 MiB`），SHA-256：`8d2a56c93ebe7a2cf56a886bb00fcf78c4df2e7b46dbc934f7ee5a8b64f3e8d6`。
  - 只读解包审计：109 个文件通过白名单与 **29 项外置隐私探针审计（0 项发现）**；未打包宿主 `baafdb7e4cf3a1686e8a3c5c65cbc6c7c7e231d170aed714c1fa0777ee5916e7` 与 NSIS 内宿主 `cbe79fbde3cffa2544497d3cfc6a7cbfcc436c823094b787ce02edfce5dbb889` 仅存在唯一 3 字节 `UNK` → `NSS` sentinel 转换（偏移 `13544602`）。
- **本机无感热更新**：
  - 对当前用户安装目录（`%LOCALAPPDATA%\Programs\Claude-Local`）的 102 个应用文件逐一核验，备份并替换 9 个变更文件，安装宿主版本 `0.3.0`（SHA-256 `cbe79fbde3cffa2544497d3cfc6a7cbfcc436c823094b787ce02edfce5dbb889`），已在桌面交互式会话启动主窗口，**全程零中断运行中的 `claude.exe`（`missingClaudeCount = 0`）**。
- **GitHub Release 发布**：
  - [Claude-Local v0.3.0 (Latest)](https://github.com/yq04/Claude-Local/releases/tag/v0.3.0) 已于 `2026-11-07T09:03:17Z` 正式发布，服务端资产 `Claude-Local_0.3.0_x64-setup.exe` 与 `SHA256SUMS.txt`（digest `ae0a28af257e7e5bba448dbff7a6d2c8ff10f18b2687077842fffa1c50309e93`）均与本地一致。

### 2.3 本机 `Gemini 4 Argon` 子代理管线与 Claude CLI 风控加固（2026-11-06 已完成）
- 补齐 `~/.claude/settings.json` 的 `"env"` 块，强制锁定 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `GRPC_PROXY = http://127.0.0.1:7899` 及 5 项遥测禁用开关；
- 在 Magpie (`127.0.0.1:3425`) 中配置 `usage` 路由、`group/argon-medium`、`group/argon-high`、`group/gemini-3.1-flash-lite-preview`；
- 重构 `agy-safe.ps1` / `agy-safe.cmd`（`FileShare.ReadWrite | FileShare.Delete` 共享流锁、90s 轮询、`Global\AgySafeLaunchMutex` 1.15s 错峰启动、`Global\AgySafeMagpieStartMutex` 10s 就绪自愈、流超时看门狗与内置 `$QualityGuardrail`）；
- 生成 `<local-env>/bin/agy-highcap.exe` 将上下文自动压缩阈值从 `256,000` 扩容至 **`840,000 tokens`**（实际压缩触发线提升至 `~714,000 tokens`）。

---

## 3. 当前卡在哪

**当前没有任何技术阻塞、遗留缺陷或未竟任务。**

- 代码库、测试套件、本机安装的 `Claude-Local v0.3.0` 桌面端、远端 Git `main` 分支与 GitHub Release `v0.3.0` 均处于完全对齐的干净完结状态。
- 工作区仅保留用户规则要求的 `AGENTS.md` 未暂存及 Git 忽略的 `.local/` 私有目录。

---

## 4. 下一步计划是什么

新会话接手时无需执行任何未完结的收尾操作，按用户新指令响应即可：

1. **若用户提出 `v0.3.1` / 新功能需求或日常维护**：
   - 先阅读相关模块目录下的 `CLAUDE.md` 与源文件头注释；
   - 开发与验证期间严格遵守“增量测试、绝不中断运行中的 `claude.exe`”；
   - 若未来需要再次打包发布新版本，可复用 `scripts/build-windows-share.ps1`（传入便携 7-Zip `.local/build-tools/7zip-26.04-f4a03f7e/portable/7z.exe` 与 29 项外置探针文件）及 `.local/tasks/20261107-release-0.3.0/deploy-audited.ps1` 的无感部署流程。
2. **若用户继续使用或调优本机 `gemini-4-argon-medium` 子代理 / Magpie 账号池**：
   - 参考 `.local/tasks/20261103-magpie-orca-relay-plan/PLAN.md` 与下方第 5.2 节规范。

---

## 5. 有哪些踩过的坑，绝对不要再踩

### 5.1 `Claude-Local` 研发、测试与打包部署铁律（必读）
1. **严禁中断任何正在运行的 `claude.exe`（Claude Code CLI）进程**：
   - 开发、测试与本机桌面端热更新期间，绝不能执行任何停止 `claude.exe` 的命令。本机活跃安装路径为 `%LOCALAPPDATA%\Programs\Claude-Local\claude-local.exe`。
2. **严守 `s13` 设备指纹连续性红线（[`src-tauri/src/cleaner_config.rs`](src-tauri/src/cleaner_config.rs)）**：
   - 切勿将 `userID`、`cachedGrowthBookFeatures`、`metricsStatusCacheByPrincipal`、`anonymousId`、`groveConfigCache`（由 `cleaner_identity.rs` 按策略单独处理）加入 `ACCOUNT_KEYS` 的无条件删除列表，否则会破坏设备连续性并导致 `s13_account_cleanup_preserves_device_and_client_state` 与 `s13_legacy_68_key_archive_reads_without_restoring_device_or_ui_state` 失败。
3. **Rust 单元测试目标为 `--bin claude-local` 而非 `--lib`**：
   - `src-tauri/Cargo.toml` 仅有 `[[bin]] name = "claude-local"`，没有 `[lib]` 目标。运行 Rust 单元测试必须使用 `cargo test --manifest-path src-tauri/Cargo.toml --bin claude-local`（共 315 项测试）。
4. **在线唤醒结果契约（[`scripts/claude_quota_online.py`](scripts/claude_quota_online.py)）**：
   - `run_wakeup` 的 `confirmed_5h` 必须要求调用方传入非空的 `expired_reset_at`（`expired_reset_at is not None and reset_5h > expired_reset_at`），切勿改成 `expired_reset_at is None` 也返回 `new_5h_confirmed`，否则会破坏 `scripts/CLAUDE.md` 契约并导致 `test_wakeup_seven_day_only_and_old_reset_never_confirm` 失败。前端手动唤醒的锚点推进验真由 [`verifyWakeupAnchorAdvancement`](src/wakeup-presentation.ts) 独立完成。
5. **伴生浏览器与持久化格式红线**：
   - **绝不将 `Claude-Local-Browser` 设为 Windows 系统默认浏览器**；
   - **绝不破坏持久化格式兼容**：保持 `BAGAID01`、`.baga`、SQLite `user_version=3`、主密钥、账号 HMAC 与 `CCBaga` 浏览器种子域字符串不变；
   - **单账号跨机导入/导出（`.clpack` / `.bagapack` / `CLPACK01`）已被用户永久取消**，不要重开开发。
6. **Git 与隐私红线**：
   - **严禁暂存或提交 `AGENTS.md` 与 `.local/`**；严禁在跟踪文件中写入真实账号、邮箱、代理凭据、进程 PID、29 项探针明文或本机工作区绝对路径；
   - 提交前务必运行 `git diff --cached --check`，防止文件末尾多余空行（`new blank line at EOF`）或 `CRLF` 混入；
   - 严禁使用 `git add .`、`git add -A`、`git clean`、`git reset --hard`。

### 5.2 本机 `Gemini 4 Argon` 子代理与 Claude CLI 协同坑点
1. **子代理 `Bash` 轮询不要传 `"timeout": 180000`**：统一使用不带自定义 `timeout` 参数的 `agy-safe.cmd -WaitOutput "<.output路径>"`（内部单次限时 90s < 默认 120s Bash 超时），避免 TUI 渲染误导性的 `(timeout 3m)` 标签。
2. **跨进程读取热文件必须带 `FileShare.ReadWrite | FileShare.Delete`**：切勿用 `Get-Content` 直接读正在写入的 `.output` 或 `transcript.jsonl`，必须走 `FileStream` 共享读锁。
3. **保持 `~/.claude/settings.json` 的 `"env"` 代理与遥测锁定非空**：确保 `claude.exe` 派生的所有子进程（`node`、`python`、`git` 等）与主进程共享 `http://127.0.0.1:7899` 静态家宽出口。

---

## 6. 关键文件与本地证据索引

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
  - `HANDOFF-pre-v0.3.0-closeout.md.bak` / `HANDOFF-pre-session-end-20261107.md.bak`：`HANDOFF.md` 重写前备份与 SHA-256 校验记录。

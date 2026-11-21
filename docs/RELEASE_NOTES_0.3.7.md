<!-- [INPUT]: Verified v0.3.7 Strategy A1 reset-card accounting & reset_harvest, modular --orchestrate CLI relay/subagent hardening & clean_handoff, Supported Countries Policy anti-ban & Scenario G guard, background silent resource optimization, and 5 UI refinements on top of v0.3.6. -->
<!-- [OUTPUT]: Bilingual public GitHub Release notes for Claude-Local v0.3.7 (no automatic updater; non-disruptive Windows x64 upgrade). -->
<!-- [POS]: Tracked documentation artifact paired with git tag v0.3.7 and SHA256SUMS.txt. -->

# Claude-Local v0.3.7

> **独立 Windows x64 发行说明 / Standalone Windows x64 Release Notes**
> 发布日期 Date: `2026-11-20` · 应用标识 Bundle ID: `ai.local.claude-local` · 主程序 Executable: `claude-local.exe` · 伴侣浏览器 Companion Browser: `Claude-Local-Browser`

---

## 中文说明

### 核心更新摘要

`v0.3.7` 在 `v0.3.6` 工作台基线之上，围绕 **Strategy A1 重置卡核算与 `reset_harvest`、模块化 `--orchestrate` CLI 无感接力与子代理槽位池、Supported Countries Policy 全链路防封与 Scenario G 账本守卫、后台静默资源优化，以及工作台五项 UI 精修** 完成全栈升级与回归，并严格保持全部加密保险库、隔离槽位与零强杀 `claude.exe` 边界不变：

1. **Strategy A1 重置卡核算、`reset_harvest` 收割引擎与套餐校准**
   - **逐份分片解析与策略 A1 防误隐藏**：Rust 网页桥与 Python 唯写者新增逐份 `manual_resets_grants`（跳过 `resets_left == 0` 已用尽切片、放行 `starts_at`/`ends_at: null` 无限期切片、`manual_resets_grant_ends_at` 取活动有限切片最晚截止时间）；前后端统一实施 **策略 A1**（`ended` 恒为 `false`，永不凭本地时钟静默清零上次同步的正余额，混合到期分片按 `min(raw_rem, future_sum)` 封顶，本地过期转为 `needsResync = true` 静待网页同步确认）。
   - **`reset_harvest` 优先收割与套餐非过期校准**：`SmartRelay` 新增 `reset_harvest`（「重置卡优先收割」）策略、`7d >= min(spentThresholdPct, 98)` 自动标记 `awaitingManualReset` 并支持一键跳转账号绑定 `claude.ai/settings/usage` 手动重置后「同步验证」；新增 `quota_5h_rested` 修复静置非 Ultra 账号 5h 误降级；区分自动续期 `next_renewal`（仅写 `subscription_renews_at`，绝不误判过期）与退订 `access_until`，支持 `manualPlan` 手动套餐校准并在降级非 Ultra 时三端清除 `quota_no_5h_limit`。

2. **模块化 `--orchestrate`、CLI 无感接力 / 子代理槽位池、`Opus 5.5 + max`、后台守护保活与限流防误切**
   - **六模块原生编排器（`src-tauri/src/identities/orchestrator/`）**：拆分实现 `mod`/`config`/`evaluator`/`slots`/`tooling`/`tests` 六模块与跨进程 `.orchestrate.lock`，前后端 6 策略 1:1 完全同构；Windows `(PID, CreationTime)` 防 PID 复用校验、单调递增 `expiresAt` 凭据回灌与空闲槽位明文擦除、429/401 冷却入狱与 `exclude_record_ids` 跨槽故障转移，以及 `%APPDATA%\ai.local.claude-local\cli-slots\<id>\` `CLAUDE_CONFIG_DIR` 隔离池（`maxSameExitConcurrency` `1..5` 与 `1800–3400ms` 跨进程同出口错峰节流）。
   - **`claude-relay` / `claude-subagent`、`Opus 5.5 + max` 与 `daemon stop --any`**：新增 `claude-local.exe --orchestrate` 驱动的 `~/.local/bin/claude-relay.{ps1,cmd}`（`cr.cmd`）、`claude-subagent.{ps1,cmd}`（`UTF-8 with BOM + LF`）与 `~/.claude/agents/pro-pool-worker.md`，支持智能接力弹窗「一键启动接力终端」（`identities_launch_relay_cli` + 5 项 MRU 目录）；支持跨切号持久化 `defaultCliModel` / `defaultCliEffort`（如 `claude-opus-5-5` + `max`，零触碰 `~/.claude/settings.json`）；切号/停止前通过 `claude.exe daemon stop --any` 优雅挂起后台守护保活 `adopt.json`（含 `<Sie>` 提示框自动注入 `VK_2` `'2'` 与 `continued-in` `<S_bg>` 同号接续）。
   - **零配置扰动 `clean_handoff` 交接与 `api-request-blob`/raw 模式根治**：新增 `identities/handoff.rs` 在每次 `Store::switch` 后原子落盘经防封防火墙脱敏的 `handoff/latest-handoff.{json,md}` 与 `subagent-outputs/sub-XX.md`（零改写 `~/.claude/settings.json` 与 `.jsonl`）；跨号接力默认采用 **`clean_handoff`**（禁用跨号 `--resume` / `Agent(resume:)`，配合 `6–15s` 随机拟人缓冲）；`claude-relay.ps1` 补齐 `CONIN$` raw 模式 `(mode & 0x0006u) == 0u` 校验与 `4000ms` 后台迁移宽限窗、父会话优先转录、`<10s` 非零秒退单次自愈降级及热更新漂移单次提醒；扩展 `$script:RelayNonResponseRecordTypes`（屏蔽 `api-request-blob` / `api-request` / `ai-title` / `mode` / `permission-mode` / `custom-title` / `agent-name` 与 `user`）、共享 `Get-JsonlEntryErrorState` 与收紧 `sentinel_hook`，彻底根除健康正文与请求元数据触发的 429 误切。

3. **Supported Countries Policy 全链路防封与 Scenario G 账本守卫**
   - **设备指纹隔离与机器级代理常驻**：`~/.claude/settings(.local).json` 住宅代理环境保持机器级常驻（`LEGACY_SETTINGS_ARCHIVE_KEYS` 保持存量 `.baga` 读取兼容，切入旧归档自动回填），`Store::switch`、`recover_clean` 与 `cli-slots` 1:1 写入每身份确定性 HMAC `userID` / `anonymousId` / `machineID` / `firstStartTime`；`verify_archive_stream` 采用 `64 MiB` 内存封顶流式校验并扩展 Desktop 与 `.claude/teams` 隔离。
   - **浏览器出口门禁、远端 DNS 与 Scenario G**：四条伴生浏览器冷启动路径共用 `preflight_browser_launch_policy`（拦截受限出口国家与受限主机无代理直连）；全部 Rust HTTP/SOCKS 探针与唤醒自动升级 `socks5h://` / `socks4a://` 远端 DNS 并严格执行 `route_required` fail-closed；前后端 1:1 对齐 `62` 机房 / `70` 住宅 ASN 多信号分类器（精准识别 `RCN / Astound AS6079`、`Google Fiber AS16591` 等）与 `19` 域 Anthropic 资产规则顺序审计；[`scripts/claude_quota.py`](../scripts/claude_quota.py) 落地 Scenario G 活跃身份一致校验，防止外部工具切换跨号串写 `quota_ledger.json`。

4. **后台静默资源深度优化**
   - 主程序注册有界 Tokio 运行时（`2 worker / 8 blocking / 5s` 回收），`monitor` 悬浮窗改为按需创建（`create: false`）与关闭即销毁，主窗隐藏托盘时禁用 `backdrop-filter`（`data-window-hidden="true"`）并触发 WebView2 低内存目标 + `TrySuspend` + 工作集修剪；禁用态 `wakeup` 于 `Condvar` 零唤醒挂起，复用 `(pid, created_100ns)` Chrome 进程缓存、`kill_switch` 无运行浏览器时退避至 `60s`、`profile` 单次解析 `.claude.json` 并在持有新鲜 `ServerAnchor`（`<=90s`）时跳过递归目录扫描，前端在页面隐藏/离焦态自动暂停或降频轮询。

5. **工作台五项 UI 精修与双语对齐（`src/` + `src/locales/`）**
   1. **精简左侧边栏顶部**：移除侧栏顶部的搜索触发栏（`.sidebar-search-bar` / `.command-palette-trigger*`），完整保留全局 `Ctrl+K` / `Cmd+K` 快捷键监听与 `<CommandPalette />` 命令面板。
   2. **简化「身份管理 -> Claude Code CLI」卡片**：移除卡片内多余的后台守护/子 Shell/待接管/交接检查点提示框，保留 CLI 状态检测（`status?.running`）、安装指引、`isAnyCliLive` 一键更新守卫与独立接力终端启动按钮。
   3. **移除身份库上方 Smart Relay 横幅**：移除身份卡片库上方冗余的绿色接力状态横幅（`data-smart-relay-banner`），保留顶栏 Smart Relay 胶囊、配置弹窗及全部后台遥测逻辑。
   4. **重设计「用量分析 -> 账号明细」表格（10 列 → 5 列）**：精简为 `账号 / 总 Token / 输出 / API 等效花费 / 缓存命中率` 五列可排序紧致表（四分项明细收敛至悬停提示），采用单行省略双行账号单元格（整合套餐、订阅回本 ROI、活跃槽位徽章并保持 `privacyMask` 脱敏提示守卫）与右侧对齐的「定位卡片」按钮，在 `1040×820` 中英明暗态实现零水平溢出。
   5. **紧致账号筛选器与下拉弹层**：收紧 `.usage-account-filter` 触发器贴合当前选中标签（`28px` 高度、`8px` 圆角、`max-width: 184px`），并通过作用域 `[role="listbox"]:not(.command-palette-list)` 使短筛选弹层紧致包裹选项（`96px..280px`）而不影响命令面板或宽选择器；`zh.yaml` / `en.yaml` 全部 `3,107` 键与插槽保持 100% 双向同步。

### 兼容性与无损升级说明

- **数据格式 100% 向下兼容**：完整保留 `BAGAID01` 魔数、`.baga` 归档编码、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串以及 `%APPDATA%\ai.local.claude-local` 私有目录结构。
- **平滑无中断升级**：支持从 `0.1.x`、`0.2.x`、`0.3.0`、`0.3.1`、`0.3.2`、`0.3.3`、`0.3.5` 或 `0.3.6` 直接安装升级至 `0.3.7`，保留所有已有身份、密钥与隔离浏览器资料，绝不中断正在运行的 `claude.exe` 会话。
- **校验与核验**：安装程序构建与隐私核验汇总于随附 `SHA256SUMS.txt`；安装前可用 PowerShell 校验：
  ```powershell
  Get-FileHash .\Claude-Local_0.3.7_x64-setup.exe -Algorithm SHA256
  ```

---

## English Release Notes

### Highlights

Building on the `v0.3.6` workbench baseline, **`v0.3.7`** delivers **Strategy A1 reset-card accounting & `reset_harvest`, modular `--orchestrate` CLI relay & isolated subagent slot pools, Supported Countries Policy anti-ban & Scenario G ledger hardening, background silent resource optimization, and 5 targeted UI refinements** — while keeping all encrypted vault formats, browser isolation boundaries, and zero-kill `claude.exe` safeguards intact:

1. **Strategy A1 Reset-Card Accounting, `reset_harvest` Engine & Plan Calibration**
   - **Per-Grant Slicing & Strategy A1 Preservation**: Both the Rust MV3 bridge and Python single-writer ledger now record per-grant `manual_resets_grants` slices (`cedar_ember.grants[]`), skip exhausted `resets_left == 0` slices, support `starts_at`/`ends_at: null`, and expose the uncapped latest finite `manual_resets_grant_ends_at`. Strategy A1 parity across Rust (`evaluator.rs::active_reset_cards`) and TypeScript (`extractResetCardInfo`) ensures positive reset balances are never silently zeroed by local clock drift (mixed expired/active slices cap at `min(raw_rem, future_sum)` and local-expired entries transition to `needsResync = true`).
   - **`reset_harvest` & Non-Expiry Billing Separation**: Adds the `reset_harvest` routing strategy, marks `7d >= min(spentThresholdPct, 98)` accounts with positive reset cards as `awaitingManualReset` with one-click jump to account-bound `claude.ai/settings/usage` plus inline `Verify sync`, adds `quota_5h_rested` alignment for idle non-Ultra accounts, separates auto-renewing `next_renewal` (`subscription_renews_at`) from cancelled `access_until`, and adds manual `manualPlan` calibration with non-Ultra `quota_no_5h_limit` clearing.

2. **Modular `--orchestrate`, `claude-relay` / `claude-subagent`, `Opus 5.5 + max`, `daemon stop --any` & `api-request-blob`/Raw-Mode Hardening**
   - **Modular 6-File Orchestrator (`src-tauri/src/identities/orchestrator/`)**: Refactors headless orchestration into `mod`/`config`/`evaluator`/`slots`/`tooling`/`tests` with cross-process `.orchestrate.lock`, 1:1 frontend/backend 6-strategy parity, Windows `(PID, CreationTime)` anti-PID-reuse checks, monotonic `expiresAt` OAuth write-back + idle slot credential wipe, 429/401 cooldown + `exclude_record_ids` cross-slot failover, and isolated `CLAUDE_CONFIG_DIR` slots (`cli-slots/<id>`, `maxSameExitConcurrency` `1..5` with `1800–3400ms` cross-process pacing).
   - **CLI Wrappers, Persistent `Opus 5.5 + max` & Background Shell Preservation**: Ships `claude-relay.ps1` (`cr.cmd`), `claude-subagent.ps1` (`UTF-8 with BOM + LF`), one-click GUI terminal launcher (`identities_launch_relay_cli` + 5-item MRU directories), and `~/.claude/agents/pro-pool-worker.md`; persists `defaultCliModel` / `defaultCliEffort` (e.g., `claude-opus-5-5` + `max`) across switches without touching `~/.claude/settings.json`; gracefully parks background daemons via `claude.exe daemon stop --any` preserving `adopt.json` (`VK_2` `'2'` console injection on `<Sie>` and `continued-in` `<S_bg>` tracking).
   - **Zero-Config-Churn `clean_handoff` & `api-request-blob`/Raw-Mode Fixes**: Adds `identities/handoff.rs` to atomically write scrubbed `handoff/latest-handoff.{json,md}` & `subagent-outputs/sub-XX.md` on `Store::switch` without modifying `~/.claude/settings.json` or `.jsonl`; sets anti-ban `clean_handoff` as the cross-account default (6–15s breather, no cross-account `--resume` or `Agent(resume:)`); hardens `claude-relay.ps1` with `CONIN$` raw-mode `(mode & 0x0006u) == 0u` gating + `4000ms` background grace, parent-first transcript resolution, `<10s` single self-healing fallback, mid-session disk script drift notices, and `api-request-blob`/metadata/healthy-prose rate-limit false-positive elimination (`$script:RelayNonResponseRecordTypes`, `Get-JsonlEntryErrorState`, tightened `sentinel_hook`).

3. **Supported Countries Policy Anti-Ban Hardening & Scenario G Guard**
   - **Machine-Sticky Proxy & Per-Identity Device IDs**: Keeps `~/.claude/settings(.local).json` residential proxy env sticky across switches (`LEGACY_SETTINGS_ARCHIVE_KEYS` read compatibility + `restore_missing_settings_proxy_env`), stamps deterministic per-identity HMAC `userID` / `anonymousId` / `machineID` / `firstStartTime` across both `Store::switch` and `cli-slots`, adds `64 MiB` bounded in-memory `verify_archive_stream`, and extends isolation to Desktop caches & `.claude/teams`.
   - **Pre-Launch Browser Exit Gate, Remote DNS & Scenario G**: Enforces `preflight_browser_launch_policy` across all 4 companion browser cold-launch paths (blocking unsupported exit countries and naked direct launches on restricted hosts), upgrades all Rust probes & `wakeup` to `socks5h://` / `socks4a://` remote DNS with fail-closed `route_required`, aligns `62` datacenter / `70` residential ASN multi-signal classification 1:1 across Rust & TypeScript (`RCN / Astound AS6079`, `Google Fiber AS16591`) plus `19` Anthropic domain assets, and enforces Scenario G active-identity consistency checks in [`scripts/claude_quota.py`](../scripts/claude_quota.py) to prevent external managers from cross-writing `quota_ledger.json`.

4. **Background Silent Resource Optimization**
   - Configures a bounded Tokio runtime (`2` workers / `8` blocking / `5s` keepalive), switches the Floating HUD (`monitor`) to on-demand creation (`create: false`) + `destroy()` on close, suspends WebView2 (`TrySuspend` + low memory target + working-set trim) and disables `backdrop-filter` via `data-window-hidden="true"` when minimized to tray, parks disabled `wakeup` on `Condvar`, caches `(pid, created_100ns)` Chrome detections, backs off idle `kill_switch` polling to `60s`, single-parses `.claude.json` & skips recursive `projects/` scans on fresh `<=90s` `ServerAnchor` hits, and throttles/pauses hidden/unfocused frontend polling.

5. **Five Workbench UI Refinements & Bilingual Catalog**
   1. **Cleaner Sidebar Header**: Removes the `.sidebar-search-bar` / `.command-palette-trigger` button from the left sidebar while keeping global `Ctrl+K` / `Cmd+K` shortcuts and `<CommandPalette />` intact.
   2. **Streamlined `Claude Code CLI` Card**: Removes the background task and handoff checkpoint callout boxes from Identity Management -> `Claude Code CLI`, keeping `status?.running`, the official install guide, `isAnyCliLive` update lock, and `launchRelayFromPanel`.
   3. **Removed Redundant Smart Relay Library Banner**: Removes the `data-smart-relay-banner` above the Identity Library while preserving the header Smart Relay pill, configuration dialog, and telemetry logic.
   4. **5-Column Usage Analytics Account Table**: Redesigns `.usage-table` from 10 columns to 5 zero-overflow columns (`Account`, `Total tokens`, `Output`, `Est. API cost`, `Cache hit rate`, keeping full 4-part breakdowns in hover tooltips) with 2-line single-row ellipsis identity cells (plan tier, Subscription ROI multiplier, live slot pill, privacy-mask-safe tooltips) and aligned `Locate card` jump button across `1040×820` ZH light & EN dark modes.
   5. **Tight Label-Fit Account Filter & Scoped Popups**: Fits the `.usage-account-filter` trigger tightly to its active label (`28px` height, `8px` radius, `max-width: 184px`) and scopes `[role="listbox"]:not(.command-palette-list)` (`96px..280px`) so compact dropdown popups hug options cleanly without clipping Command Palette or wide Computer selectors; maintains `3,107` matched bilingual keys across `zh.yaml` & `en.yaml`.

### Compatibility & Non-Disruptive Upgrade

- **Full Backward Compatibility**: `BAGAID01` vault headers, `.baga` archives, SQLite `user_version = 3`, account HMAC rules, legacy browser seed strings, and `%APPDATA%\ai.local.claude-local` paths remain unchanged.
- **Seamless In-Place Upgrade**: Upgrades directly from `0.1.x`, `0.2.x`, `0.3.0`, `0.3.1`, `0.3.2`, `0.3.3`, `0.3.5`, or `0.3.6` to `0.3.7` without re-creating identities or interrupting active `claude.exe` sessions.
- **Checksums**: Compare `Claude-Local_0.3.7_x64-setup.exe` against the published `SHA256SUMS.txt` asset via:
  ```powershell
  Get-FileHash .\Claude-Local_0.3.7_x64-setup.exe -Algorithm SHA256
  ```

---

## Attribution & License

- Maintained in this repository as an independent Windows x64 project under the [MIT License](../LICENSE) with preserved third-party copyright notices in [NOTICE](../NOTICE.md).

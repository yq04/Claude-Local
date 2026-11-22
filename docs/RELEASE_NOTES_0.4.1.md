<!-- [INPUT]: Verified v0.4.1 CLI-browser exit sync, cooldown convergence, read-only multi-port Clash snippet dialog, Mihomo cross-section/RFC1918/Sift+Hexagon hardening, and relay/handoff refinements on top of v0.4.0. -->
<!-- [OUTPUT]: Bilingual public GitHub Release notes for Claude-Local v0.4.1 (no automatic updater; non-disruptive Windows x64 upgrade). -->
<!-- [POS]: Tracked documentation artifact paired with git tag v0.4.1 and SHA256SUMS.txt. -->

# Claude-Local v0.4.1

> **独立 Windows x64 发行说明 / Standalone Windows x64 Release Notes**
> 发布日期 Date: `2026-11-22` · 应用标识 Bundle ID: `ai.local.claude-local` · 主程序 Executable: `claude-local.exe` · 伴侣浏览器 Companion Browser: `Claude-Local-Browser`

---

## 中文说明

### 核心更新摘要

`v0.4.1` 基于 `v0.4.0` 开展深度全栈审查与可兼容加固，重点解决 **多账号 CLI ↔ 伴生浏览器出口偏差、接力/唤醒冷却状态单源同步、多静态家宽端口只读规则生成以及防风控规则/交接边缘误判** 等实测痛点，同时完整延续 `BAGAID01` 加密库、隔离槽位与零强杀 `claude.exe` 的安全边界：

1. **CLI ↔ 伴生浏览器出口一致性检测与一键同步（防双端 IP 分裂）**
   - **修正未绑定槽位与切号代理继承（[`workspaces.rs`](../src-tauri/src/browser/workspaces.rs) / [`store.rs`](../src-tauri/src/identities/store.rs)）**：新建非 `legacy` 隔离浏览器槽位时改为优先遵循 `slotProxies` 与 `~/.claude/settings(.local).json` 基线（不再被其他账号自定义 `donor.proxy` 越级抢先继承）；统一 `settings.local.json` 高于 `settings.json` 优先级，并消除切出账号的 `slotProxies` 覆写跨号串流至未设置专属代理的新账号。
   - **智能接力出口偏差告警与一键对齐（[`identities/mod.rs`](../src-tauri/src/identities/mod.rs) / [`identities.tsx`](../src/identities.tsx)）**：在 `identities::State` 只读暴露 `slot_browser_proxies`，并在智能接力弹窗对同一账号 CLI 与伴生浏览器端口/回环别名不一致的槽位标注错配提示，支持展开后一键调用 `identities_sync_browser_proxy`（严格按 `Cleaner -> Browser` 锁序且安全拒绝运行中的浏览器窗口）转换并同步为 `socks5://host:port`。
   - **全栈回环与默认代理归一（[`orchestrator/config.rs`](../src-tauri/src/identities/orchestrator/config.rs) / [`smart-relay-model.ts`](../src/smart-relay-model.ts)）**：统一 `localhost` / `127.0.0.1` / `[::1]` 归一化并拒绝无端口 URL；通过 `cli_default_proxy` 向前端精确传递 `~/.claude` 实测默认代理（未设置时正确识别为未配置而非假定 `:7899`），完善同出口聚集检测并支持多簇展示。

2. **冷却状态单一真相源与智能接力界面细节收敛**
   - **冷却写盘与原子清除防回弹（[`slots.rs`](../src-tauri/src/identities/orchestrator/slots.rs) / [`orchestrator/mod.rs`](../src-tauri/src/identities/orchestrator/mod.rs)）**：修复子代理 `apply_slot_failure_cooldown` 写入冷却时未递增 `rotation_tick` 导致前端保存静默抹除冷却的竞争窗口；新增 `identities_orchestrator_clear_cooldown` 原子清除命令（同步清理匹配 `no_return_*` 锁并清理 stray `"current"` 键），彻底避免 UI 清冷却后被磁盘高版本 tick 复活。
   - **自动唤醒 429 被动联动与技术债清理（[`wakeup.rs`](../src-tauri/src/identities/wakeup.rs)）**：仅在现有 `AutoWakeup` 被动收到 `RateLimited (429)` 时通过跨进程 `.orchestrate.lock` 同步写回 `smart_relay_v1.json` 冷却时间戳（零新增后台轮询）；移除前端失效字段 `autoSwitchWhenIdle`，修复暗色模式下 `.identity-relay-proxy-error` 与 `.is-invalid` 对比度，并精简英文长标签以稳守 `108px` 单轴对齐。

3. **只读多端口家宽 Clash 规则生成器、Mihomo 审计与风控细节加固**
   - **网络页只读 Clash 多端口 YAML 弹窗（[`vps.tsx`](../src/vps.tsx)）**：在保留全部固定只读/仅复制边界及原有推广入口不变的前提下，新增独立弹窗生成器，按需生成 `2–5` 个绑定 `127.0.0.1` 纯 TCP（`udp: false`）本地监听端口与完整 `prepend-rules`（覆盖 `claude.ai`、`anthropic.com`、`sift.com`/`siftscience.com`、`hexagon-cdn.com`/`hexagon-analytics.com`、`withpersona.com`、`yoti.com`、`datadoghq` 等），纯本地复制使用、零改写用户 Clash 配置。
   - **Mihomo 规则审计与 CLI 护盾一致性（[`risk_check.rs`](../src-tauri/src/risk_check.rs) / [`risk-model.ts`](../src/risk-model.ts) / [`risk-verification.tsx`](../src/risk-verification.tsx)）**：修复 `rules:` 与 `prepend-rules:` 跨段 `seen_unresolved_ip_rule` 状态的互相污染，豁免 RFC1918 私网网段，收紧 `has_sift_rules` 须同时覆盖 Sift 与 Hexagon 域；在确认读取到 `running_core` 时对缺失 Sift/Telemetry 规则清晰标黄提示，补充 `NO_PROXY` 缺本地回环告警，并明确 [`oauth_route.rs`](../src-tauri/src/browser/oauth_route.rs) 排除 `platform.claude.com` 的设计注解。
   - **防篡改探针与 `/kyc_status` 规范化（[`browser-start.tsx`](../src/browser-start.tsx) / [`browser.tsx`](../src/browser.tsx) / [`content.js`](../browser-runtime/quota-bridge/content.js) / [`background.js`](../browser-runtime/quota-bridge/background.js)）**：在保持 20 项 `REQUIRED_CHECK_IDS` 契约的前提下收紧 `availWidth/availHeight > 0`、`languages.length > 0`、`pixelDepth === colorDepth >= 24`、`devicePixelRatio > 0` 与 UA-CH 平台一致性校验；已绑定 ≥2 个浏览器账号时温和展示 `native_graphics` 多号权衡提示（保持默认开启）；规范化 `/kyc_status` 状态小写投影并区分 `expired` 与 `failed` 展示观测年龄。

4. **两阶段主动阈切、防误报交接与脚本一致性**
   - **子代理收尾与交接摘要修复（[`scripts/claude-relay.ps1`](../scripts/claude-relay.ps1) / [`handoff.rs`](../src-tauri/src/identities/handoff.rs) / [`scripts/claude_quota.py`](../scripts/claude_quota.py)）**：`forced_stop` 对未完成内部子代理补齐 `300s` 有界等待与 `Remove-HandoffSensitiveText` 64 位十六进制哈希脱敏；[`handoff.rs`](../src-tauri/src/identities/handoff.rs) 先过滤非响应记录类型（`api-request-blob` 等）与 `user` 提示后再判限流（杜绝正文提及限流关键词触发 `interrupted_429` 误判），并可选透传 `handoffReason` 至智能接力弹窗内联标签；同步对齐 `claude-subagent.ps1` / 模板文档并发默认值 `1` 与 `statusLine` 对 `affinityMode`（`manual` / `session`）的提示门槛。

### 兼容性与无损升级说明

- **数据格式 100% 向下兼容**：完整保留 `BAGAID01` 魔数、`.baga` 归档编码、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串以及 `%APPDATA%\ai.local.claude-local` 私有目录结构。
- **平滑无中断升级**：支持从 `0.1.x`、`0.2.x`、`0.3.x` 与 `0.4.0` 直接安装升级至 `0.4.1`，保留所有已有身份、密钥与隔离浏览器资料，不强制中断正在运行的 `claude.exe` 会话。
- **校验与核验**：安装前可用 PowerShell 校验并对比随附 `SHA256SUMS.txt`：
  ```powershell
  Get-FileHash .\Claude-Local_0.4.1_x64-setup.exe -Algorithm SHA256
  ```

---

## English Release Notes

### Highlights

Building on `v0.4.0`, **`v0.4.1`** follows a deep two-pass full-stack audit and ships **CLI ↔ companion browser exit-proxy synchronization, atomic single-source cooldown convergence, a read-only multi-port Clash YAML helper, and targeted anti-ban/relay edge-case hardening** — while preserving encrypted vault compatibility and zero-kill `claude.exe` guarantees:

1. **CLI ↔ Companion Browser Exit Alignment & Anti-Bleed Protection**
   - **Inheritance & Switch Isolation Fixes ([`workspaces.rs`](../src-tauri/src/browser/workspaces.rs) / [`store.rs`](../src-tauri/src/identities/store.rs))**: Stops newly created unbound browser slots from inheriting another account's custom `donor.proxy` ahead of `~/.claude/settings(.local).json`; aligns `read_live_proxy_env_from_home` priority (`settings.local.json` > `settings.json`) and prevents outgoing `slotProxies` overrides from bleeding across switches into accounts without per-slot proxies.
   - **Mismatch Detection & 1-Click Browser Sync ([`identities/mod.rs`](../src-tauri/src/identities/mod.rs) / [`identities.tsx`](../src/identities.tsx))**: Exposes read-only `slot_browser_proxies` on `identities::State`, highlights mismatched CLI vs. browser exit endpoints inside Smart Relay rows, and adds `identities_sync_browser_proxy` (strict `Cleaner -> Browser` lock order, refusing active windows) to align bound closed browser slots to `socks5://host:port`.
   - **Loopback & Fallback Normalization ([`orchestrator/config.rs`](../src-tauri/src/identities/orchestrator/config.rs) / [`smart-relay-model.ts`](../src/smart-relay-model.ts))**: Unifies `localhost` / `127.0.0.1` / `[::1]` across Rust & TS, rejects portless URLs, and exposes `cli_default_proxy` on `OrchestratorStateView` so `findSameExitClusterWarning` never miscounts unproxied slots as `:7899`.

2. **Single-Source Cooldown Convergence & Wakeup Link**
   - **Atomic Clear & Tick Preservation ([`slots.rs`](../src-tauri/src/identities/orchestrator/slots.rs) / [`orchestrator/mod.rs`](../src-tauri/src/identities/orchestrator/mod.rs))**: Bumps monotonic `rotation_tick` on `apply_slot_failure_cooldown` so GUI config saves no longer overwrite subagent failure cooldowns; strips stray `"current"` cooldown keys; introduces `identities_orchestrator_clear_cooldown` (atomically clearing cooldowns + matching `no_return_*` locks under `.orchestrate.lock`); removes dead `autoSwitchWhenIdle`.
   - **Passive Wakeup 429 Propagation & Dark-Mode Polish ([`wakeup.rs`](../src-tauri/src/identities/wakeup.rs) / [`identity-productivity.css`](../src/identity-productivity.css))**: Propagates observed `OnlineStatus::RateLimited` backoffs from `wakeup.rs` into `smart_relay_v1.json` without adding any background polling; improves dark-mode contrast for `.identity-relay-proxy-error` / `.is-invalid` and keeps EN labels aligned cleanly on the `108px` Smart Relay track.

3. **Read-Only Multi-Port Clash Generator, Risk Hardening & Bridge Normalization**
   - **Copy-Only Multi-Port Clash Dialog ([`vps.tsx`](../src/vps.tsx))**: Adds an isolated utility modal for copying `2–5` TCP-only (`udp: false`, `127.0.0.1`) Clash `listeners` plus full `prepend-rules` (`claude.ai`, `anthropic.com`, `sift.com`/`siftscience.com`, `hexagon-cdn.com`/`hexagon-analytics.com`, `withpersona.com`, `yoti.com`, `datadoghq`, etc.) without mutating user proxy configs or breaking existing Network page contracts.
   - **Mihomo Audit & CLI Parity ([`risk_check.rs`](../src-tauri/src/risk_check.rs) / [`risk-model.ts`](../src/risk-model.ts) / [`risk-verification.tsx`](../src/risk-verification.tsx))**: Isolates `seen_unresolved_ip_rule` across `prepend-rules:`/`rules:`/`append-rules:`, exempts RFC1918 CIDRs, requires Sift + Hexagon together for `has_sift_rules`, highlights confirmed missing Sift/Telemetry rules on `running_core`, warns when `NO_PROXY` omits loopback addresses, and documents `platform.claude.com` exclusion rationale in [`oauth_route.rs`](../src-tauri/src/browser/oauth_route.rs).
   - **Anti-Tamper & `/kyc_status` Normalization ([`browser-start.tsx`](../src/browser-start.tsx) / [`browser.tsx`](../src/browser.tsx) / [`content.js`](../browser-runtime/quota-bridge/content.js) / [`background.js`](../browser-runtime/quota-bridge/background.js))**: Tightens desktop screen/depth/DPR/languages/UA-CH invariants within `probeClientHintsAndScreen()`, surfaces an inline `native_graphics` multi-account reminder when `>=2` browser slots are bound (keeping default `true`), normalizes `/kyc_status` casing, and distinguishes `expired` vs. `failed` with observation age.

4. **Proactive Relay, Handoff False-Positive & CLI Script Refinements**
   - **Safe `forced_stop` Subagent Wait & Handoff Hygiene ([`scripts/claude-relay.ps1`](../scripts/claude-relay.ps1) / [`handoff.rs`](../src-tauri/src/identities/handoff.rs) / [`scripts/claude_quota.py`](../scripts/claude_quota.py))**: Guards `forced_stop` against interrupting live internal background subagents cleanly up to the `300s` cap and redacts 64-hex identifiers in `Remove-HandoffSensitiveText`; filters non-response JSONL entries (`api-request-blob`, etc.) and `user` prompts before rate-limit classification in `handoff.rs` with optional `handoffReason` badge telemetry; aligns `claude-subagent.ps1` / prompt docs default concurrency to `1` and honors `affinityMode` in `claude_quota.py --statusline`.

### Compatibility & Non-Disruptive Upgrade

- **Full Backward Compatibility**: `BAGAID01` vault headers, `.baga` archives, SQLite `user_version = 3`, account HMAC rules, legacy browser seed strings, and `%APPDATA%\ai.local.claude-local` paths remain unchanged.
- **Seamless In-Place Upgrade**: Upgrades directly from `0.1.x`, `0.2.x`, `0.3.x`, and `0.4.0` to `0.4.1` without re-creating identities or interrupting active `claude.exe` sessions.
- **Checksums**: Compare `Claude-Local_0.4.1_x64-setup.exe` against the published `SHA256SUMS.txt` asset via:
  ```powershell
  Get-FileHash .\Claude-Local_0.4.1_x64-setup.exe -Algorithm SHA256
  ```

---

## Attribution & License

- Maintained in this repository as an independent Windows x64 project under the [MIT License](../LICENSE) with preserved third-party copyright notices in [NOTICE](../NOTICE.md).

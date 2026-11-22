<!-- [INPUT]: Verified v0.4.2 zero-warning Rust cleanup, cross-stack dead-code/CSS/i18n pruning, broken TaskHandoff removal, and zero-behavior-change modular splits atop v0.4.1. -->
<!-- [OUTPUT]: Bilingual public GitHub Release notes for Claude-Local v0.4.2 (no automatic updater; non-disruptive Windows x64 upgrade). -->
<!-- [POS]: Tracked documentation artifact paired with git tag v0.4.2 and SHA256SUMS.txt. -->

# Claude-Local v0.4.2

> **独立 Windows x64 发行说明 / Standalone Windows x64 Release Notes**
> 发布日期 Date: `2026-11-22` · 应用标识 Bundle ID: `ai.local.claude-local` · 主程序 Executable: `claude-local.exe` · 伴侣浏览器 Companion Browser: `Claude-Local-Browser`

---

## 中文说明

### 核心更新摘要

`v0.4.2` 基于 `v0.4.1` 开展全栈**去冗余、零警告收敛与模块化重构**，在不改变任何运行时功能、几何契约与加密数据格式的前提下，显著降低长期维护成本与编译噪声：

1. **Rust 编译器零警告收敛与重复逻辑消除（`0` `dead_code` / 编译器警告）**
   - **消除全部 `7` 处 `dead_code` 告警与 `9` 个仅测试暴露辅助项**：
     - 将仅测试调用的 `ExitKind`/`classify_exit`（[`browser/network.rs`](../src-tauri/src/browser/network.rs)）、`TICKET_TTL`/`MAX_PENDING_TICKETS`（[`browser/quota_bridge.rs`](../src-tauri/src/browser/quota_bridge.rs)）、`apply_manual`（[`identities/subscription.rs`](../src-tauri/src/identities/subscription.rs)）与 `diagnose_urls`（[`network_links.rs`](../src-tauri/src/network_links.rs)）收归 `#[cfg(test)]`。
     - 将 `capture_normal_size`（[`window_state_model.rs`](../src-tauri/src/window_state_model.rs)）按非 Windows / 测试用途收归 `#[cfg(any(not(windows), test))]`。
     - 删除 [`cleaner_identity.rs`](../src-tauri/src/cleaner_identity.rs) 中无调用死函数 `apply_config`，将 `sanitize_cross_account_residue` 由 `#[allow(dead_code)]` 改为 `#[cfg(test)]` 并收口 9 个仅测试会话清理辅助常量/函数。
   - **单一真实来源合并**：在 [`identities/mod.rs`](../src-tauri/src/identities/mod.rs) 提供共享 `pub(crate) fn valid_fingerprint`，移除 `identities/online.rs` 与 `identities/subscription.rs` 的重复实现。

2. **全栈死代码、废弃交互与 CSS / 双语词库瘦身**
   - **Python & PowerShell 清理**：删除 [`scripts/claude_quota.py`](../scripts/claude_quota.py) 中未引用的 `merge_window_state`、`parse_jsonl_file_into`、`_read_saved_identity_names`，以及 [`scripts/claude-relay.ps1`](../scripts/claude-relay.ps1) 中无调用死函数 `Send-ConsoleExitCommand`。
   - **前端死符号与废弃表单剪枝**：
     - 移除 `FAULT_NAVIGATE_EVENT`（[`src/app-events.ts`](../src/app-events.ts)）、只写不读的 `AuditHistoryItem`/`getAuditHistoryItems`/`recordAuditHistoryItem`/`Activity.history`（[`src/cleaner-activity.tsx`](../src/cleaner-activity.tsx)）、`DefaultBrowser`/`DeepVerifySite`/`DEEP_VERIFY_SITES`（[`src/browser-model.ts`](../src/browser-model.ts)）、多余导出的 `MULTI_PORT_CLASH_DOMAINS`（[`src/risk-model.ts`](../src/risk-model.ts)）及已淘汰的旧悬浮窗 ETA/Context 与归因预览辅助函数。
     - 剪除已无可见入口且存在嵌套弹窗缺陷的早期手工模板表单 `TaskHandoff` 及 6 个遗留交接文件（完整保留 `Ctrl+K` 智能接力/复核/刷新/跳转命令）。
   - **CSS 与双语词库减负**：[`src/style.css`](../src/style.css)、[`src/identity-productivity.css`](../src/identity-productivity.css) 与 [`src/productivity-shell.css`](../src/productivity-shell.css) 共净减 `497` 行死样式规则；[`src/locales/zh.yaml`](../src/locales/zh.yaml) 与 [`src/locales/en.yaml`](../src/locales/en.yaml) 同步剪除 `743` 条零引用键（`3,165 → 2,422` 键严格 1:1 对齐且 `en.yaml` 保持 `0` 个 CJK 字符），保留全部动态类、`37` 条 CLI 内嵌脚本键、`backup.rs` 动态键与测试专用键。

3. **超大文件零行为变化模块化拆分**
   - **Rust 后端拆分**：将原 `2,516` 行 `risk_check.rs` 拆分为 [`src-tauri/src/risk_check/`](../src-tauri/src/risk_check/mod.rs) 6 个职责子模块（`mod.rs` / `mihomo.rs` / `system_net.rs` / `cli.rs` / `probe.rs` / `tests.rs`）；将原 `2,992` 行 `identities/profile.rs` 拆分为 [`src-tauri/src/identities/profile/`](../src-tauri/src/identities/profile/mod.rs) 5 个子模块（`mod.rs` / `local_usage.rs` / `ledger.rs` / `adopt_sessions.rs` / `tests.rs`），所有公共路径与 `#[tauri::command]` 保持不变。
   - **前端组件拆分**：将 [`src/identities.tsx`](../src/identities.tsx) 由 `5,443` 行收敛为 `3,018` 行协调外壳，提取 [`src/identities/`](../src/identities/CLAUDE.md) 下 5 个独立子模块（`IdentityCardPrimitives.tsx`、`WakeupModal.tsx`、`SmartRelayModal.tsx`、`QuotaDetailsModal.tsx`、`IdentityActionDialogs.tsx`），并升级 [`src/i18n.test.ts`](../src/i18n.test.ts) 递归扫描全部子目录。

### 兼容性与无损升级说明

- **数据与界面契约 100% 向下兼容**：完整保留 `BAGAID01` 魔数、`.baga` 归档编码、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串、`166×286` `.identity-card`、20 项 `REQUIRED_CHECK_IDS`、`native_graphics: true` 默认值以及 `%APPDATA%\ai.local.claude-local` 目录结构。
- **平滑无中断升级**：支持从 `0.1.x`、`0.2.x`、`0.3.x`、`0.4.0` 与 `0.4.1` 直接升级至 `v0.4.2`，不破坏已有身份、密钥与浏览器登录状态，不强制中断在线 `claude.exe` 会话。
- **校验与核验**：安装前可用 PowerShell 校验并对比随附 `SHA256SUMS.txt`：
  ```powershell
  Get-FileHash .\Claude-Local_0.4.2_x64-setup.exe -Algorithm SHA256
  ```

---

## English Release Notes

### Highlights

**`v0.4.2`** is a full-stack **de-redundancy, zero-warning compiler cleanup, and modular decomposition** release on top of `v0.4.1`, improving long-term maintainability without changing runtime behavior, UI geometry contracts, or vault formats:

1. **Zero-Warning Rust Cleanup (`0` `dead_code` / Compiler Warnings)**
   - **Resolved all `7` `dead_code` warnings + `9` test-only session helpers**:
     - Gated test-only symbols with `#[cfg(test)]`: `ExitKind`/`classify_exit` ([`browser/network.rs`](../src-tauri/src/browser/network.rs)), `TICKET_TTL`/`MAX_PENDING_TICKETS` ([`browser/quota_bridge.rs`](../src-tauri/src/browser/quota_bridge.rs)), `apply_manual` ([`identities/subscription.rs`](../src-tauri/src/identities/subscription.rs)), and `diagnose_urls` ([`network_links.rs`](../src-tauri/src/network_links.rs)).
     - Gated `capture_normal_size` ([`window_state_model.rs`](../src-tauri/src/window_state_model.rs)) with `#[cfg(any(not(windows), test))]`.
     - Removed dead `apply_config` in [`cleaner_identity.rs`](../src-tauri/src/cleaner_identity.rs), replaced `#[allow(dead_code)]` on `sanitize_cross_account_residue` with `#[cfg(test)]`, and gated its 9 test-only session sanitization helpers.
   - **Shared Helper Consolidation**: Consolidated duplicated `valid_fingerprint` into `pub(crate) fn valid_fingerprint` in [`identities/mod.rs`](../src-tauri/src/identities/mod.rs).

2. **Cross-Stack Dead Code, Obsolete UI, CSS & i18n Pruning**
   - **Python & PowerShell**: Removed unreferenced `merge_window_state`, `parse_jsonl_file_into`, and `_read_saved_identity_names` from [`scripts/claude_quota.py`](../scripts/claude_quota.py), and dead `Send-ConsoleExitCommand` from [`scripts/claude-relay.ps1`](../scripts/claude-relay.ps1).
   - **TypeScript & Broken Legacy Dialog Removal**: Pruned `FAULT_NAVIGATE_EVENT` ([`src/app-events.ts`](../src/app-events.ts)), write-only `AuditHistoryItem`/`getAuditHistoryItems`/`recordAuditHistoryItem`/`Activity.history` ([`src/cleaner-activity.tsx`](../src/cleaner-activity.tsx)), `DefaultBrowser`/`DeepVerifySite`/`DEEP_VERIFY_SITES` ([`src/browser-model.ts`](../src/browser-model.ts)), unused `export` on `MULTI_PORT_CLASH_DOMAINS` ([`src/risk-model.ts`](../src/risk-model.ts)), excluded floating-monitor ETA/context & attribution-scope preview helpers, and the obsolete broken-nested `TaskHandoff` form alongside its 6 legacy handoff files (preserving all `Ctrl+K` Smart Relay/review/refresh/navigation commands).
   - **CSS & Locale Pruning**: Removed `497` dead CSS lines across [`src/style.css`](../src/style.css), [`src/identity-productivity.css`](../src/identity-productivity.css), and [`src/productivity-shell.css`](../src/productivity-shell.css); pruned `743` zero-reference i18n keys (`3,165 → 2,422` keys in exact `1:1` parity across `zh.yaml` & `en.yaml`, `0` CJK characters in `en.yaml`) while preserving all dynamic CSS classes, the `37` embedded CLI script keys, dynamic Rust keys, and test-referenced keys.

3. **Zero-Behavior-Change Modular Decomposition**
   - **Rust Backend**: Split `risk_check.rs` (`2,516L`) into 6 modules under [`src-tauri/src/risk_check/`](../src-tauri/src/risk_check/mod.rs) (`mod.rs`, `mihomo.rs`, `system_net.rs`, `cli.rs`, `probe.rs`, `tests.rs`) and `identities/profile.rs` (`2,992L`) into 5 modules under [`src-tauri/src/identities/profile/`](../src-tauri/src/identities/profile/mod.rs) (`mod.rs`, `local_usage.rs`, `ledger.rs`, `adopt_sessions.rs`, `tests.rs`), preserving all `#[tauri::command]` and `crate::*` paths.
   - **React Frontend**: Decomposed [`src/identities.tsx`](../src/identities.tsx) (`5,443L → 3,018L`) by extracting 5 dedicated components under [`src/identities/`](../src/identities/CLAUDE.md) (`IdentityCardPrimitives.tsx`, `WakeupModal.tsx`, `SmartRelayModal.tsx`, `QuotaDetailsModal.tsx`, `IdentityActionDialogs.tsx`), and updated [`src/i18n.test.ts`](../src/i18n.test.ts) to scan subdirectories recursively.

### Compatibility & Non-Disruptive Upgrade

- **Full Backward Compatibility**: `BAGAID01` vault headers, `.baga` archives, SQLite `user_version = 3`, account HMAC rules, legacy browser seed strings, `166×286` identity cards, 20 `REQUIRED_CHECK_IDS`, `native_graphics: true`, and `%APPDATA%\ai.local.claude-local` paths remain unchanged.
- **Seamless In-Place Upgrade**: Upgrades directly from `0.1.x`–`0.4.1` to `v0.4.2` without re-creating identities or interrupting active `claude.exe` sessions.
- **Checksums**: Compare `Claude-Local_0.4.2_x64-setup.exe` against the published `SHA256SUMS.txt` asset via:
  ```powershell
  Get-FileHash .\Claude-Local_0.4.2_x64-setup.exe -Algorithm SHA256
  ```

---

## Attribution & License

- Maintained in this repository as an independent Windows x64 project under the [MIT License](../LICENSE) with preserved third-party copyright notices in [NOTICE](../NOTICE.md).

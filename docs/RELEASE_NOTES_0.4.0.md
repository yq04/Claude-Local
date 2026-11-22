<!-- [INPUT]: Verified v0.4.0 proactive 2-stage threshold auto-relay, single-axis Smart Relay UI alignment & cluster warning, and Sift v122/Yoti/KYC anti-ban upgrades on top of v0.3.7. -->
<!-- [OUTPUT]: Bilingual public GitHub Release notes for Claude-Local v0.4.0 (no automatic updater; non-disruptive Windows x64 upgrade). -->
<!-- [POS]: Tracked documentation artifact paired with git tag v0.4.0 and SHA256SUMS.txt. -->

# Claude-Local v0.4.0

> **独立 Windows x64 发行说明 / Standalone Windows x64 Release Notes**
> 发布日期 Date: `2026-11-22` · 应用标识 Bundle ID: `ai.local.claude-local` · 主程序 Executable: `claude-local.exe` · 伴侣浏览器 Companion Browser: `Claude-Local-Browser`

---

## 中文说明

### 核心更新摘要

`v0.4.0` 在 `v0.3.7` 工作台基线之上，围绕 **两阶段主动阈值自动换号接力、智能接力弹窗排版重构与同出口聚集提示、以及基于 Sift Science v122 / Yoti / `/kyc_status` 的全链路风控升级** 完成全面加固与回归，同时完整保留 `BAGAID01` 加密库、隔离槽位与零强杀 `claude.exe` 的兼容性与安全边界：

1. **两阶段主动阈值自动换号接力（避免打满 5h 额度）**
   - **阈值扩展与默认安全收敛**：换号阈值扩展至 `80% / 85% / 90% / 95% / 98% / 100%`；UI 移除易引发误解的「同出口并发」行及提示条，`maxSameExitConcurrency` 默认收敛为 `1`（后端仍向后兼容 `1..=5` 读取）。
   - **两阶段平滑收尾接力（[`scripts/claude-relay.ps1`](../scripts/claude-relay.ps1) / [`scripts/claude_quota.py`](../scripts/claude_quota.py)）**：当 `quota_ledger.json` 触达用户设定的阈值且存在可用备用号时，临时钩子于 `PostToolUse` 注入收尾提示（阶段 1 允许完成当前工具调用步骤与交接整理，至多 2 个工具调用后阶段 2 切换至 `forced_stop` 自动 `/exit` 交接并换号续跑），防止 `5h` 额度持续打满 `100%` 触发蒸馏或高频风控。
   - **交互兜底与交接扩容**：补齐 `OpusPlan` 官方混合别名 tooltip 与说明；将 `handoff` 脱敏摘要扩容至 `1200` 字符；修复 `turnEndExternalDeferred` 在外部非 Claude 子代理 `300s` 等待超时后未落入阈值检测与 `/exit` 的缺陷，并完善两阶段等待期间 `5h` 中途重置时的状态文件清理。

2. **「多账号智能接力」弹窗排版对齐与同出口聚集提示**
   - **单轴零漂移表单排版（[`src/identities.tsx`](../src/identities.tsx) / [`src/identity-productivity.css`](../src/identity-productivity.css)）**：移除 `.identity-relay-form-pair`，将「路由」「被限流时」「会话保持」「换号阈值」与下方 CLI 无感接力卡片全部统一为固定 `108px` 标签列 + `minmax(0, 1fr)` 单轴排版、`12px 14px` 一致内边距与统一 `26px` 高/等宽圆角胶囊按钮，在 `1040×820` 视口实测 10 行标签与控件零像素偏移、零横向溢出，同时保持 `.identity-card` `166×286` 几何与零 `transform` 过渡不变。
   - **≥3 号共用同出口温和提醒（[`src/smart-relay-model.ts`](../src/smart-relay-model.ts)）**：新增纯函数 `findSameExitClusterWarning`，跨协议归一化识别启用接力池中 ≥3 个账号共用同一出口端口（如多个 `http`/`socks5`/`localhost` 汇聚同一端口）并展示非阻塞提示。

3. **Sift v122 / Yoti 分流审计、同源只读 `/kyc_status` 观测与伴生指纹指引**
   - **Sift / Hexagon 与 Yoti 全链路补齐（[`src/risk-model.ts`](../src/risk-model.ts) / [`src/vps.tsx`](../src/vps.tsx) / [`src-tauri/src/risk_check.rs`](../src-tauri/src/risk_check.rs)）**：在桌面/移动端防漏域名、Mihomo 覆写 YAML 与 AI 提示词中补全 `sift.com`、`siftscience.com`、`hexagon-cdn.com`、`hexagon-analytics.com` 与 `yoti.com`；原生 Mihomo 结构审计新增 `has_sift_rules` 并扩展 `has_persona_rules` 同时校验 Persona 与 Yoti 规则同组对齐，并在「风控验证」页面展示可审计状态与明细。
   - **伴生浏览器防篡改探针强化（[`src/browser-start.tsx`](../src/browser-start.tsx)）**：在保持既有 20 项 `REQUIRED_CHECK_IDS` 契约不变的前提下，于 `probeClientHintsAndScreen()` 补充 `screen >= avail`、`navigator.language === languages[0]`、窗口框架 `outerWidth/outerHeight` 非零与 `pdfViewerEnabled` 校验。
   - **显式同步顺带采集 `/kyc_status`（MV3 桥接 → Rust → Python → UI）**：仅在用户手动触发网页用量同步时同源并发请求 `/api/organizations/{org_id}/kyc_status`（零后台轮询、零 OAuth 调用）；MV3 [`content.js`](../browser-runtime/quota-bridge/content.js) / [`background.js`](../browser-runtime/quota-bridge/background.js)、Rust [`quota_bridge.rs`](../src-tauri/src/browser/quota_bridge.rs) 与 Python [`claude_quota_online.py`](../scripts/claude_quota_online.py) 三层严格白名单仅保留 `{ status, check_kind }` 并彻底剥离 `vendor_inquiry_id` / `vendor_inquiry_url`；额度详情弹窗对 `not_required` 显式标注「暂无需 KYC（不代表零风控）」。
   - **伴生指纹多号权衡提示（[`src/browser.tsx`](../src/browser.tsx)）**：保持 `native_graphics: true` 默认行为完全不变，在其开关下方补充单号 Turnstile 兼容性与多号网页 Sift 硬件指纹共享的清晰取舍指引。

### 兼容性与无损升级说明

- **数据格式 100% 向下兼容**：完整保留 `BAGAID01` 魔数、`.baga` 归档编码、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串以及 `%APPDATA%\ai.local.claude-local` 私有目录结构。
- **平滑无中断升级**：支持从 `0.1.x`、`0.2.x` 与 `0.3.x`（含 `0.3.7`）直接安装升级至 `0.4.0`，保留所有已有身份、密钥与隔离浏览器资料，不强制中断正在运行的 `claude.exe` 会话。
- **校验与核验**：安装程序构建与隐私核验汇总于随附 `SHA256SUMS.txt`；安装前可用 PowerShell 校验：
  ```powershell
  Get-FileHash .\Claude-Local_0.4.0_x64-setup.exe -Algorithm SHA256
  ```

---

## English Release Notes

### Highlights

Building on the `v0.3.7` baseline, **`v0.4.0`** introduces **two-stage proactive threshold auto-relay (before hitting 5h 100%), aligned Smart Relay UI with ≥3 same-exit cluster guidance, and Sift Science v122 / Yoti / read-only `/kyc_status` anti-ban hardening** — while preserving all encrypted vault formats, browser isolation boundaries, and zero-kill `claude.exe` guarantees:

1. **Proactive 2-Stage Graceful Threshold Auto-Relay**
   - **Expanded Thresholds & Conservative Concurrency Default**: Expands `spentThresholdPct` options to `80% / 85% / 90% / 95% / 98% / 100%`; removes the confusing same-exit concurrency UI controls and defaults `maxSameExitConcurrency` to `1` while retaining `1..=5` backend schema compatibility.
   - **2-Stage Wrap-Up Handoff ([`scripts/claude-relay.ps1`](../scripts/claude-relay.ps1) / [`scripts/claude_quota.py`](../scripts/claude_quota.py))**: When `quota_ledger.json` reaches the configured threshold and standby accounts are available, ephemeral `PostToolUse` hooks guide Claude to finish active tool work (up to 2 wrap-up steps) before cleanly advancing to `forced_stop` `/exit` and switching accounts before exhausting the `5h` window.
   - **Reliability & Handoff Improvements**: Documents the built-in `OpusPlan` alias in UI copy, expands scrubbed handoff digests to `1200` chars, fixes the `300s` `turnEndExternalDeferred` external-worker timeout fallthrough, and cleans up proactive state files when a `5h` reset occurs mid-wrap-up.

2. **Smart Relay Modal Alignment & Same-Exit Cluster Hint**
   - **Single-Axis Form Alignment ([`src/identities.tsx`](../src/identities.tsx) / [`src/identity-productivity.css`](../src/identity-productivity.css))**: Removes `.identity-relay-form-pair` and unifies both the Routing and CLI sections on a strict `108px` label track with `26px` uniform chips (`0px` horizontal drift across all 10 rows and zero horizontal overflow at `1040×820`) while keeping `.identity-card` `166×286` geometry untouched.
   - **≥3 Shared-Exit Cluster Notice ([`src/smart-relay-model.ts`](../src/smart-relay-model.ts))**: Adds `findSameExitClusterWarning` to normalize resolved account proxies across schemes and loopback aliases and show a non-blocking warning when 3 or more enabled accounts converge on one exit port.

3. **Sift v122 / Yoti Rule Audit, Read-Only `/kyc_status` & Browser Fingerprint Guidance**
   - **Full-Chain Sift & Yoti Routing ([`src/risk-model.ts`](../src/risk-model.ts) / [`src/vps.tsx`](../src/vps.tsx) / [`src-tauri/src/risk_check.rs`](../src-tauri/src/risk_check.rs))**: Adds `sift.com`, `siftscience.com`, `hexagon-cdn.com`, `hexagon-analytics.com`, and `yoti.com` across desktop/mobile Mihomo rules, AI prompts, and Rust `MihomoAudit` (`has_sift_rules` + unified Persona/Yoti group alignment check).
   - **Sift v122 Anti-Tamper Probes ([`src/browser-start.tsx`](../src/browser-start.tsx))**: Strengthens `probeClientHintsAndScreen()` (`screen >= avail`, `language === languages[0]`, non-zero window outer dimensions, `pdfViewerEnabled`) without changing the 20 `REQUIRED_CHECK_IDS`.
   - **Allowlisted `/kyc_status` Bridge (MV3 → Rust → Python → UI)**: Piggybacks `/api/organizations/{org_id}/kyc_status` strictly on explicit user-triggered web usage sync (zero polling, zero OAuth calls), stripping `vendor_inquiry_id` and `vendor_inquiry_url` at every layer and displaying `"not_required"` truthfully in the Quota Details dialog as `"No KYC required (not a risk-free guarantee)"`.
   - **Multi-Account `native_graphics` Guidance ([`src/browser.tsx`](../src/browser.tsx))**: Preserves `native_graphics: true` default while clarifying single-account Turnstile compatibility vs. multi-account Canvas/ClientRects isolation tradeoffs.

### Compatibility & Non-Disruptive Upgrade

- **Full Backward Compatibility**: `BAGAID01` vault headers, `.baga` archives, SQLite `user_version = 3`, account HMAC rules, legacy browser seed strings, and `%APPDATA%\ai.local.claude-local` paths remain unchanged.
- **Seamless In-Place Upgrade**: Upgrades directly from `0.1.x`, `0.2.x`, and `0.3.x` (including `0.3.7`) to `0.4.0` without re-creating identities or interrupting active `claude.exe` sessions.
- **Checksums**: Compare `Claude-Local_0.4.0_x64-setup.exe` against the published `SHA256SUMS.txt` asset via:
  ```powershell
  Get-FileHash .\Claude-Local_0.4.0_x64-setup.exe -Algorithm SHA256
  ```

---

## Attribution & License

- Maintained in this repository as an independent Windows x64 project under the [MIT License](../LICENSE) with preserved third-party copyright notices in [NOTICE](../NOTICE.md).

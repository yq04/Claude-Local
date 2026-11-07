<!--
[INPUT]: Source-confirmed Windows x64 0.3.0 Claude Code v2.1.309~2.1.318 cleanroom telemetry & credential isolation, CLI telemetry shield & MCP supply-chain security audit, Smart Relay 2.0 (Magpie WeekLow Tier-0 promotion, claude-swap 24h post-reset pace silence, dynamic switch margin, standby candidate banner), Floating Monitor HUD 2.0 (truthful edge bar fills, standby pill, Escape hide, UI zoom), and persistent audit timeline & wakeup 5h anchor verification.
[OUTPUT]: Bilingual public release notes; artifact hashes come only from the audited build's SHA256SUMS.txt.
[POS]: Public release notes linked from both READMEs and the v0.3.0 GitHub Release.
[PROTOCOL]: Retain attribution and persistent format compatibility; never require Companion Browser as the Windows default browser.
-->

# Claude-Local 0.3.0 发布说明 / Release Notes

Claude-Local 基于 [CCBaga](https://github.com/liseami/CCBaga)（[@liseami](https://github.com/liseami) 及贡献者）二次开发并独立维护，保留原贡献者版权与 [MIT 许可](https://github.com/yq04/Claude-Local/blob/main/LICENSE)。第三方组件遵循各自许可，详见 [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md)。

Windows 10 / 11 x64 · [下载安装包 / Download installer](https://github.com/yq04/Claude-Local/releases/download/v0.3.0/Claude-Local_0.3.0_x64-setup.exe) · [Release](https://github.com/yq04/Claude-Local/releases/tag/v0.3.0) · [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.3.0/SHA256SUMS.txt)

## 简体中文

0.3.0 聚焦 **Claude Code CLI v2.1.309~2.1.318 净室切号防关联隔离、CLI 遥测护盾与 MCP 供应链安全审计、智能接力 2.0（融合 `magpie` / `orca` / `claude-swap` 路由精髓）、实时额度小窗 2.0 及跨页面持久化审计与续杯锚点核验**。

- **Claude Code v2.1.309~2.1.318 净室切号与跨号防染色加固**：
  - 原生切号管线（`cleaner_identity.rs` / `cleaner_config.rs`）对齐最新 `claude.exe v2.1.318` 二进制协议，新增清理 `.claude/telemetry/1p_failed_events.*.json` 一方遥测死信箱、`groveConfigCache`、异号 `.claude.json.backup.*` / `.corrupted.*` 副本、共享会话 JSONL 中的 `credential_org` / `userEmail` / `thinking.signature` / `api-request-blob` / `bridge-session` 染色字段，并支持跨号中断 `tool_use` 与孤儿 `tool_result` 成对自愈修复。
  - 写回前按锁类型精确回收残留僵尸锁（`.claude.json.lock` / `.claude/.lock` 60s 阈值，`.claude/.storage-write.lock` 15s 阈值）；凭据白名单补齐 `cloudSessionsOauth`、`trustedDeviceEnrolledAfterRefusalAtMs`、`designOauth`、`enterpriseGateway`、`trustedDeviceToken`、`organizationUuid`（7 项），账号瞬态缓存清理扩展至 25 项（完整吸收 `cc-switch` 账号缓存集合并严格保留设备/客户端配置与 `metricsStatusCacheByPrincipal`）。
- **CLI 遥测护盾、全栈防漏域名锁与 MCP 供应链安全审计**：
  - 桌面 Mihomo 一键防漏覆写 YAML、AI 配置提示词与原生风险检查同步锁定 `claude.com`（CLI v2.1.310+ 新 OAuth 授权域）、`growthbook.io`（Feature Flag 评估域）、`claudemcpcontent.com`、`datadoghq.com` 等核心域名，并兼容 `rules` / `prepend-rules` / `append-rules` 规则写法。
  - 「风控验证」与「身份页文件残留」新增 Claude CLI 遥测护盾（`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`、`DISABLE_TELEMETRY`、`DISABLE_ERROR_REPORTING`、`CLAUDE_CODE_DisableFileessler`）与 MCP 供应链安全审计（全局及 `projects[*].mcpServers` 下的非回环远程 `http/sse` 服务、Windows 裸 `npx/npm/pnpm/yarn/uvx/bunx` 启动器、自定义 `hooks` / `apiKeyHelper` / `awsAuthRefresh` / `otelHeadersHelper` 及 `skipDangerousModePermissionPrompt` / `Bash(*)` 越权配置只读识别）。
- **智能接力 2.0（Smart Relay 2.0）与 `magpie` / `claude-swap` 算法融合**：
  - 吸收 `magpie` 的 `WeekLow` 临期周配额抢救规则：当账号 5h 窗口充裕且距 7d 重置时间比例低于阈值（有效消耗偏低）时，即使 7d 已用较高仍保持 `Tier 0` 优先消耗，避免周额度白白过期。
  - 吸收 `claude-swap` 的 7d 重置后前 24 小时步速静默窗口，消除周重置初期短时突增导致的「超前消耗」误报；新增动态防乒乓换号裕度（`computeDynamicSwitchMarginPct` / `meetsDynamicSwitchMargin`）、5h 饥饿态大差值紧急切换放行、单向防回弹锁（`noReturnAccountId`）与独立下一顺位待命候选（`standbyCandidate`）展示。
- **实时额度悬浮小窗 2.0（Quota HUD 2.0）**：
  - 新增 `computeMonitorBarFillPct` 双口径极值防虚标渲染（已用与剩余模式下 `99.4%` / `99.6%` 绝不渲染成 100% 满格，剩余 `> 0%` 始终保留至少 `4%` 视觉余量），内置紧凑下一顺位接力待命胶囊（`.monitor-relay-standby-pill`），并支持 `Escape` 快捷隐藏小窗与 `Ctrl/Cmd + =/-/0`（含小键盘）无障碍缩放。
- **跨页面三段式净室审计时间线与 5h 续杯锚点推进核验**：
  - 身份页活动条新增三段式净室切换管线胶囊摘要（环境预检 → 凭据与遥测净室 → 会话与权限还原）与跨页面持久化的最近 5 次操作内存审计时间线；自动续杯与一键唤醒新增 `verifyWakeupAnchorAdvancement` 5h 重置锚点真实推进核验（严格拒绝回退或异常远期时间戳，明确区分「已推进新周期」与「沿用当前周期」）。

`BAGAID01` / `.baga`、SQLite `user_version = 3`、已有主密钥、账号 HMAC 与浏览器种子 100% 向下兼容；升级保留已有身份库与浏览器资料，不主动终止运行中的 `claude.exe`。0.3.0 使用新标签与新资产，既有 0.2.7 标签和安装包保持不变。

## English

Claude-Local is derived from [CCBaga](https://github.com/liseami/CCBaga) by [@liseami](https://github.com/liseami) and contributors, and maintained independently. Original copyright and the [MIT license](https://github.com/yq04/Claude-Local/blob/main/LICENSE) are retained; third-party terms are documented in [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md).

0.3.0 delivers **Claude Code CLI v2.1.309~2.1.318 cleanroom telemetry & credential isolation, CLI telemetry shield & MCP supply-chain security auditing, Smart Relay 2.0 (integrating `magpie`, `orca`, and `claude-swap` algorithms), Quota HUD 2.0, and persistent cleanroom audit timelines with 5h wakeup anchor verification**.

- **Claude Code v2.1.309~2.1.318 Cleanroom Identity Switching & Anti-Contamination**:
  - Aligns native identity switching (`cleaner_identity.rs` / `cleaner_config.rs`) with `claude.exe v2.1.318` binary forensics: purges `.claude/telemetry/1p_failed_events.*.json` first-party telemetry dead-letter queues, `groveConfigCache`, cross-account `.claude.json.backup.*` / `.corrupted.*` snapshots, and shared session JSONL contamination (`credential_org`, `userEmail`, `thinking.signature`, `api-request-blob`, `bridge-session`), while automatically healing interrupted `tool_use` / orphan `tool_result` pairs.
  - Enforces per-lock stale thresholds before writeback (`60s` for `.claude.json.lock` / `.claude/.lock`, `15s` for `.claude/.storage-write.lock`), expands `CREDENTIAL_KEYS` to 7 keys (`cloudSessionsOauth`, `trustedDeviceEnrolledAfterRefusalAtMs`, `designOauth`, `enterpriseGateway`, `trustedDeviceToken`, `organizationUuid`), and expands transient `ACCOUNT_KEYS` to 25 keys while preserving device/client state and `metricsStatusCacheByPrincipal`.
- **CLI Telemetry Shield, Full-Stack Anti-Leak Domain Lock & MCP Supply-Chain Audit**:
  - Extends desktop Mihomo anti-leak override YAML, AI prompts, and native risk checks to cover `claude.com` (CLI v2.1.310+ OAuth authorize endpoint), `growthbook.io` (Feature Flag endpoint), `claudemcpcontent.com`, and `datadoghq.com`, supporting `rules`, `prepend-rules`, and `append-rules`.
  - Adds read-only CLI Telemetry Shield (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `CLAUDE_CODE_DisableFileessler`) and MCP supply-chain security auditing across global and `projects[*].mcpServers` (detecting non-loopback remote `http/sse` servers, bare Windows `npx/npm/pnpm/yarn/uvx/bunx` launchers, custom `hooks`/`apiKeyHelper`/`awsAuthRefresh`/`otelHeadersHelper`, and `skipDangerousModePermissionPrompt`/`Bash(*)` bypasses).
- **Smart Relay 2.0 with `magpie` & `claude-swap` Routing Enhancements**:
  - Adopts `magpie`'s `WeekLow` perishable weekly quota promotion rule (keeping accounts with ample 5h headroom and low effective burn in `Tier 0` before weekly reset) and `claude-swap`'s 24-hour post-reset weekly pace silence window.
  - Adds dynamic anti-ping-pong switch margins (`computeDynamicSwitchMarginPct` / `meetsDynamicSwitchMargin`) with emergency 5h starvation override, one-way anti-bounce locks (`noReturnAccountId`), and an independent `standbyCandidate` banner.
- **Floating Monitor Quota HUD 2.0**:
  - Introduces `computeMonitorBarFillPct` so neither `'used'` nor `'remaining'` display mode rounds `99.4%`/`99.6%` to a full 100% bar or `< 1%` remaining to an empty bar (`4%`–`96%` visual clamping), renders a compact next-relay standby pill (`.monitor-relay-standby-pill`), and adds `Escape` to hide the HUD plus `Ctrl/Cmd + =/-/0` (including Numpad) UI zoom.
- **Persistent 3-Stage Cleanroom Audit Timeline & 5h Wakeup Anchor Verification**:
  - Adds a 3-stage cleanroom pipeline summary badge (`Pre-check` → `Credential & Telemetry Cleanroom` → `Session & ACL Restore`) and a cross-page persistent 5-item in-memory audit timeline, plus `verifyWakeupAnchorAdvancement` to verify genuine 5h reset anchor advancement while rejecting backward or far-future timestamps.

`BAGAID01` / `.baga`, SQLite `user_version = 3`, existing master keys, account HMACs and browser seeds remain 100% compatible. Upgrades preserve vaults and browser profiles without terminating running `claude.exe` sessions. Version 0.3.0 uses a new tag and assets; existing 0.2.7 artifacts remain unchanged.

## 安装包校验 / Installer verification

请将以下结果与本版 Release 的 `SHA256SUMS.txt` 比对。 / Compare the result with `SHA256SUMS.txt` from this release.

```powershell
Get-FileHash .\Claude-Local_0.3.0_x64-setup.exe -Algorithm SHA256
```

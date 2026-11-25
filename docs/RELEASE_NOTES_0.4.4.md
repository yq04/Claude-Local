<!-- [INPUT]: Verified v0.4.4 per-request Request Logs workspace (`usage_request_logs_read` / `RequestLogsPanel`) and Companion Browser anti-leak & 30s datacenter Kill-Switch hardening atop v0.4.3. -->
<!-- [OUTPUT]: Bilingual public GitHub Release notes for Claude-Local v0.4.4 (no automatic updater; non-disruptive Windows x64 upgrade). -->
<!-- [POS]: Tracked documentation artifact paired with git tag v0.4.4 and SHA256SUMS.txt. -->

# Claude-Local v0.4.4

> **独立 Windows x64 发行说明 / Standalone Windows x64 Release Notes**
> 发布日期 Date: `2026-11-25` · 应用标识 Bundle ID: `ai.local.claude-local` · 主程序 Executable: `claude-local.exe` · 伴侣浏览器 Companion Browser: `Claude-Local-Browser`

---

## 中文说明

### 核心更新摘要

`v0.4.4` 围绕**逐次请求可观测性**与**伴生浏览器全链路防泄露 / 断路器加固**推出两项核心升级：

1. **全新独立「请求日志」观测工作台（[`src-tauri/src/identities/usage_logs.rs`](../src-tauri/src/identities/usage_logs.rs) / [`src/request-logs.tsx`](../src/request-logs.tsx)）**
   - **逐次请求明细与筛选统计**：新增第 10 个独立页面「请求日志」（`usage_request_logs_read` + `RequestLogsPanel`），展示毫秒级时间戳、端到端耗时（含均值与 P95）、有效输出速率（TPS）、精确 API 等效 USD 花费与缓存节省、筛选聚合 KPI 条及动态筛选列表。
   - **请求详情检查与安全导出**：支持点击单条请求弹窗查看详细构成，支持一键按会话隔离或跳转至对应身份卡片，支持 TSV / JSON 导出与 30 秒可见页顺序刷新；全链路严格脱敏，绝不暴露原始提示词、本地路径、请求 ID 或账号凭据。

2. **伴生浏览器防 DNS / DoH 泄露与 30 秒机房 IP 急停加固（[`src-tauri/src/browser/`](../src-tauri/src/browser/CLAUDE.md) / [`src/browser.tsx`](../src/browser.tsx)）**
   - **全量显式代理锁定远程 DNS**：[`config.rs`](../src-tauri/src/browser/config.rs) 不再仅限 SOCKS 与本机回环 HTTP 代理，所有有效显式代理（`socks5` / `socks5h` / `http` / `https`，含局域网与远端代理）启动时均统一注入 `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ...` 与 `--test-type`，彻底阻断浏览器本地 DNS 查询。
   - **受限宿主机默认关闭「跟随本机」**：[`workspaces.rs`](../src-tauri/src/browser/workspaces.rs) 在受限地区宿主机首次建槽或自愈未运行的非 `legacy` 槽位时（即使无其他 `donor` 槽位），自动关闭 `follow_machine` 并归一为 `en-US` 与 `America/New_York`，避免中文/东八区指纹随美区出口外泄。
   - **禁用网络预测与 Chromium 内置 DoH**：[`profile.rs`](../src-tauri/src/browser/profile.rs) 在保留原有书签、登录态与 `os_crypt` 密钥的同时，写入 `net.network_prediction_options = 2` 与 `Local State` `dns_over_https.mode = "off"`，封堵预连接与内置 DoH 旁路。
   - **30 秒断路器高频巡检与运行中机房 IP 跳变熔断**：[`network.rs`](../src-tauri/src/browser/network.rs) 与 [`kill_switch.rs`](../src-tauri/src/browser/kill_switch.rs) 将显式代理 Cloudflare `/cdn-cgi/trace` 探测周期从 120 秒缩短至 **30 秒**（零第三方 GeoIP 配额消耗），并记录每槽位基线出口 IP；一旦检测到出口 IP 中途切换，自动校验新 IP 属性，若经 3 秒二次复核确认为机房/数据中心 IP，立即触发 `exit_datacenter` 优雅关闭全部受管伴生浏览器并展示双语横幅告警（绝不触碰运行中的 `claude.exe`）。

### 兼容性与无损升级说明

- **数据与界面契约 100% 向下兼容**：完整保留 `BAGAID01` 魔数、`.baga` 归档编码、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串、`166×286` `.identity-card`、20 项 `REQUIRED_CHECK_IDS`、`native_graphics: true` 默认值以及 `%APPDATA%\ai.local.claude-local` 目录结构。
- **平滑无中断升级**：支持从 `0.1.x`、`0.2.x`、`0.3.x` 与 `0.4.0`–`0.4.3` 直接升级至 `v0.4.4`，不破坏已有身份、密钥与浏览器登录状态，不强制中断在线 `claude.exe` 会话。
- **校验与核验**：安装前可用 PowerShell 校验并对比随附 `SHA256SUMS.txt`：
  ```powershell
  Get-FileHash .\Claude-Local_0.4.4_x64-setup.exe -Algorithm SHA256
  ```

---

## English Release Notes

### Highlights

**`v0.4.4`** introduces the standalone **Request Logs** observability workspace alongside four **Companion Browser anti-leak and Kill-Switch** hardenings:

1. **Standalone Request Logs Workspace ([`src-tauri/src/identities/usage_logs.rs`](../src-tauri/src/identities/usage_logs.rs) / [`src/request-logs.tsx`](../src/request-logs.tsx))**
   - **Per-Request Telemetry & Filtered KPIs**: Adds the 10th navigation page (`usage_request_logs_read` + `RequestLogsPanel`) displaying millisecond timestamps, end-to-end duration (avg & P95), weighted output TPS, exact API-equivalent USD cost & cache savings, search/filter/sort/pagination, and dynamic filter lists.
   - **Request Inspector & Safe Exports**: Provides click-to-inspect modal details with one-click session isolation and account card jump, TSV/JSON export, and sequential 30s visible-page refresh while strictly omitting raw prompts, local paths, request IDs, and credentials.

2. **Companion Browser Anti-Leak & 30s Datacenter Kill-Switch Hardening ([`src-tauri/src/browser/`](../src-tauri/src/browser/CLAUDE.md) / [`src/browser.tsx`](../src/browser.tsx))**
   - **Unified Remote DNS Lock Across All Explicit Proxies**: [`config.rs`](../src-tauri/src/browser/config.rs) now injects `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ...` and `--test-type` for every valid explicit proxy (`socks5`, `socks5h`, `http`, `https`, including LAN and remote endpoints).
   - **Restricted-Host `follow_machine = false` Default & Self-Heal**: [`workspaces.rs`](../src-tauri/src/browser/workspaces.rs) automatically initializes and heals stopped non-legacy slots on restricted hosts to `follow_machine = false` with `en-US` and `America/New_York` even before any donor slot exists.
   - **Disabled Network Prediction & Built-in DoH**: [`profile.rs`](../src-tauri/src/browser/profile.rs) sets `net.network_prediction_options = 2` in `Default/Preferences` and `dns_over_https.mode = "off"` in `Local State` while preserving `os_crypt` and all existing profile data.
   - **30s Explicit-Proxy Kill-Switch & Mid-Session Datacenter Failover Guard**: [`network.rs`](../src-tauri/src/browser/network.rs) and [`kill_switch.rs`](../src-tauri/src/browser/kill_switch.rs) tighten explicit-proxy Cloudflare `/cdn-cgi/trace` checks from 120s to **30s** (zero GeoIP quota burn) and track per-slot baseline exit IPs. If an exit IP changes mid-session and a 3s recheck confirms a datacenter/hosting address, Kill-Switch triggers `exit_datacenter`, closes all managed companion browsers gracefully with a bilingual banner, and leaves running `claude.exe` sessions untouched.

### Compatibility & Non-Disruptive Upgrade

- **Full Backward Compatibility**: `BAGAID01` vault headers, `.baga` archives, SQLite `user_version = 3`, account HMAC rules, legacy browser seed strings, `166×286` identity cards, 20 `REQUIRED_CHECK_IDS`, `native_graphics: true`, and `%APPDATA%\ai.local.claude-local` paths remain unchanged.
- **Seamless In-Place Upgrade**: Upgrades directly from `0.1.x`–`0.4.3` to `v0.4.4` without re-creating identities or interrupting active `claude.exe` sessions.
- **Checksums**: Compare `Claude-Local_0.4.4_x64-setup.exe` against the published `SHA256SUMS.txt` asset via:
  ```powershell
  Get-FileHash .\Claude-Local_0.4.4_x64-setup.exe -Algorithm SHA256
  ```

---

## Attribution & License

- Maintained in this repository as an independent Windows x64 project under the [MIT License](../LICENSE) with preserved third-party copyright notices in [NOTICE](../NOTICE.md).
<!-- [INPUT]: Verified v0.4.3 resilient 5-provider browser/native exit verification, production CSP alignment, same-origin classifier deduplication, Kill-Switch lightweight Cloudflare trace guard, and Clash/Mihomo exit-provider routing alignment atop v0.4.2. -->
<!-- [OUTPUT]: Bilingual public GitHub Release notes for Claude-Local v0.4.3 (no automatic updater; non-disruptive Windows x64 upgrade). -->
<!-- [POS]: Tracked documentation artifact paired with git tag v0.4.3 and SHA256SUMS.txt. -->

# Claude-Local v0.4.3

> **独立 Windows x64 发行说明 / Standalone Windows x64 Release Notes**
> 发布日期 Date: `2026-11-23` · 应用标识 Bundle ID: `ai.local.claude-local` · 主程序 Executable: `claude-local.exe` · 伴侣浏览器 Companion Browser: `Claude-Local-Browser`

---

## 中文说明

### 核心更新摘要

`v0.4.3` 彻底根治伴生浏览器环境核验与原生出口检测在第三方免费 GeoIP 限流（`ipwho.is: HTTP 429`）及 Cloudflare 质询无 CORS 响应（`ipapi.co: Failed to fetch`）下的检测失败问题，并切断后台断路器对第三方 GeoIP 配额的持续消耗：

1. **五源高可用出口检测链与单请求地理 + 分类融合（[`src-tauri/src/browser/network.rs`](../src-tauri/src/browser/network.rs) / [`src/browser-network.ts`](../src/browser-network.ts)）**
   - **升级五源顺序备援目录**：由原双源 `ipwho.is` / `ipapi.co` 升级为 `https://api.ipquery.io/?format=json` → `https://ipinfo.io/json` → `https://api.ip.sb/geoip` → `https://get.geojs.io/v1/ip/geo.json` → `https://ipwho.is/`，移除持续返回 Cloudflare 403 且无 CORS 头的 `ipapi.co/json/`。
   - **单请求完成地理 + 机房分类**：主源 `api.ipquery.io/?format=json` 在单次 HTTPS 响应中同时返回出口 IP、国家、城市、IANA 时区、ASN/运营商及 `risk.is_datacenter` 布尔分类（请求数减半）；多源解析器同步支持 `location.country_code` / 2 字母 `country`、`isp` 对象与字符串、`organization_name`、`ASxxxx Org` 前缀拆分以及 `ipinfo.io` 错误对象拒绝，同时保持硬性机房 ASN 黑名单优先覆盖与诚实来源归因（内置拦截覆盖时不误标 `ipquery`）。
   - **同源分类故障去重与中文错误归一化**：当 `api.ipquery.io` 主请求已返回限流/超时/网络故障并切换至备用地理源时，不再对同一失败源发起重复分类请求，直接保留受控 `hosting_error`（住宅宽带 ASN 仍可即时判绿）；前端将 `TypeError` / `TimeoutError` / HTML 质询页统一归一为双语受控消息并限制长度，杜绝超长错误触发 `/report` 400 误报断连。

2. **核验页生产 CSP 精确同步与零漂移断言（[`src-tauri/src/browser/server.rs`](../src-tauri/src/browser/server.rs) / [`scripts/test-browser-verification.ts`](../scripts/test-browser-verification.ts)）**
   - 精确更新 `browser.html` 生产 `Content-Security-Policy` `connect-src` 为 `'self' https://api.ipquery.io https://ipinfo.io https://api.ip.sb https://get.geojs.io https://ipwho.is`（仍无通配符、无 `unsafe-eval`）。
   - 新增 Rust 单元断言逐项校验 `network::SERVICES` 与 `CLASSIFICATION_SERVICE` 全部源均在生产 CSP 白名单内，并扩展 Playwright 伴生核验回归覆盖生产 CSP 下的 `api.ipquery.io` 直出与 `429 -> ipinfo.io` 备援路径（`12` 项）。

3. **伴生浏览器断路器（Kill-Switch）零配额消耗优化与 TUN 分流补齐（[`src-tauri/src/browser/kill_switch.rs`](../src-tauri/src/browser/kill_switch.rs) / [`src/risk-model.ts`](../src/risk-model.ts) / [`src/vps.tsx`](../src/vps.tsx)）**
   - 新增 `network::probe_country` 供 `kill_switch.rs` 定时出口国家护栏调用：当槽位配置了显式代理（如 `socks5://127.0.0.1:7899`）时，优先经同一冻结代理走 Cloudflare 轻量 `/cdn-cgi/trace`（`1.1.1.1` / `www.cloudflare.com`，零第三方 GeoIP 配额消耗），仅在 trace 失败或 TUN 空代理模式下回退五源 GeoIP（且不触发额外分类请求）。
   - 在桌面端 Mihomo 防漏覆写 YAML（`buildDesktopMihomoAntiLeakYaml`）与双语 AI 配置提示词中同步纳入 `ipinfo.io`、`ip.sb`、`geojs.io`、`ipwho.is`，保障纯 TUN 模式下全部出口核验服务均与 `claude.ai` 同路走静态家宽出口；同步更新 [`NOTICE.md`](../NOTICE.md) 外部数据服务声明。

### 兼容性与无损升级说明

- **数据与界面契约 100% 向下兼容**：完整保留 `BAGAID01` 魔数、`.baga` 归档编码、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串、`166×286` `.identity-card`、20 项 `REQUIRED_CHECK_IDS`、`native_graphics: true` 默认值以及 `%APPDATA%\ai.local.claude-local` 目录结构。
- **平滑无中断升级**：支持从 `0.1.x`、`0.2.x`、`0.3.x` 与 `0.4.0`–`0.4.2` 直接升级至 `v0.4.3`，不破坏已有身份、密钥与浏览器登录状态，不强制中断在线 `claude.exe` 会话。
- **校验与核验**：安装前可用 PowerShell 校验并对比随附 `SHA256SUMS.txt`：
  ```powershell
  Get-FileHash .\Claude-Local_0.4.3_x64-setup.exe -Algorithm SHA256
  ```

---

## English Release Notes

### Highlights

**`v0.4.3`** resolves companion browser and native exit-IP verification failures caused by `ipwho.is` free-tier rate limits (`HTTP 429`) and `ipapi.co` Cloudflare challenge responses without CORS headers (`Failed to fetch`), while stopping the background Kill-Switch from burning third-party GeoIP quotas:

1. **5-Provider Resilient Exit Directory & Single-Shot Geo + Classification ([`src-tauri/src/browser/network.rs`](../src-tauri/src/browser/network.rs) / [`src/browser-network.ts`](../src/browser-network.ts))**
   - **Upgraded Fallback Chain**: Replaces the fragile 2-provider `ipwho.is` / `ipapi.co` list with `https://api.ipquery.io/?format=json` → `https://ipinfo.io/json` → `https://api.ip.sb/geoip` → `https://get.geojs.io/v1/ip/geo.json` → `https://ipwho.is/`, dropping Cloudflare-challenged `ipapi.co/json/`.
   - **Single-Request Geo + Hosting Classification**: Primary `api.ipquery.io/?format=json` returns exit IP, country, city, IANA timezone, ASN/ISP, and `risk.is_datacenter` in one CORS-enabled HTTPS response (cutting verification requests in half). Both Rust and TypeScript parsers support all 5 provider schemas (`location.country_code` / 2-letter `country`, object/string `isp`, `organization_name`, leading `ASxxxx Org` extraction, error-object rejection) while keeping hard datacenter ASN overrides first and attributing `hosting_source: "ipquery"` only when IPQuery's verdict is preserved.
   - **Same-Origin Classifier Deduplication & Normalized Errors**: When primary `api.ipquery.io` fails (`429` / timeout / network error) and falls back to another provider, supplementary classification reuses the bounded `hosting_error` without hammering the failed host again (while built-in residential ASN recognition still passes). Browser `TypeError` / `TimeoutError` / HTML challenge responses normalize cleanly into bounded bilingual diagnostics so `POST /report` never trips its error-length bound.

2. **Exact Production CSP Alignment & Drift Guard ([`src-tauri/src/browser/server.rs`](../src-tauri/src/browser/server.rs) / [`scripts/test-browser-verification.ts`](../scripts/test-browser-verification.ts))**
   - Updates `browser.html` production `Content-Security-Policy` `connect-src` to `'self' https://api.ipquery.io https://ipinfo.io https://api.ip.sb https://get.geojs.io https://ipwho.is` (no wildcards, no `unsafe-eval`).
   - Adds a Rust unit invariant asserting every origin in `network::SERVICES` and `CLASSIFICATION_SERVICE` is explicitly permitted by the emitted CSP header, and extends Playwright companion verification to cover direct `api.ipquery.io` and `429 -> ipinfo.io` fallback under the production CSP (`12` checks).

3. **Zero-Quota-Burn Kill-Switch Country Guard & TUN Routing Parity ([`src-tauri/src/browser/kill_switch.rs`](../src-tauri/src/browser/kill_switch.rs) / [`src/risk-model.ts`](../src/risk-model.ts) / [`src/vps.tsx`](../src/vps.tsx))**
   - Adds `network::probe_country` for periodic Kill-Switch exit-country checks: when an explicit proxy (e.g., `socks5://127.0.0.1:7899`) is configured, it queries lightweight Cloudflare `/cdn-cgi/trace` (`1.1.1.1` / `www.cloudflare.com`) over that exact frozen proxy with zero third-party GeoIP quota consumption, falling back to the 5-provider GeoIP chain (without supplementary classification) on trace failure or empty-proxy TUN mode.
   - Adds `ipinfo.io`, `ip.sb`, `geojs.io`, and `ipwho.is` alongside `ipquery.io` in desktop Mihomo anti-leak YAML and bilingual setup prompts so TUN-only setups route all exit checks through the residential exit, and updates [`NOTICE.md`](../NOTICE.md).

### Compatibility & Non-Disruptive Upgrade

- **Full Backward Compatibility**: `BAGAID01` vault headers, `.baga` archives, SQLite `user_version = 3`, account HMAC rules, legacy browser seed strings, `166×286` identity cards, 20 `REQUIRED_CHECK_IDS`, `native_graphics: true`, and `%APPDATA%\ai.local.claude-local` paths remain unchanged.
- **Seamless In-Place Upgrade**: Upgrades directly from `0.1.x`–`0.4.2` to `v0.4.3` without re-creating identities or interrupting active `claude.exe` sessions.
- **Checksums**: Compare `Claude-Local_0.4.3_x64-setup.exe` against the published `SHA256SUMS.txt` asset via:
  ```powershell
  Get-FileHash .\Claude-Local_0.4.3_x64-setup.exe -Algorithm SHA256
  ```

---

## Attribution & License

- Maintained in this repository as an independent Windows x64 project under the [MIT License](../LICENSE) with preserved third-party copyright notices in [NOTICE](../NOTICE.md).

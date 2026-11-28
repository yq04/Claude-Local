<!-- [INPUT]: Verified v0.4.6 sub-second claude.ai launch pipeline, redesigned 2-button QuotaDetailsModal & 10-page UI unification, and 6-domain multi-account / companion browser security hardening atop v0.4.5. -->
<!-- [OUTPUT]: Bilingual public GitHub Release notes for Claude-Local v0.4.6 (no automatic updater; non-disruptive Windows x64 upgrade). -->
<!-- [POS]: Tracked documentation artifact paired with git tag v0.4.6 and SHA256SUMS.txt. -->

# Claude-Local v0.4.6

> **独立 Windows x64 发行说明 / Standalone Windows x64 Release Notes**
> 发布日期 Date: `2026-11-28` · 应用标识 Bundle ID: `ai.local.claude-local` · 主程序 Executable: `claude-local.exe` · 伴侣浏览器 Companion Browser: `Claude-Local-Browser`

---

## 中文说明

### 核心更新摘要

`v0.4.6` 聚焦 **身份卡片进入 `claude.ai` 亚秒级启动提速**、**身份详情弹窗重设计与全站 10 页排版美化** 以及 **多账号与伴生浏览器 6 大域深度安全加固** 三大方向完成升级：

1. **卡片进入 `claude.ai` 全链路阻塞消除与亚秒级启动（[`src-tauri/src/cleaner.rs`](../src-tauri/src/cleaner.rs) / [`src-tauri/src/windows.rs`](../src-tauri/src/windows.rs) / [`src-tauri/src/browser/`](../src-tauri/src/browser/mod.rs)）**
   - **细粒度锁与 I/O 去重**：将全局 `Cleaner` 互斥拆分为按账号槽位分片并发（严格加锁偏序 `Cleaner < SlotGate < Browser::gate`），彻底消除后台在线配额刷新对打开浏览器的 `30–45s` 阻塞；引入 `CliProofCache`（基于 `FileStamp` 元数据缓存并保留启动前终态无缓存 TOCTOU 复核）、`ntdll!RtlGetVersion` 原生系统版本探测（取代 `powershell.exe` 冷启动）以及 `Preferences` / `Local State` 脏写比对跳过无变更 `fsync`。
   - **出口预检与 Chromium 148 启动防卡死**：`EXIT_TRACE_URLS` 将 `1.1.1.1` 置于域名端点之前并复用连接池与异步运行时（保留受限宿主机 fail-closed 拦截）；注入 Chromium 148 `--set-ipv6-probe-false`、TUN 模式 `--no-proxy-server`（消除 Windows WinHTTP/WPAD 自动代理探测超时）及 `--disable-features=UseDnsHttpsSvcb,AsyncDns,HappyEyeballsV3,DomainReliability`，日常浏览会话不再挂载未打包 MV3 扩展。

2. **身份详情弹窗重设计与全站 10 页视觉统一（[`src/identities/QuotaDetailsModal.tsx`](../src/identities/QuotaDetailsModal.tsx) / [`src/identity-productivity.css`](../src/identity-productivity.css) / [`src/main.tsx`](../src/main.tsx) / [`src/style.css`](../src/style.css)）**
   - **详情弹窗精简重构**：将 `QuotaDetailsModal` 重构为清晰的 5 层信息布局，底部操作区精简至日常最高频的 **「进入 Claude.ai」** 与 **「同步额度与重置」** 两个按钮，移除冗余低频底部按钮并同步对齐 `2,547` 键双语词条（`zh.yaml` / `en.yaml` 1:1 且英文零 CJK）。
   - **全站工作台美化**：修正 `src/main.tsx` 样式导入顺序，统一快速配置、浏览环境、电脑环境、网络环境、风控验证、身份管理、用量分析、请求日志、使用说明、软件设置与备份面板的边距节奏、分组标头与 Cromma 标准控件，严格保留 `166×286` `.identity-card` 基准尺寸。

3. **多账号隔离与伴生浏览器 6 大域深度安全加固（[`src-tauri/src/browser/`](../src-tauri/src/browser/mod.rs) / [`src/browser-context-probe.ts`](../src/browser-context-probe.ts) / [`browser-runtime/quota-bridge/`](../browser-runtime/quota-bridge/manifest.json) / [`src-tauri/src/identities/orchestrator/slots.rs`](../src-tauri/src/identities/orchestrator/slots.rs)）**
   - **默认启用全栈指纹隔离与 6 上下文防篡改核验**：将新建槽位默认 `native_graphics` 调整为 `false`（启用引擎层 `--fingerprint=<seed>` 确定性噪声、虚拟屏幕尺寸与硬件并发派生，既有已保存 `config.json` 保持原值不变）；新增 `browser-context-probe.ts` 并发核验 Window、`DedicatedWorker`、`SharedWorker`、`ServiceWorker`、同源与沙盒 `iframe` 6 类上下文 × 9 维一致性与 `Function.prototype.toString` 完整性。
   - **独占 32-hex 槽位、代理归一与 Kill-Switch 进程树强熔断**：禁止新/具名身份绑定或回退共享 `"legacy"` 目录，补齐 Chromium 148 `SITE_DATA` 清单与防 NTFS Junction/Symlink 逃逸的 `prepare_slot_singleton_for_launch`；统一清洗代理协议大小写、`socks5h->socks5` 与尾斜杠；新增 5 重校验 `terminate_browser_profile_tree` 进程树强杀兜底（防止页面 `beforeunload` 阻断熔断）、per-slot `0s` 立即基线采样、首次机房出口校验与全入口告警态路由验活。
   - **按需无 Hash MV3 桥接与 CLI 槽位深度净化**：MV3 扩展仅在显式额度同步会话按需加载，消除 `#claude-local-sync=` URL hash 暴露，强制 `frameId === 0` 单次认领与有界退避重试，回环服务锁定 `127.0.0.1:{port}` 并加入 `250ms` 首包防阻塞与重复头拒绝；`cli-slots` 禁用 `hooks` Junction 改为安全复制，递归大小写无关剥离高危 `helper`/`statusLine` 键及父环境 `ANTHROPIC_*`/`AWS_*`/`OTEL_*` 敏感变量，强锁回环 `NO_PROXY`。

### 兼容性与无损升级说明

- **持久化数据 100% 向下兼容**：完整保留 `BAGAID01` 魔数、`.baga` 加密归档、SQLite `user_version = 3`、账号 HMAC 规则、既有 `CCBaga` 浏览器种子派生域、`166×286` `.identity-card`、20 项 `REQUIRED_CHECK_IDS` 以及 `%APPDATA%\ai.local.claude-local` 目录结构。
- **平滑无中断升级**：支持从 `0.1.x`–`0.4.5` 直接升级至 `v0.4.6`，不破坏已有身份、密钥与已保存浏览器配置，不强制中断在线 `claude.exe` 会话。
- **校验与核验**：安装前可用 PowerShell 校验并对比随附 `SHA256SUMS.txt`：
  ```powershell
  Get-FileHash .\Claude-Local_0.4.6_x64-setup.exe -Algorithm SHA256
  ```

---

## English Release Notes

### Highlights

**`v0.4.6`** delivers **sub-second card-to-`claude.ai` launch performance**, a **redesigned 2-button `QuotaDetailsModal` & 10-page UI unification**, and **6-domain multi-account / Companion Browser security hardening**:

1. **Sub-Second Card-to-`claude.ai` Launch Pipeline ([`src-tauri/src/cleaner.rs`](../src-tauri/src/cleaner.rs) / [`src-tauri/src/windows.rs`](../src-tauri/src/windows.rs) / [`src-tauri/src/browser/`](../src-tauri/src/browser/mod.rs))**
   - **Sharded Concurrency & Deduplicated I/O**: Replaces the monolithic `Cleaner` boolean gate with per-account sharded locking under strict `Cleaner < SlotGate < Browser::gate` lock ordering, adds `CliProofCache` with final uncached TOCTOU revalidation, replaces cold `powershell.exe` probing with native `ntdll!RtlGetVersion`, and skips redundant `Preferences` / `Local State` `fsync` writes when security keys are clean.
   - **Fast Exit Preflight & Chromium 148 Anti-Hang Flags**: Prioritizes `1.1.1.1` in `EXIT_TRACE_URLS` over pooled async clients (preserving restricted-host fail-closed enforcement), injects `--set-ipv6-probe-false`, TUN `--no-proxy-server` (preventing Windows WinHTTP/WPAD hangs), and `--disable-features=UseDnsHttpsSvcb,AsyncDns,HappyEyeballsV3,DomainReliability`, and skips unpacked MV3 extension loading during ordinary browsing sessions.

2. **Redesigned `QuotaDetailsModal` & 10-Page Workbench Unification ([`src/identities/QuotaDetailsModal.tsx`](../src/identities/QuotaDetailsModal.tsx) / [`src/identity-productivity.css`](../src/identity-productivity.css) / [`src/main.tsx`](../src/main.tsx) / [`src/style.css`](../src/style.css))**
   - **Streamlined Identity Details Dialog**: Rebuilds `QuotaDetailsModal` into a clean 5-tier visual hierarchy and trims the footer action bar down to the two core daily actions (**Enter Claude.ai** and **Sync Quota & Resets**), maintaining strict `2,547`-key `1:1` bilingual parity (`0` CJK in `en.yaml`).
   - **Global Workbench Polish**: Fixes CSS import ordering in `src/main.tsx` and unifies spacing, section headers, and Cromma form controls across all 10 sidebar pages and `backup-panel` while preserving the `166×286` `.identity-card` contract.

3. **6-Domain Multi-Account & Companion Browser Security Hardening ([`src-tauri/src/browser/`](../src-tauri/src/browser/mod.rs) / [`src/browser-context-probe.ts`](../src/browser-context-probe.ts) / [`browser-runtime/quota-bridge/`](../browser-runtime/quota-bridge/manifest.json) / [`src-tauri/src/identities/orchestrator/slots.rs`](../src-tauri/src/identities/orchestrator/slots.rs))**
   - **Default Fingerprint Spoofing & 6-Context Anti-Tamper Probes**: Sets `Config::default().native_graphics = false` for newly initialized profiles (enabling deterministic `--fingerprint=<seed>` canvas/WebGL/audio/font noise and virtual screen/core presets while preserving existing saved `config.json` files) and adds `browser-context-probe.ts` to verify 9 consistency and `Function.prototype.toString` integrity checks across Window, `DedicatedWorker`, `SharedWorker`, `ServiceWorker`, same-origin, and sandboxed `iframe` contexts.
   - **Exclusive 32-Hex Slots, Proxy Normalization & Kill-Switch Process-Tree Enforcement**: Prohibits new/named identities from binding or falling back to `"legacy"`, expands Chromium 148 `SITE_DATA` cleanup, guards `SingletonLock` against NTFS junction/symlink escape, normalizes proxy schemes/slashes (`socks5h->socks5`), and upgrades Kill-Switch with 5-check `terminate_browser_profile_tree` fallback, `0s` per-slot baseline checks, initial datacenter exit blocking, and route re-verification across all 5 launch entrypoints.
   - **On-Demand Hash-Free MV3 Bridge & Scrubbed CLI Slots**: Loads the MV3 quota bridge strictly on explicit sync sessions, removes `#claude-local-sync=` URL hash exposure in favor of single-use `frameId === 0` session claims with bounded retry, locks loopback listeners to `127.0.0.1:{port}` with `250ms` first-byte DoS protection and duplicate-header rejection, replaces `cli-slots` `hooks` junctions with bounded file copies, and recursively strips dangerous `helper`/`statusLine` keys and inherited `ANTHROPIC_*`/`AWS_*`/`OTEL_*` variables while pinning loopback-only `NO_PROXY`.

### Compatibility & Non-Disruptive Upgrade

- **Full Backward Compatibility**: `BAGAID01` vault headers, `.baga` archives, SQLite `user_version = 3`, account HMAC rules, legacy `CCBaga` browser seed derivation strings, `166×286` identity cards, 20 `REQUIRED_CHECK_IDS`, and `%APPDATA%\ai.local.claude-local` paths remain unchanged.
- **Seamless In-Place Upgrade**: Upgrades directly from `0.1.x`–`0.4.5` to `v0.4.6` without re-creating identities or interrupting active `claude.exe` sessions.
- **Checksums**: Compare `Claude-Local_0.4.6_x64-setup.exe` against the published `SHA256SUMS.txt` asset via:
  ```powershell
  Get-FileHash .\Claude-Local_0.4.6_x64-setup.exe -Algorithm SHA256
  ```

---

## Attribution & License

- Maintained in this repository as an independent Windows x64 project under the [MIT License](../LICENSE) with preserved third-party copyright notices in [NOTICE](../NOTICE.md).

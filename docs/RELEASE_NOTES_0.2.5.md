<!--
[INPUT]: Independent Windows x64 Claude-Local 0.2.5 release: end-to-end Browser/System/Network/Risk & KYC anti-ban hardening (Accept-Language subtag sanitization, DNS prefetch lockdown, IPv6 dual-stack bypass prevention, full Anthropic/Persona/Stripe/Sentry/WorkOS domain coverage), persistent slot+config browser verification state across window close & navigation, real Canvas 2D FNV-1a pixel hash & WebAudio graph verification, Quota HUD real 5h four-counter cache hit rate & compact pill layout, and Usage Analytics dashboard visual overhaul.
[OUTPUT]: Bilingual public release notes for v0.2.5 without private runtime data or unverified artifact values.
[POS]: Public release notes linked from README.md, README_EN.md and GitHub Releases.
[PROTOCOL]: Retain CCBaga/MIT attribution and data-format compatibility; record artifact checksums only from the audited build.
-->

# Claude-Local 0.2.5 发布说明 / Release Notes

**Claude-Local 基于 [CCBaga](https://github.com/liseami/CCBaga)（[@liseami](https://github.com/liseami) 及贡献者）二次开发并独立维护，保留原贡献者版权与 [MIT 许可](https://github.com/yq04/Claude-Local/blob/main/LICENSE)。** 第三方组件仍遵循各自许可，详见 [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md)。

Windows 10 / 11 x64 · [下载安装包 (Download Installer)](https://github.com/yq04/Claude-Local/releases/download/v0.2.5/Claude-Local_0.2.5_x64-setup.exe) · [Release 页面 (Release Page)](https://github.com/yq04/Claude-Local/releases/tag/v0.2.5)

安装包 / Installer: `Claude-Local_0.2.5_x64-setup.exe` · `140,847,905` bytes (`134.32` MiB)

SHA-256: `16c9320d05a2100047c602331e22f9318dbba93a712100185b9bab4aca344e95`

```powershell
Get-FileHash .\Claude-Local_0.2.5_x64-setup.exe -Algorithm SHA256
# Expected SHA-256: 16c9320d05a2100047c602331e22f9318dbba93a712100185b9bab4aca344e95
```

---

## 简体中文

`Claude-Local 0.2.5` 聚焦 **全链路抗风控与防关联环境加固（浏览环境 · 电脑环境 · 网络环境 · 跨域 KYC 核验）**、**伴生浏览器 20 项真机探针升级与跨页/关窗结果保留机制**、**桌面端与移动端双栈 IPv6 防旁路及全域名同源分流**，以及 **桌面额度小窗（HUD）真实 5h 缓存命中率校准与用量分析仪表盘重构**。

### 1. 伴生浏览器防关联内核加固与 20 项实测结果保留机制

针对 Anthropic (`claude.ai`)、Cloudflare Turnstile、Persona KYC 与 Stripe Radar 的四层交叉硬件与网络核验，进一步打磨内置 **Fingerprint Chromium** 伴生浏览器工作流：

- **关窗与跨菜单切换自动保留实测结果（Slot + Config 绑定记忆）**：
  - 修复此前关闭伴生浏览器、点击「正常退出浏览器」或切换左侧导航菜单后再切回「浏览环境」时，已通过的 10 项核验绿勾（`✓ 检测通过`）与机器出口结果被重置回 `— 待测` 的问题；
  - 核验结果现按当前 **`(身份槽位, 指纹配置)`** 智能保留，关闭浏览器后状态胶囊自动切换为 `浏览器已关闭 · 保留 HH:MM:SS 实测结果`；同时启动浏览器不再清空已测得的「上次检测的机器出口」IP，仅在修改保存指纹配置、深度重置资料、执行系统对齐或触发防泄露断路器（Kill-Switch）时自动失效。
- **Canvas 2D FNV-1a 真实像素指纹哈希与 WebAudio 节点图实测**：
  - 伴生浏览器实测页（`browser.html`）的 `Canvas / 音频接口能力` 探针现对渐变与字体渲染后的 4,096 字节画布像素缓冲区实测计算 **32-bit FNV-1a 确定性像素指纹哈希（`Canvas #xxxxxxxx`）**，并在 `OfflineAudioContext` 中构建 `OscillatorNode → GainNode → destination` 音频链路进行校验。
- **`--accept-lang` 语言子标签防泄露与 DNS 预解析封锁**：
  - 修复带地区子标签语言（如 `en-US`）未拼接基础语言回退或单语言标签（如 `ja`、`fr`）重复拼接的问题，自动规范生成 `--accept-lang=en-US,en` 与 `intl.accept_languages`，彻底杜绝 HTTP 请求头出现次选中文残留（`zh-CN`）；
  - 在每个受管浏览器资料的 `Default/Preferences` 中显式写入 `dns_prefetching.enabled = false`，配合 Google 官方 `WebRTC Network Limiter` 三重非代理 UDP 强锁，防止 HTTP 代理模式下 Chromium 后台预取触发本地 DNS 解析。
- **核验文案与机房 ASN 词边界精准识别**：
  - 修正主界面 `真实设备与 CPU` 将网页上报的操作系统内核版本误标为“浏览器版本”的问题（现清晰展示 `本机：Windows 10.0.22631.0 · 24 核；网页上报：10.0.22631.0 · 24 核`）；
  - 消除 `WebRTC 本地候选观察` 前后缀重复拼接，并在 20 项探针全部通过后明确显示 `探针：时区偏移 / Canvas / 音频 / UA-CH 已核验正常`；
  - 机房 ASN / 运营商识别对短词（`aws`、`gcp`、`ovh`、`vps`、`idc`、`dmit` 等）启用 ASCII 词边界匹配，避免正常住宅 ISP 名称包含短字母组合时发生误判。

### 2. 跨域风控 / Persona KYC / 静态家宽防泄露规则全面升级

- **双栈网络 IPv6 防旁路（`ipv6: false` & `dns.ipv6: false`）**：
  - 在「风控验证」桌面端一键覆写 YAML（`.yaml`）、桌面 DNS 修复提示词、「网络环境」AI 链式家宽配置提示词以及四端手机扫码桥接配置（Shadowrocket / Clash Mi / Stash / sing-box）中，统一显式写入顶层 `ipv6: false` 与 `dns.ipv6: false`，彻底阻断校园网或双栈宽带下 IPv6 Happy Eyeballs 绕过纯 IPv4 静态家宽节点。
- **全量补齐 Claude / Persona / Stripe / Sentry / WorkOS 关联域名与备用 DoH**：
  - 统一将 `claude.ai`、`claude.com`（含 `platform.claude.com`）、`anthropic.com`、`claudeusercontent.com`、`claudemcpcontent.com`、`withpersona.com`、`persona.org`、`persona.com`、`personacustomer.com`、`stripe.com`、`stripe.network`、`stripecdn.com`、`stripe.global`、`challenges.cloudflare.com`、`hcaptcha.com`、`funcaptcha.com`、`arkoselabs.com`、`workos.com`、`authkit.app`、`sentry.io`、`statsig.com`、`statsigapi.net`、`featuregates.org`、`prodregistryv2.org`、`intercom.io`、`intercomcdn.com`、`intercomassets.com` 以及出口核验域 `ipquery.io`、`ippure.com`、`ipinfo.io`、`ipwho.is`、`ipapi.co`、`ident.me` 全部纳入同一静态住宅出口分流，防止页面主请求与遥测/风控子请求出口 IP 分裂；
  - 静态规则核验引擎（`risk_check.rs`）新增对 Clash Verge Rev 全局扩展 `prepend-rules` 与 `append-rules` 字段的直接识别。
- **养号卡同国跨时区漂移精准提示**：
  - 当养号卡片锁定的常驻时区与当前实测出口时区同属一个国家但跨州/跨时区（如 `US (America/Los_Angeles)` 漂移至 `US (America/New_York)`）时，拦截弹窗现完整展示国家与 IANA 时区对比，消除旧版显示 `US vs US` 的歧义。

### 3. 桌面额度小窗（HUD）真实 5h 缓存命中率与紧凑排版优化

- **顶栏开关统一命名为「额度小窗」**：
  - 将「身份管理」顶栏右侧悬浮窗按钮在开启与关闭状态下统一固定为 **`额度小窗`**，由文字左侧状态圆点的亮绿/暗灰直观指示开关状态，消除按钮宽度跳变。
- **5h 窗口真实四类 Token 缓存命中率校准**：
  - 修复此前额度小窗仅用 `5h 缓存读取 / 5h 总消耗（含输出 Token）` 近似估算导致显示的缓存命中率（如 `92%`）显著低于「用量分析」页真实命中率（`98.4%`）的问题；
  - 后端 `UsageTracker` 现精确聚合当前 5h 窗口内的 **未缓存输入、输出、缓存写入、缓存读取** 四项独立计数，严格按统一公式 `cache_read / (uncached_input + cache_creation + cache_read)` 计算真实缓存命中率，与「用量分析」页 100% 口径一致。
- **紧凑身份头栏与 5h 耗尽时间预估（ETA）**：
  - 将账号名称、核验徽章与 `Pro`/`Max` 标签收拢为左侧紧凑胶囊，右侧并列展示在线活跃状态（`活跃对话中` / `空闲待命`）；
  - 5h 进度条新增时间进度刻度与基于近 10 分钟消耗速率的耗尽预估（`预计 Xh Ym 后耗尽` 或 `余量充裕`）。

### 4. 「用量分析」仪表盘视觉与排版全面重构

- **左大卡 + 右 2×2 核心指标卡黄金比例布局**：
  - 移除主摘要区底部冗余免责声明小字，左侧核心卡聚焦 **总 Token** 与 `2×2` 四色构成网格（未缓存输入 / 输出 / 缓存写入 / 缓存读取），右侧采用等高 `2×2` 网格呈现 **API 等效花费（`$`）**、**缓存节省（`$`）**、**缓存命中率（`%` + 缓存复用倍数）** 与 **日均/时均等效花费（`$`）**；
  - 优化「用量趋势」面積图与「模型分布」双轨进度条的留白、字重与对齐层级。

### 5. 资料兼容与交付核验

- **100% 向下兼容**：已有加密身份库（`BAGAID01` / `.baga`）、SQLite `user_version = 3`、主密钥、账号 HMAC、浏览器确定性种子、养号卡片与手动订阅元数据保持完全兼容；从旧版本升级无需重建身份，亦不中断正在运行的 `claude.exe` 会话。
- **解包与隐私审计**：本次安装包在独立中性目录构建，通过 109 个解包资源文件的白名单与哈希核对，隐私探针扫描 `0` 命中。

---

## English

**Claude-Local is derived from [CCBaga](https://github.com/liseami/CCBaga) by [@liseami](https://github.com/liseami) and contributors, and is maintained independently. The original contributors' copyright and [MIT license](https://github.com/yq04/Claude-Local/blob/main/LICENSE) are retained.** Third-party components remain subject to their own terms in [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md).

`Claude-Local 0.2.5` focuses on **End-to-End Anti-Ban & Environment Hardening (Browser · System · Network · Cross-Domain KYC)**, **Companion Browser 20-Probe Upgrade & Persistent Verification State Across Window Close / Tab Navigation**, **Dual-Stack IPv6 Bypass Prevention & Complete Telemetry/KYC Domain Routing**, and **Quota HUD Real 5h Cache Hit Rate Calibration & Usage Analytics Dashboard Redesign**.

### 1. Companion Browser Anti-Correlation Hardening & Persistent Verification Results

- **Retained Verification Results Across Browser Close & Menu Navigation**:
  - Previously, closing the companion browser or navigating away from **Browser Environment** and returning reset the 10 verified checkmarks (`✓ Checks passed`) back to `— Pending`.
  - Verification reports and machine exit results are now retained in memory bound to the active `(slot, config)` pair, displaying `Browser closed · Retained HH:MM:SS result` when the browser is closed and invalidating only when fingerprint settings change, the profile is deep-reset, system alignment runs, or the Kill-Switch triggers.
- **Deterministic Canvas 2D FNV-1a Pixel Hash & WebAudio Graph Verification**:
  - The `Canvas / Audio Capability` check on `browser.html` now computes a deterministic **32-bit FNV-1a hash (`Canvas #xxxxxxxx`)** across all 4,096 rendered pixel bytes and verifies `OfflineAudioContext` `OscillatorNode → GainNode → destination` graph construction.
- **`--accept-lang` Subtag Sanitization & DNS Prefetch Lockdown**:
  - Normalizes regional language tags (`en-US` → `--accept-lang=en-US,en`) without duplicating single-subtag languages (`ja`, `fr`) or leaking secondary host locale tags (`zh-CN`), and enforces `dns_prefetching.enabled = false` in `Default/Preferences`.
- **Refined Check Copy & Word-Boundary Datacenter ASN Detection**:
  - Clarifies host vs. browser-reported OS kernel version and CPU cores in `Actual device & CPUs`, deduplicates `WebRTC Local Candidates` status text, reports `Time zone offset / Canvas / audio / UA-CH verified OK` when all probes pass, and uses ASCII word-boundary matching for short hosting keywords (`aws`, `gcp`, `ovh`, `vps`, `idc`, `dmit`).

### 2. Cross-Domain Risk / Persona KYC & Dual-Stack IPv6 Anti-Bypass Hardening

- **IPv6 Dual-Stack Bypass Lockdown (`ipv6: false` & `dns.ipv6: false`)**:
  - Explicitly disables IPv6 in the one-click Desktop Clash/Mihomo Override YAML, desktop DNS remediation prompts, Network Page AI proxy prompts, and all 4 mobile bridge profiles (Shadowrocket / Clash Mi / Stash / sing-box) so dual-stack networks never bypass IPv4-only static residential nodes.
- **Complete Anthropic / Persona / Stripe / Sentry / WorkOS Domain Coverage**:
  - Routes `claude.ai`, `claude.com`, `anthropic.com`, `claudeusercontent.com`, `claudemcpcontent.com`, `withpersona.com`, `persona.org`, `persona.com`, `personacustomer.com`, `stripe.com`, `stripe.network`, `stripecdn.com`, `stripe.global`, `challenges.cloudflare.com`, `hcaptcha.com`, `funcaptcha.com`, `arkoselabs.com`, `workos.com`, `authkit.app`, `sentry.io`, `statsig.com`, `statsigapi.net`, `featuregates.org`, `prodregistryv2.org`, `intercom.io`, `intercomcdn.com`, `intercomassets.com`, and IP classifiers through the same static residential exit, and recognizes Clash Verge `prepend-rules` / `append-rules`.

### 3. Quota HUD Real 5h Cache Hit Rate & Usage Analytics Dashboard Redesign

- **Unified `Quota HUD` Header Toggle & Real 5h Cache Hit Rate**:
  - Keeps the top toolbar button label constant (`Quota HUD`) with a green/gray status dot, and computes the 5h window cache hit rate from exact 5h four-part token counters (`cache_read / (uncached_input + cache_creation + cache_read)`), matching Usage Analytics.
- **Compact HUD Header, 5h Exhaustion ETA & Streamlined Usage Analytics Grid**:
  - Combines the identity name, verified badge, and `Pro`/`Max` tag into a compact header with an active/idle status pill and 5h exhaustion ETA, and redesigns the **Usage Analytics** summary into a balanced hero card + `2×2` metric grid.

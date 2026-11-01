<!--
[INPUT]: Verified v0.2.5 end-to-end anti-ban & KYC/WebRTC/IPv6/DNS hardening, persistent (slot, config) 20-item browser verification & deterministic 32-bit FNV-1a Canvas pixel hash, redesigned Quota HUD (real 5h four-counter cache hit rate + exhaustion ETA) & Usage Analytics, v0.2.4 Smart Relay (default OFF), neutral Windows NSIS build audit, and GitHub Release v0.2.5.
[OUTPUT]: Context-free handoff for a brand-new session covering task overview, completed deliverables, current state/remaining boundaries, next steps and critical pitfalls to avoid.
[POS]: Root maintenance handoff; real identities, IP/proxy values, process IDs, workstation paths and screenshots stay out of tracked files.
[PROTOCOL]: Back up and verify SHA256 before rewriting. Documentation-only updates do not build/deploy, reload proxies, operate accounts, package/upload or move release tags.
-->
# Claude-Local 新会话交接文档（无上下文直接接手）

更新时间：2026-11-01 01:35 EDT（America/New_York）。当前最新正式发布至 GitHub Release（Latest）的版本为 **`v0.2.5`**（源码标签 `v0.2.5` 指向提交 `6d505a6`），本机安装目录 `%LOCALAPPDATA%\Programs\Claude-Local` 亦已热更新并同步运行最新构建的 **`v0.2.5`** 正式版（涵盖浏览/电脑/网络/风控验证全链路防关联与 IPv6/WebRTC/DNS/KYC 防泄露加固、伴生浏览器 20 项防封实测结果按 `(slot, config)` 跨关窗/切页持久保留与 Canvas FNV-1a 真实像素哈希、额度小窗真实 5h 缓存命中率与耗尽预计时间，以及用量分析与 README 旗舰重构）。

> **给新会话的第一句话（必读）**：
> 1. **`v0.2.5` 已全部开发完成、验证通过、更新至本机安装目录，并打包发布至 GitHub Release `v0.2.5`（Latest）**：在 `v0.2.4` 基础上新增了全链路 `ipv6: false` / `dns.ipv6: false` 防双栈旁路、补齐 Anthropic + Persona KYC + Stripe + Sentry + WorkOS 同源家宽分流规则、修复 `--accept-lang` 区域子标签与 `dns_prefetching` 泄露、实现伴生浏览器实测结果跨关窗与跨菜单持久保留（`last_observations`）、升级 `Canvas 2D` 为真实 32 位 FNV-1a 像素哈希探针、修正机房 ASN 词边界误判（`RCN` 等真家宽不再误触 `cn`）、重做「额度小窗」（真实 5h 四计数器缓存命中率 + 5h 耗尽预计时间）与「用量分析」2×2 卡片排版，并重构了中英文 `README.md` / `README_EN.md`（将四大防封与多身份物理隔离能力置于最核心位置）。
> 2. **关于「智能接力（Smart Relay）」的明确产品定调（已与用户对齐确认）**：
>    - 目前智能接力采用**「纯本地余量推荐 + 手动点击走原生安全切号流程（含跨账号四维消毒与 `claude.exe` 进程检查）」**，**没有**采用本地 HTTP 反向代理网关，也**没有**开启后台自动无确认切号。
>    - 用户已明确指示：**「目前先不做接力了！但也不用删除现有功能！」** —— 因此请保持现有智能接力代码与界面原样保留（默认关闭 `enabled: false`），**切勿自行删除该功能，也切勿自行继续开发后台自动切号逻辑**。
> 3. **请勿重复实现 `v0.2.5` 已交付功能，也不要回退或移动 `v0.2.5` 标签及已上传安装包资产。**

新会话接手时请依次阅读：本文（`HANDOFF.md`） → 根目录 `AGENTS.md`（切勿提交到 Git） → 根目录 `CLAUDE.md`；修改具体模块前先读对应子目录的 `CLAUDE.md` 与源文件头注释（`[INPUT]/[OUTPUT]/[POS]/[PROTOCOL]`）。本文受 Git 跟踪，**严禁写入任何真实账号、邮箱、身份指纹、真实 IP、代理凭据、个人绝对路径或真实截图**。

---

## 1. 我们在做什么任务

**Claude-Local** 是基于开源项目 [CCBaga](https://github.com/liseami/CCBaga) 二次开发并在本仓库独立维护的 **Windows 10 / 11 x64** 桌面工作台（技术栈：Tauri 2 + Rust 后端、React 19 + TypeScript 前端、Python 外部额度单写者与加密备份脚本）。目标是让普通用户也能一键配置、管理、安全使用多个 **Claude Code CLI** 与 **Claude Pro / Max / 待转正养号卡片** 账号，核心涵盖五大模块：
1. **多身份加密保险库与零强杀安全切号**（`BAGAID01` / `.baga` 归档、SQLite `user_version = 3`、`claude.exe` 进程锁检查、1572 行跨账号四维残留消毒与 `--resume` / `-c` 会话签名剥离、全链路 `.clbackup` 口令加密备份）。
2. **多账号智能接力与轮换（Smart Relay，默认关闭）**（借鉴 [yetone/magpie](https://github.com/yetone/magpie) 的余量与重置窗口评估模型，提供推荐顺位计算、首选号恢复滞回提醒与一键安全切换入口，零反向代理网关、零后台偷切）。
3. **被动额度同步、原生进程内 5h 自动续杯调度与多模态悬浮窗（HUD）**（Python 独占写 `quota_ledger.json`，零后台 OAuth 轮询、零 `.claude.json` 写入）。
4. **CPAMP / ccusage 风格本地 Token 与官方 API 美元等效花费（`$`）分析**（未缓存输入/输出/缓存写入/缓存读取四类构成、API 等效花费 `$`、缓存节省 `$` 与缓存复用倍数、模型与 Effort 分布、IANA/DST 时区与 TSV 导出）。
5. **身份绑定的防关联伴生浏览器（Fingerprint Chromium）与风控 / KYC 环境核验**（每身份/每养号卡独立槽位与确定性指纹种子、WebRTC Network Limiter 三重强锁、按需无阻断防泄露断路器 Kill-Switch、20 项浏览器实测、6 项网络/DNS/Mihomo 运行时风控核验、桌面端一键 Clash 防漏覆写 YAML、手机同住宅出口 LAN 扫码桥接）。

---

## 2. 已经完成了什么（v0.2.5 & v0.2.4 完整交付清单）

### 2.1 多账号智能接力与轮换（Smart Relay，`src/smart-relay-model.ts`、`src/identities.tsx`、`src/settings.tsx`）
- **借鉴 `yetone/magpie` 的顺位评估与首选号滞回恢复，坚守单机安全切号边界**：
  - **默认关闭（`enabled: false`）**：持久化于本地 `claude-local.smart-relay.v1`；支持在「身份管理」顶栏右侧胶囊 `[• 智能接力 | 策略]`、`[⋯]` 更多操作菜单，或「软件设置 → 通用」中按需开启。
  - **平铺全量账号池（无嵌套滚动条）**：在弹窗内直接完整平铺当前身份与全部已保存身份（移除了早期 `max-height: 210px` 嵌套滚动条），展示 `5h / 7d` 已用进度条、重置时间、`当前` / `首选` / `下一顺位` 状态徽章，支持勾选参与轮换池与一键「设为首选」（Preferred）。
  - **五大路由策略 + 限流处理 + 会话保持 + 换号阈值**：
    - 路由策略：`智能`（三级余量池 `>90% / 10% / 耗尽` + 优先消耗最快重置窗口）、`按顺序`、`轮流`、`用量少的优先`、`重置前用完`；
    - 被限流时：`保持原位` 或 `排到最后`；
    - 会话保持：`自动`、`整个会话`、`仅手动`；换号阈值：`90% / 95% / 98% / 100%`。
  - **首选号恢复滞回保护（Hysteresis）与手动一键安全接力**：开启「首选账号恢复后切回」后，当首选号 `5h` 已用低于阈值 `15%` 以上且 `7d < 85%` 时提示切回；弹窗底部与「身份管理」顶部横幅提供一键 **`切到 {目标账号}`** 按钮，点击后复用标准 `identities_switch` 确认弹窗与四维残留消毒事务（绝不后台无感偷换 Token，绝不把 `warming_cards` 养号卡混入接力池）。

### 2.2 伴生浏览器 WebRTC 全链路防泄露加固与桌面端 Clash 一键覆写配置（`.yaml`）
- **调研 X 防封实践（`@gengdaJ` / `@ryuu_restart`、`ippure.com` 与 `ryuu-restart/agent-route`）并双端落地**：
  1. **伴生浏览器底层 `Default/Preferences` 三重 WebRTC 强锁 + 启动参数加固**：
     - `src-tauri/src/browser/profile.rs`（`preferences()`）：在每个受管浏览器资料的 `Default/Preferences` 中自动写入 Google 官方 `WebRTC Network Limiter` 扩展同款完整三项策略：
       - `webrtc.ip_handling_policy = "disable_non_proxied_udp"`
       - `webrtc.multiple_routes_enabled = false`（禁止枚举物理网卡与运营商原生双栈 IPv6 `host` 候选）
       - `webrtc.nonproxied_udp_enabled = false`（彻底阻断未配置 UDP 代理时的直连 UDP 包）
     - `src-tauri/src/browser/config.rs`（`arguments()`）：新增 `--enforce-webrtc-ip-permission-check`，去除 `--host-resolver-rules` 中重复的 `EXCLUDE 127.0.0.1`，并追加 `--test-type` 彻底消除 Chromium 顶部的 `"You are using an unsupported command-line flag"` 提醒条。
  2. **「风控验证」内置桌面端 Clash Verge / Mihomo 一键覆写配置（`buildDesktopMihomoAntiLeakYaml`）**：
     - 在 `src/risk-model.ts` 与 `src/risk-verification.tsx` 底部操作栏新增 **「查看一键覆写配置 (.yaml)」** 与 **「复制覆写配置 (.yaml)」**，一键生成可直接粘贴至 Clash Verge Rev 全局扩展覆写（Merge）的完整 YAML：
       - 阻断 `UDP 443` QUIC 与 `UDP 3478/19302/5349` WebRTC STUN/TURN 端口及 `DOMAIN-KEYWORD,stun,REJECT`；
       - 封锁 `IP-CIDR,198.18.0.0/15,REJECT,no-resolve` Fake-IP 回流，强制 `1.1.1.1/32`、`1.0.0.1/32`、`8.8.8.8/32` DoH 走家宽节点；
       - 开启 `tun.strict-route: true`、`dns.respect-rules: true` 与 `:7899` 纯 TCP 独立监听（`udp: false`）；
       - 将 `claude.ai`、`anthropic.com`、`withpersona.com`、`stripe.com`、`ipquery.io`、`ippure.com` 统一锁死至同一静态家宽出口；同步升级「复制电脑配置提示词」（`buildDesktopDnsFixPrompt`）。
  3. **「网络环境 → 复制提示词」（`src/vps.tsx` `buildAiProxyPrompt`）全链路防漏与持久化配置加固**：
     - 将中英文 AI 配置提示词升级为 8 行高密度可执行指令（严格兼容 `scripts/test-network-diagnostics.ts` 的 `assertCompactPrompt` 契约与 `src/risk-model.test.ts` 单元测试）：
       - 明确 `iKuuu` 前置多节点自动测速/容灾组 → `Kookeey` 静态住宅 SOCKS5 出口（显式 `udp: false`）双跳 `dialer-proxy` 链路；
       - 明确 Clash Verge Rev 四层持久化要求：写入全局扩展覆写（`Merge.yaml`）或扩展脚本防订阅刷新冲掉，并**在 `config.yaml` 与 `Merge.yaml` 同步开启 `tun.strict-route`**；
       - 补齐全部 20 个 Claude / KYC / 支付 / 风控探针域名（含 `claudeusercontent.com`、`persona.org`、`personacustomer.com`、`stripe.network`、`siftscience.com`、`intercom.io`、`statsig.com`、`ippure.com`）与远程 DoH IP（`1.1.1.1/32`、`1.0.0.1/32`、`8.8.8.8/32`）同源家宽路由，拦截 `198.18.0.0/15` 防 Fake-IP 漏出，保持回环与私有内网直连；
       - 开启 `sniffer`（`parse-pure-ip`）、`dns.respect-rules`、`dns.direct-nameserver-follow-policy`、`proxy-server-nameserver` 与纯 IP 远程加密 DoH，阻断 UDP `443`（QUIC）及 UDP `3478/19302/5349` 与 `stun`（WebRTC STUN/TURN），配置 `127.0.0.1:7899` 纯 TCP 独立监听（`udp: false`）并完成三路 `cdn-cgi/trace` 实测校验。

### 2.3 用量分析（`用量分析`）官方 API 美元等效花费（`$`）与缓存节省升级
- **替换低价值计数卡片，突出等效美元价值与缓存效率**：
  - `src/usage-model.ts`、`src/usage-statistics.tsx`、`src/usage-statistics.css`：移除主摘要区右侧无实际指导意义的「会话数」、「去重响应数」与重复的「活跃天数」卡片，升级为四张核心价值卡片：
    1. **API 等效花费（`$X.XX`）**：按 Anthropic 官方公开 API 模型阶梯单价折算四类 Token 的等效美元价值；
    2. **缓存节省（`$X.XX`）**：量化 Prompt Caching 相比全量未缓存输入节省的美元金额与净省比例；
    3. **缓存命中率（`XX.X%` + `X.Xx` 缓存复用倍数）**：同时展示缓存命中率与读取/写入复用倍数；
    4. **日均 / 时均等效花费（`$X.XX`）**：配合趋势副卡、模型分布、Effort 档位与多账号对比表全面展示 `$` 花费与有效输出占比。

### 2.4 风控验证两步状态去误报与手机小火箭（Shadowrocket）双栏桥接优化
- **两步核验清晰无误报**：
  - `src/risk-verification.tsx`、`src/risk-verification.css`：当第 1 步「本机 3 项静态防漏配置」全部就绪（`3/3`）而第 2 步尚未点击实测时，顶部横幅以绿色显示「第一步已完成：本机 3 项静态防漏配置全部就绪 (3/3)」，消除旧版黄色「配置缺失」误报；
  - 移除页面右上角重复的「开始一致性实测」按钮以及无实际作用的「刷新本机配置」按钮，保留横幅右侧唯一主操作按钮。
- **手机端 Shadowrocket 扫码桥接双栏重排与一键粘贴拆解**：
  - 将「生成配置与二维码」与「手机扫码后 4 步核验」升级为左右均衡双栏卡片（`.risk-bridge-two-col`）；
  - 支持在「住宅代理服务器」输入框直接粘贴完整代理串（如 `socks5://user:pass@host:port` 或 `host:port:user:pass`），自动智能拆解填入地址、端口、账号与密码。

### 2.5 伴生浏览器实测页、养号返回 CLI 浏览器与操作日志关闭打磨
- **`browser.html` 实测页深色一体化身份与范围卡**：
  - `src/browser-start.tsx`、`src/style.css`：将原本游离在黑色工牌下方的「仅核验所选浏览器环境，不验证网页登录或 CLI 授权。」整合进 `.verification-identity` 深色卡片下层（`.verification-scope`），统一字体、圆角与视觉层级。
- **养号后一键丝滑回到 CLI 浏览器**：
  - `src/identities.tsx`、`src-tauri/src/browser/lifecycle.rs`、`src-tauri/src/browser/quota_connection.rs`：
    - 在当前身份卡与已保存 Pro/Max 卡片的 `[⋯]` 菜单及「额度与重置权益」弹窗中新增 **「进入 Claude.ai」**、**「打开官方用量页」** 与 **「返回 CLI 浏览器」**；
    - 当伴生浏览器正处于养号槽位时，身份栏顶部显式展示一键「返回 CLI 浏览器」按钮，且切换 CLI 身份时自动将伴生浏览器切回目标 CLI 身份槽位；
    - 修复了此前先开养号卡再点当前身份打开网页时报“未检测到受管浏览器运行”的问题（自动拉起目标绑定浏览器资料）。
- **操作日志彻底关闭与养号日志归位**：
  - `src/cleaner-activity.tsx`、`src/claude-cli-panel.tsx`、`src/warming-cards.tsx`：
    - 点击「关闭记录」后操作日志面板彻底隐藏（`return null`），不再残留「查看上次记录」小尾巴；
    - 点击「检查更新」在未执行安装时不再弹出冗余的「CLI 安装记录」面板；
    - 点击养号卡片的浏览器操作日志直接渲染在「养号」专区内部，不再错位出现在上方「身份」栏。

### 2.6 额度小窗（Quota HUD）、用量分析视觉打磨与浏览/网络/风控全链路加固（v0.2.5 核心交付）
- **额度小窗按钮文案统一、紧凑单行头部与真实 5h 指标（`src/identities.tsx`、`src/settings.tsx`、`src/floating-monitor.tsx`、`src/floating-monitor.css`、`src-tauri/src/monitor_window.rs`、`src-tauri/src/identities/usage.rs`）**：
  - 将「身份管理」与「软件设置」右上角的悬浮窗切换按钮文案统一为 **`额度小窗` / `Quota HUD`**，仅由左侧状态圆点亮暗表达开启/关闭状态；
  - 重构额度小窗展开态头部为高密度单行结构（`账号名 + 绿勾 + 套餐徽章 + 右侧当前模型胶囊`），彻底消除原版账号名与 `Pro` 标签之间的空白断层；
  - **真实 5h 四计数器缓存命中率**：在 `usage.rs::monitor_snapshot()` 中直接基于 SQLite 近 5h 窗口计算 `cache_read / (uncached_input + cache_creation + cache_read)`，取代旧版近似估算公式，与「用量分析」口径完全对齐；
  - **5h 耗尽预计时间（ETA）**：在 5h 卡片底部新增按当前消耗速率推算的 `预计 Xh Ym 耗尽` 指标，并修复贴边折叠胶囊（`52×138`）右侧边缘被 Win32 DWM 裁剪的问题。
- **用量分析（`src/usage-statistics.tsx`、`src/usage-statistics.css`）排版与视觉重构**：
  - 顶部筛选栏收口为紧凑单行，扫描跳过提示收纳入底部折叠区；
  - 主摘要区采用左右双栏黄金比例（左侧 `总 Token + 2×2 四类构成子卡`，右侧 `2×2 核心财务与效率指标卡`：API 等效花费 `$`、缓存节省 `$`、缓存命中率 `%`、日均/时均等效花费 `$`），精简冗余小字备注。
- **伴生浏览器 20 项防封实测深层加固与跨关窗/切页结果持久保留（`src/browser-start.tsx`、`src/browser.tsx`、`src-tauri/src/browser/mod.rs`、`server.rs`、`launch.rs`、`network.rs`、`config.rs`、`profile.rs`）**：
  - **Canvas 2D 真实 32 位 FNV-1a 像素哈希探针**：在 `browser-start.tsx` 中绘制多图元测试图案并读取 `getImageData()` RGBA 像素流计算确定性 FNV-1a 哈希（如 `Canvas #xxxxxxxx · OfflineAudioContext 44100Hz 正常`），验证 `--fingerprint=<seed>` 噪声注入正常工作；
  - **实测结果按 `(slot, config)` 跨关窗与跨菜单持久保留**：在 `Browser` 状态中新增 `last_observations: Mutex<HashMap<String, CachedObservation>>`，并在 `browser_launch` 时保留 `state.host`（机器出口检测结果）；用户完成浏览器实测与机器出口检测后，即使关闭伴生浏览器或切换到其他菜单再切回「浏览环境」，10 项绿勾与实测详情依然完整保留（状态药丸显示 `浏览器已关闭 · 保留 HH:MM:SS 实测结果`），仅在切换账号/资料、修改配置、清理重置浏览器或触发断路器时自动失效；
  - **修复 `--accept-lang` 区域子标签与 `dns_prefetching`**：将 `en-US` 规范化为 `--accept-lang=en-US,en`，禁用 `dns_prefetching.enabled = false`；
  - **修复机房 ASN 词边界匹配与探针状态显示**：对短词（`cn`/`aws`/`ovh`/`vps` 等）启用 ASCII 词边界匹配，避免美国真家宽 `RCN` (`AS6079`) 误触 `cn` 子串；消除「WebRTC 本地候选观察」重复文案，修正「真实设备与 CPU」及「防封特征与出口纯净度」通过态文案。
- **Mihomo / Clash 全套域名分流与 IPv6 防旁路（`src/risk-model.ts`、`src/vps.tsx`、`src-tauri/src/risk_check.rs`）**：
  - 在桌面端一键覆写 YAML、桌面修复提示词、网络环境 AI 提示词与四端手机桥接配置（Shadowrocket / Clash Mi / Stash / sing-box）中，全面强制 **`ipv6: false` 与 `dns.ipv6: false`**，切断双栈 IPv6 直连绕过；
  - 补齐 `claude.com`、`claudemcpcontent.com`、`persona.com`、`stripecdn.com`、`stripe.global`、`sentry.io`、`workos.com`、`authkit.app`、`funcaptcha.com` 等完整 KYC/支付/风控域名及备用 DoH IP `8.8.4.4/32`；`risk_check.rs` 静态审计支持 `prepend-rules` / `append-rules`；
  - 修复 `src/warming-cards.tsx` 同国不同时区漂移弹窗文案（明确显示 `US (America/Los_Angeles)` vs `US (America/New_York)`）。

### 2.7 验证、本机热更新与 `v0.2.5` 打包发布回执
- **自动化测试全部通过**：
  - `bun x tsc --noEmit && bun test`：**162 passed, 0 failed**
  - `cargo test -j 1 --manifest-path src-tauri/Cargo.toml browser::`：**44 passed, 0 failed**
- **中性目录 NSIS 安装包构建与 29 项隐私探针解包审计**：
  - 构建脚本：`scripts/build-windows-share.ps1`（中性根目录 `D:\ClaudeLocalBuild\20261101T051704Z-c2d03423ff1946e1beb70aa1dc2e9138`）
  - 产出目录：`.local/artifacts/20261101T051704Z-c2d03423ff1946e1beb70aa1dc2e9138/`
  - 安装包：`Claude-Local_0.2.5_x64-setup.exe`，大小 **`140,847,905` 字节（`134.32 MiB`）**，SHA-256 为 **`16c9320d05a2100047c602331e22f9318dbba93a712100185b9bab4aca344e95`**
  - 隐私审计：108 个解包文件全部匹配资源白名单，29 项外置隐私探针扫描 **`0` 命中**。
- **本机安装目录安全热更新**：
  - 已将 `v0.2.5` Release 宿主与前端资源部署至 `%LOCALAPPDATA%\Programs\Claude-Local`（当前本机已安装 `claude-local.exe` SHA-256 为 `0c7238b8bfe90658d6c1e3d65c205af6f18b0d3d640aa8da98459496f40f06fd`），并通过 `schtasks /Create ... /IT` 在交互式桌面会话启动 GUI；**本机 `claude.exe` 进程零中断**。
- **GitHub Release 正式发布与 README 旗舰重构**：
  - 标签 `v0.2.5`（指向 `6d505a6`）及公开资产 `Claude-Local_0.2.5_x64-setup.exe`、`SHA256SUMS.txt` 已正式发布至 https://github.com/yq04/Claude-Local/releases/tag/v0.2.5 （`isDraft: false`、`isPrerelease: false`、Latest），GitHub 服务端返回 `digest` 与本地 SHA-256 完全一致；
  - 重构了 `README.md`、`README_EN.md` 与 `docs/RELEASE_NOTES_0.2.5.md`，开篇新增「🔥 为什么选择 Claude-Local？（直击多账号风控四大痛点）」与「✨ 八大核心能力矩阵」，将防封隔离壁垒（独立指纹浏览器 + 20 项实测、WebRTC/IPv6/DNS/KYC 防漏与断路器、四维跨账号残留消毒、免费号科学养号与智能接力）置于最核心位置，而将额度小窗与用量分析定位为辅助效率能力。

---

## 3. 当前卡在哪（当前无阻塞，仅记录产品边界共识）

当前**没有任何代码、构建、测试或发布阻塞**。工作区干净（仅保留用户原有的未提交 `AGENTS.md`，按规则绝不触碰或提交）。新会话只需了解以下已与用户对齐的产品边界：

1. **为什么跨账号接力必须退出 `claude.exe` 后再 `claude -c` / `claude --resume`，而不能像 Magpie 那样靠本地网关热替换 Token**：
   - `claude.exe` 启动时会将当前账号的 OAuth Token、组织 UUID 及本次进程的遥测 `sessionId` 缓存在进程内存中；若不退出 `claude.exe` 而在半途通过本地代理偷换 Token，会导致同一个 CLI 进程 `sessionId` 与旧账号加密的 `thinking` 签名直接发送给新账号，极易触发 Anthropic 服务端同人多号关联风控或 `400 Invalid signature in thinking block`。
   - 因此，最安全的工作流是：**退出当前 CLI（`/exit` 或在切号弹窗中确认由软件安全关闭） → 点击 `Claude-Local` 切号（`cleaner_identity.rs` 自动剥离 `.jsonl` 会话中旧账号的 `userEmail`、`credential_org` 与 `thinking` 签名） → 在终端执行 `claude -c` 继续对话**。
2. **「智能接力（Smart Relay）」保持当前默认关闭状态（不删不改）**：
   - 用户已明确指示：**「目前先不做接力了！但也不用删除现有功能！」**。现有智能接力默认关闭（`enabled: false`），开启时作为余量/重置顺位计算器与手动一键切号入口保留即可。
3. **坚持「前置专线 + 静态住宅 SOCKS5 双跳链式代理 + 软件三级验真防线」，不追求 VPS 自建面板**：
   - 经对社区 VPS 自建教程（`3x-ui` / `VLESS+Reality` / `Sub-Store`）与 X 防封实测的交叉调研确认：自建 VPS 运维门槛极高、单 IP 易被墙/被邻居送中，且在注册/过 Persona KYC/绑 Stripe 卡阶段机房 IP（`hosting: true`）极易被拦截，而高阶 VPS 玩家最终解决 AI 解锁依然必须回归 `dialer-proxy` 链式落地架构。
   - 针对市面上静态住宅可能混有“单 ISP 广播伪家宽”或高风险脏 IP 的情况，本项目不依赖盲信代理商宣传，而是由软件内置的 **三级验真防线** 兜底：① `classifyExitIsp` + `api.ipquery.io`（`is_datacenter`）零盲信红灯拦截机房/伪家宽；② 伴生浏览器起始页内置 `Ping0.cc` / `CheckCC.org` / `BrowserScan` / `IPHey` 及同源路由的 `ippure.com` 深度复核；③ 先验真确认双 ISP 原生低风险后再登号绑定。因此保持现有 `iKuuu + Kookeey + Clash Verge Rev 双跳防漏` 方案即可，无需引导用户折腾 VPS 自建机场。

---

## 4. 下一步计划是什么

目前 `v0.2.5` 所有计划内目标均已圆满收官。新会话启动后：

1. **先听取用户的新指令**：
   - 若用户提出新的使用问题、界面细节调整或新功能需求，先阅读相关模块的 `CLAUDE.md` 与源码头，按需制定方案。
   - **切勿**在用户未要求的情况下自行继续开发智能接力的后台自动切号，也**切勿**删除现有的智能接力功能。
2. **远期可选储备方向（仅在用户明确要求时再启动，切勿自行开工）**：
   - **多槽位浏览器完整并行 20 项回环实测会话**：将 `Browser.session` 升级为 `HashMap<String, SlotSession>`，支持多个槽位同时驻留各自的 `browser.html` 实测报告。
   - **单身份便携包（`.bagapack`）**：支持将单个身份及其元数据独立导出到另一台设备（目前整库加密备份 `.clbackup` 已完整覆盖全部身份、养号卡与手动订阅记录）。

---

## 5. 有哪些踩过的坑绝对不要再踩

### 5.1 进程、数据与工作区安全铁律（最高优先级）
1. **绝不中断或强杀正在运行的 `claude.exe`（Claude Code CLI）**：
   - 无论是开发调试、跑测试还是做本机热更新，都只允许操作 `claude-local.exe`（GUI 宿主），**严禁停止、重启或干扰任何 `claude.exe` 进程**。本机热更新前后必须记录并核对 `claude.exe` 的 PID 与 `StartTime` 完全不变。
2. **绝不提交或还原根目录 `AGENTS.md`，绝不将 `.local/` 或真实隐私数据带入 Git**：
   - `AGENTS.md` 含有工作区本地规则修改，必须始终留在未暂存状态（`git add` 时显式指定文件路径，切勿 `git add .` 或 `git add -A`）。
   - 严禁使用 `git clean`、`git reset --hard`、`git checkout --`、`git restore` 或递归删除工作区。
   - 提交或打包前必须确保零真实账号、零邮箱、零身份指纹、零代理凭据、零个人路径。
3. **持久格式兼容性绝对不可破坏**：
   - `BAGAID01` 魔数、`.baga` 归档格式、SQLite `user_version = 3`、账号 HMAC 计算规则以及历史 `CCBaga/browser/...` 确定性种子派生域字符串属于持久数据格式契约，严禁修改。
   - `quota_ledger.json` 必须保持 **Python 唯一写入者**（跨进程文件锁 + 原子替换 + 较新锚点优先），Rust 端只读合并，绝不向 `~/.claude.json` 写入额度字段。

### 5.2 历次实施与调试中踩过的技术坑（重要经验）
4. **伴生浏览器 WebRTC 防泄露坑：只设 `ip_handling_policy` 不够，必须三键齐下**：
   - 在 Chromium `Default/Preferences` 中，仅设置 `webrtc.ip_handling_policy = "disable_non_proxied_udp"` 在部分内核分支下仍可能枚举多网卡或原生 IPv6 路由；必须像 Google 官方 `WebRTC Network Limiter` 扩展一样同时写入 `webrtc.multiple_routes_enabled = false` 与 `webrtc.nonproxied_udp_enabled = false`，并在启动参数加上 `--enforce-webrtc-ip-permission-check`。
5. **Chromium 顶部不支持参数横幅坑**：
   - 当传入 `--host-resolver-rules` 时，Chromium 默认会在窗口顶部弹出黄色提示条 `"You are using an unsupported command-line flag: --host-resolver-rules..."`。必须在 `src-tauri/src/browser/config.rs` 的启动参数中同时传入 `--test-type` 才能抑制该横幅，且需注意不要重复拼接 `EXCLUDE 127.0.0.1`。
6. **养号浏览器与 CLI 浏览器切换坑**：
   - 当用户先打开了某张养号卡的浏览器，随后在「身份管理」点击当前 CLI 身份打开网页或用量页时，不能因为当前 `browser.active` 指向养号槽位或目标 CLI 资料尚未启动就报错拒绝；`quota_connection.rs::launch_bound_profile_url_locked` 已改为自动确保回环服务就绪并直接拉起目标 CLI 身份绑定的独立浏览器资料。
7. **备份白名单坑：修改 `.clbackup` 备份范围必须五处同步**：
   - `src-tauri/src/identities/backup.rs` 的 `verify_staged()` 采用严格文件名白名单校验。若未来新增备份文件，必须同步更新 `collect_files`、`rescue_files`、`verify_staged`、`verify_rescue_staged` 与 `identities_backup_restore_new` 五处。
8. **Clash Verge Rev 四层配置覆盖顺序与服务模式（`clash-verge-service`）路径确认坑**：
   - Clash Verge Rev 在执行完订阅、`Merge.yaml` 与 `Script.js` **之后**，还会把 `%APPDATA%\io.github.clash-verge-rev.clash-verge-rev\config.yaml` 中的 `tun` 字段覆盖上去；持久化修改 `strict-route: true` 必须同步修改 `config.yaml` 与 `profiles\Merge.yaml`。
   - 开启服务模式后，`verge-mihomo.exe` 的 `-f` 参数指向 `%PROGRAMDATA%\clash-verge-service\users\<64位hex>\runtime\config.yaml`，由 `src-tauri/src/risk_config_source.rs` 通过校验 `active-owner.json` / `.runtime-manifest.json` 归属当前用户 `%APPDATA%` 来确认 `running_core`。
9. **Windows 构建、测试与 CRLF 编辑坑**：
   - Windows 下没有预装 `rg`（ripgrep），搜索代码请使用 PowerShell `Select-String`。
   - 运行 `cargo test` 或 `cargo build` 前务必设置 `$env:CARGO_INCREMENTAL="0"; $env:CARGO_BUILD_JOBS="1"` 并加 `-j 1`，防止 MSVC `link.exe` / PDB 锁冲突。
   - 生产构建与本地部署必须带 `--features custom-protocol`；`scripts/build-windows-share.ps1` 需传入 `-SevenZipPath "C:\Program Files\AMD\CIM\Bin64\7z.exe"`（或本机已安装的 `7z.exe` 路径）。
   - **在沙箱化 PowerShell 工具调用中启动 `claude-local.exe` GUI 窗口时，切勿直接使用 `Start-Process` 或 `Win32_Process Create`**：因为工具子进程运行在非交互式后台 WindowStation（`Service-0x0-...`），直接拉起的 `claude-local.exe` 会变成不可见的后台僵尸进程并霸占 `tauri_plugin_single_instance` 单实例锁，导致用户双击桌面快捷方式无法打开窗口！必须使用 `schtasks /Create /TN "ClaudeLocalLaunchTemp" /TR "\"$dstExe\"" /SC ONCE /ST 00:00 /IT /F` + `schtasks /Run` 将进程挂载到用户交互式桌面会话（`WinSta0\Default`）。
   - 部分文件（如 `src/locales/zh.yaml`、`src/locales/en.yaml` 前半段及部分测试脚本）含 `CRLF` 行尾，若多行 `edit_file` 报未找到目标，优先使用单行锚点或 PowerShell `[System.IO.File]::ReadAllText/WriteAllText` 精确替换。
10. **伴生浏览器实测结果缓存（`last_observations`）与机器出口 `state.host` 失效边界坑**：
    - 关闭伴生浏览器或切换左侧菜单时，不能在 `snapshot()` 中简单用 `.filter(|_| running)` 丢弃 `session.report`，也不能在 `browser_launch` 时把 `state.host` 清空为 `None`（否则用户先点「检测机器出口」再点「打开浏览器实测」时机器出口结果会被冲掉）；
    - `Browser.last_observations` 必须严格绑定 `(slot, config)`（`Config` 需实现 `PartialEq, Eq`），并在 `browser_save`（修改浏览器配置）、`browser_clear(reset=true)`（深度重置）、`browser_align`（对齐美国环境）与 `kill_switch`（触发断路器）时主动清除对应缓存，防止配置变更后仍展示旧绿勾。
11. **机房 ASN / ISP 短词识别误判真家宽坑**：
    - 像 `cn`、`aws`、`gcp`、`ovh`、`vps`、`idc`、`dmit` 等短词绝对不能用普通 `contains()` 子串匹配，否则美国老牌真家宽 `RCN` (`AS6079`) 会因包含字母 `cn` 被误判为机房；必须使用 ASCII 词边界匹配 `contains_word_bounded()`。
12. **Mihomo / Clash Verge Rev Windows 命名管道热重载 `SAFE_PATHS` 坑**：
    - 通过命名管道 `\\.\pipe\verge-mihomo-production-*` 调用 `PUT /configs?force=true` 热重载 Mihomo 时，若启用了 `clash-verge-service` 服务模式，直接传入 `%APPDATA%` 下的路径会报 `400 path is not a subpath of SAFE_PATHS`；必须先将生成的配置同步到 `%PROGRAMDATA%\clash-verge-service\users\<64位hex>\runtime\clash-verge.yaml` 再向该安全路径发起 `PUT /configs?force=true`。

---

## 6. 关键源码与文档速查索引

- **多账号智能接力与身份工作台**：
  - `src/smart-relay-model.ts`、`src/smart-relay-model.test.ts`
  - `src/identities.tsx`、`src/identity-productivity.css`、`src/settings.tsx`
- **伴生浏览器 WebRTC 加固、实测结果持久保留、断路器与生命周期**：
  - `src-tauri/src/browser/mod.rs`（`last_observations` 跨关窗/切页持久保留）、`src-tauri/src/browser/server.rs`、`src-tauri/src/browser/launch.rs`、`src-tauri/src/browser/network.rs`
  - `src-tauri/src/browser/profile.rs`、`src-tauri/src/browser/config.rs`、`src-tauri/src/browser/kill_switch.rs`
  - `src-tauri/src/browser/lifecycle.rs`、`src-tauri/src/browser/quota_connection.rs`
  - `src/browser.tsx`、`src/browser-start.tsx`、`src/style.css`
- **风控核验、网络环境 AI 配置提示词、桌面端一键 Clash 覆写 YAML 与手机小火箭双栏桥接**：
  - `src/vps.tsx`（`buildAiProxyPrompt`）、`src/risk-model.ts`（`buildDesktopMihomoAntiLeakYaml`、`buildDesktopDnsFixPrompt`）、`src/risk-verification.tsx`、`src/risk-verification.css`
  - `src-tauri/src/risk_check.rs`、`src-tauri/src/risk_config_source.rs`
- **额度小窗（Quota HUD）与用量分析（官方 API 美元等效花费 `$` 与缓存节省）**：
  - `src/floating-monitor.tsx`、`src/floating-monitor.css`、`src-tauri/src/monitor_window.rs`、`src-tauri/src/identities/usage.rs`
  - `src/usage-model.ts`、`src/usage-model.test.ts`、`src/usage-statistics.tsx`、`src/usage-statistics.css`
- **操作日志彻底关闭与养号卡片**：
  - `src/cleaner-activity.tsx`、`src/claude-cli-panel.tsx`、`src/warming-cards.tsx`、`src-tauri/src/identities/warming.rs`
- **发布说明与主文档**：
  - `docs/RELEASE_NOTES_0.2.5.md`、`docs/RELEASE_NOTES_0.2.4_SMART_RELAY.md`、`README.md`、`README_EN.md`
- **本轮本地备份与打包审计产物（均在 `.local/` 忽略目录内，切勿提交）**：
  - `.local/artifacts/20261101T051704Z-c2d03423ff1946e1beb70aa1dc2e9138/`（`Claude-Local_0.2.5_x64-setup.exe`、`SHA256SUMS.txt`、`privacy-audit.json`、`resource-manifest.json`）
  - `.local/tasks/20261101-v0.2.5-release/`（`HANDOFF` 历史备份与 SHA-256 备份回执）

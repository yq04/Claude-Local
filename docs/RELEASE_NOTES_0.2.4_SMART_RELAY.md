<!--
[INPUT]: Independent Windows x64 Claude-Local 0.2.4 multi-account Smart Relay & rotation, WebRTC Network Limiter hardening, Clash/Mihomo anti-leak global override YAML, official API USD cost & cache savings analytics, companion browser verification header & CLI return workflow, activity log dismissal, and audited NSIS installer receipts.
[OUTPUT]: Bilingual public release notes for v0.2.4 without private runtime data or unverified artifact values.
[POS]: Public release notes linked from README.md, README_EN.md and GitHub Releases; the older RELEASE_NOTES_0.2.4.md remains a historical development record.
[PROTOCOL]: Retain CCBaga/MIT attribution and data-format compatibility; record artifact checksums only from the audited build.
-->

# Claude-Local 0.2.4 发布说明 / Release Notes

**Claude-Local 基于 [CCBaga](https://github.com/liseami/CCBaga)（[@liseami](https://github.com/liseami) 及贡献者）二次开发并独立维护，保留原贡献者版权与 [MIT 许可](https://github.com/yq04/Claude-Local/blob/main/LICENSE)。** 第三方组件仍遵循各自许可，详见 [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md)。

Windows 10 / 11 x64 · [下载安装包 (Download Installer)](https://github.com/yq04/Claude-Local/releases/download/v0.2.4/Claude-Local_0.2.4_x64-setup.exe) · [Release 页面 (Release Page)](https://github.com/yq04/Claude-Local/releases/tag/v0.2.4)

安装包 / Installer: `Claude-Local_0.2.4_x64-setup.exe` · `140,893,501` bytes (134.37 MiB)

SHA-256: `ceae7f931c15ae857c235f89b464e2c6c4cbcd912ae1a044c304dbb107cdecec`

```powershell
Get-FileHash .\Claude-Local_0.2.4_x64-setup.exe -Algorithm SHA256
# Expected SHA-256: ceae7f931c15ae857c235f89b464e2c6c4cbcd912ae1a044c304dbb107cdecec
```

---

## 简体中文

`Claude-Local 0.2.4` 聚焦**多账号智能接力与轮换（Smart Relay）**、**伴生浏览器 WebRTC 全链路防泄露与桌面端 Clash/Mihomo 一键覆写规则（`.yaml`）**、**用量分析官方 API 美元等效花费（`$`）与缓存节省回归**、**风控与小火箭（Shadowrocket）配置体验升级**，以及**伴生浏览器实测页、养号返回 CLI 浏览器与操作日志交互打磨**。

### 1. 多账号智能接力与轮换（Smart Relay，默认关闭）

借鉴开源项目 [magpie](https://github.com/yetone/magpie) 的多账号路由与平滑回切设计，结合 Claude-Local 的本地被动额度账本与加密身份切换机制，新增完整的**多账号智能接力工作台**：

- **默认关闭、双入口按需开启**：默认保持关闭（`enabled: false`），不改变原有手动管理习惯；支持在「身份管理」顶栏右侧胶囊 `[• 智能接力 | 策略]`、更多菜单 `[⋯]` 或「软件设置 → 通用」中随时开启与配置。
- **直观的全量账号池与首选号（Preferred）回切**：
  - 弹窗内平铺展示当前身份与全部已保存账号（无需嵌套滚动条），直观呈现各账号 `5h / 7d` 已用进度条、重置时间、`当前` / `首选` / `下一顺位` 状态徽章，支持一键勾选参与轮换与「设为首选」。
  - 开启「首选账号恢复后切回」后，借助滞回阈值保护（Hysteresis，`5h` 低于切换阈值 `15%` 以上且 `7d < 85%`），当主力首选账号冷却恢复后自动提示切回主力号，避免临界点反复横跳。
- **五大路由策略 + 限流处理 + 会话保持**：
  - **路由策略**：`智能（三级余量池 >90% / 10% / 耗尽 + 优先消耗最快重置窗口）`、`按顺序`、`轮流（Round-Robin）`、`用量少的优先`、`重置前用完`。
  - **被限流时**：支持 `保持原位`（5h 冷却恢复后原顺位继续使用）或 `排到最后`（自动沉底把顺位让给满血账号）。
  - **会话保持与换号阈值**：支持 `自动`、`整个会话`、`仅手动` 三种模式与 `90% / 95% / 98% / 100%` 触发阈值；弹窗底部与「身份管理」顶部横幅实时给出「建议接力 / 首选号已恢复 / 当前无需换号」卡片及一键 **`切到 {目标账号}`** 按钮，复用安全身份切换与跨账号残留消毒事务，**绝不强杀运行中的 `claude.exe`**。

### 2. WebRTC 全链路防泄露加固与桌面端一键覆写配置（`.yaml`）

结合社区防封实践与 [agent-route](https://github.com/ryuu-restart/agent-route) 路由加固方案，从**伴生浏览器内核层**与**桌面端 Clash Verge / Mihomo 路由层**双管齐下阻断 WebRTC STUN 与双栈 IPv6 真实 IP 泄露：

- **伴生浏览器 WebRTC Network Limiter 三重强锁**：
  - 在每个受管浏览器资料的 `Default/Preferences` 中自动写入 Google 官方 `WebRTC Network Limiter` 扩展同款的完整三项底层策略：
    - `webrtc.ip_handling_policy = "disable_non_proxied_udp"`
    - `webrtc.multiple_routes_enabled = false`（禁止枚举物理网卡与运营商原生 IPv6 路由）
    - `webrtc.nonproxied_udp_enabled = false`（彻底阻断未配置 UDP 代理时的直连 UDP 包）
  - 启动参数同步注入 `--enforce-webrtc-ip-permission-check`，并去重优化 `--host-resolver-rules` 与 `--test-type`，消除 Chromium 顶部命令行横幅提示。
- **「风控验证」内置桌面端一键全局覆写配置（`.yaml`）**：
  - 在「风控验证」页底部新增 **「查看一键覆写配置 (.yaml)」** 与 **「复制覆写配置 (.yaml)」**，一键生成可直接粘贴到 Clash Verge Rev 全局扩展覆写（Merge）的完整 YAML：
    1. **阻断 WebRTC STUN/TURN 与 QUIC**：强制 `AND,((NETWORK,UDP),(DST-PORT,443)),REJECT` 与 `DST-PORT,3478/19302/5349,REJECT` + `DOMAIN-KEYWORD,stun,REJECT`；
    2. **防 Fake-IP 与 DoH 抢答**：锁定 `IP-CIDR,198.18.0.0/15,REJECT,no-resolve` 与 `1.1.1.1/32`、`1.0.0.1/32`、`8.8.8.8/32` 走家宽节点，开启 `tun.strict-route: true` 与 `dns.respect-rules: true`；
    3. **独立 `:7899` 纯 TCP 监听与全域名同路分流**：自动生成 `claude-residential-7899` 独立监听（`udp: false`），并将 `claude.ai`、`anthropic.com`、`withpersona.com`、`stripe.com`、`ipquery.io` 与 `ippure.com` 统一锁定至同一静态家宽出口。

### 3. 用量分析：官方 API 美元等效花费（`$`）与缓存效率指标

- **高价值美元指标替换低信息量计数**：移除主摘要区无实际指导意义的「会话数」、「去重响应数」与重复的「活跃天数」卡片，升级为四张核心价值卡片：
  1. **API 等效花费（`$X.XX`）**：按 Anthropic 官方公开 API 模型阶梯单价折算未缓存输入、输出、缓存写入与缓存读取的等效美元价值；
  2. **缓存节省（`$X.XX`）**：直观量化 Prompt Caching 相比全量未缓存输入帮你省下的美元成本与净占比；
  3. **缓存命中率（`XX.X%` + `X.Xx` 缓存复用倍数）**：展示缓存读取占总输入的比例及缓存读取/写入复用效率；
  4. **日均 / 时均等效花费（`$X.XX`）**：辅助评估日常开发强度与订阅回本效率。
- **全模型、Effort 档位与多账号花费明细**：在模型分布、Effort 推理档位、趋势副卡、明细表与多账号对比表中全面展示 `$` 等效花费与有效输出占比。

### 4. 风控验证与手机小火箭（Shadowrocket）桥接优化

- **两步核验状态清晰无误报**：当第 1 步「本机 3 项静态防漏配置」全部就绪（`3/3`）而第 2 步尚未点击实测时，顶部横幅以清爽绿色显示「第一步已完成：本机 3 项静态防漏配置全部就绪 (3/3)」，消除旧版黄色「配置缺失」误报；移除页面右上角重复的「开始一致性实测」与无实际作用的「刷新本机配置」按钮。
- **手机端 Shadowrocket 扫码桥接双栏重排与一键粘贴拆解**：
  - 将「生成配置与二维码」与「手机扫码后 4 步核验」升级为左右均衡双栏卡片；
  - 支持在「住宅代理服务器」输入框直接粘贴完整代理串（如 `socks5://user:pass@host:port` 或 `host:port:user:pass`），自动智能拆解填入地址、端口、账号与密码。

### 5. 伴生浏览器实测页、养号返回 CLI 浏览器与日志关闭打磨

- **伴生浏览器实测页（`browser.html`）一体化深色信息卡**：将原本游离在工牌外侧的「仅核验所选浏览器环境，不验证网页登录或 CLI 授权。」整合进顶部深色身份工牌底部（`.verification-scope`），统一字体与视觉层级。
- **养号后一键丝滑回到 CLI 浏览器**：
  - 在「身份管理」当前身份卡与已保存 Pro/Max 卡片的 `[⋯]` 菜单及「额度与重置权益」弹窗中新增 **「进入 Claude.ai」**、**「打开官方用量页」** 与 **「返回 CLI 浏览器」** 快捷入口；
  - 当浏览器正处于养号槽位时，身份栏顶部显式提供一键「返回 CLI 浏览器」按钮，切换 CLI 身份时也会自动将伴生浏览器切回目标 CLI 身份槽位。
- **操作日志归位与彻底关闭**：
  - 点击「检查更新」在未执行安装时不再弹出冗余的「CLI 安装记录」面板；
  - 点击「关闭记录」后操作日志面板**彻底隐藏**（不再残留「查看上次记录」小尾巴）；
  - 点击养号卡片的浏览器操作日志直接展示在「养号」专区内部，不再错位出现在上方「身份」栏。

### 6. 资料兼容与交付核验

- **100% 向下兼容**：已有加密身份库（`BAGAID01` / `.baga`）、SQLite `user_version = 3`、主密钥、账号 HMAC、浏览器确定性种子、养号卡片与手动订阅元数据保持完全兼容；从 `0.1.x` 或 `0.2.x` 升级无需重建身份，亦不中断正在运行的 `claude.exe` 会话。
- **解包与隐私审计**：本次安装包在独立中性目录构建，通过 109 个解包资源文件的白名单与哈希核对，29 项外置隐私探针扫描 `0` 命中。

---

## English

**Claude-Local is derived from [CCBaga](https://github.com/liseami/CCBaga) by [@liseami](https://github.com/liseami) and contributors, and is maintained independently. The original contributors' copyright and [MIT license](https://github.com/yq04/Claude-Local/blob/main/LICENSE) are retained.** Third-party components remain subject to their own terms in [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md).

`Claude-Local 0.2.4` delivers **Magpie-inspired Multi-Account Smart Relay & Rotation**, **End-to-End WebRTC Anti-Leak Hardening & One-Click Desktop Clash/Mihomo Override YAML**, **Official API USD Cost (`$`) & Cache Savings Analytics**, **Streamlined Risk Verification & Shadowrocket Bridge UX**, and **Companion Browser Verification Header, CLI Browser Return & Activity Log Refinements**.

### 1. Multi-Account Smart Relay & Rotation (Opt-in, Default OFF)

Inspired by [magpie](https://github.com/yetone/magpie)'s multi-account routing and preferred-account recovery model:

- **Default OFF (`enabled: false`) with Dual Entry Points**: Accessible via the `[• Smart Relay | Strategy]` pill and `[⋯]` menu in **Identity Management**, or under **App Settings → General**.
- **Full Account Pool & Preferred Account Hysteresis Recovery**:
  - Displays all active and saved identities in a clean, non-scrolling list with `5h / 7d` used progress bars, reset countdowns, `Current` / `Preferred` / `Next Up` badges, participation checkboxes, and one-click **Set preferred**.
  - When **Switch back when preferred recovers** is enabled, hysteresis protection (`5h` at least `15%` below threshold and `7d < 85%`) recommends switching back to the primary account once its window recovers without ping-ponging.
- **5 Routing Strategies, Rate-Limit Handling & Session Affinity**:
  - **Routing**: `Smart (3-tier headroom pool + earliest reset first)`, `In Order`, `Round-Robin`, `Least Used First`, and `Use Before Reset`.
  - **On Rate Limit**: `Keep Position` or `Sink to End`.
  - **Session Stickiness & Switch Threshold**: `Auto`, `Full Session`, or `Manual Only` with `90% / 95% / 98% / 100%` thresholds and a one-click **`Switch to {account}`** action in both the dialog and top banner (**never force-killing running `claude.exe` sessions**).

### 2. End-to-End WebRTC Anti-Leak Hardening & One-Click Desktop Clash Override YAML

- **Chromium `Default/Preferences` WebRTC Network Limiter Lockdown**:
  - Persists all three official Google `WebRTC Network Limiter` keys across every managed browser profile (`webrtc.ip_handling_policy = "disable_non_proxied_udp"`, `webrtc.multiple_routes_enabled = false`, `webrtc.nonproxied_udp_enabled = false`) plus `--enforce-webrtc-ip-permission-check`, and adds `--test-type` with deduplicated `--host-resolver-rules` to eliminate Chromium's unsupported-flag banner.
- **One-Click Desktop Clash Verge / Mihomo Anti-Leak Override (`.yaml`)**:
  - Adds **View Override Config (.yaml)** and **Copy Override Config (.yaml)** in **Risk & KYC Verification**, generating a ready-to-paste Clash Verge Global Merge YAML that blocks `UDP 443` QUIC and `UDP 3478/19302/5349` WebRTC STUN/TURN, rejects `198.18.0.0/15` Fake-IP leaks, routes `1.1.1.1/1.0.0.1/8.8.8.8` DoH through the residential proxy, creates the `:7899` TCP-only listener (`udp: false`), and binds `claude.ai`, `withpersona.com`, `stripe.com`, `ipquery.io`, and `ippure.com` to the same static residential exit.

### 3. Usage Analytics: Official API USD Cost (`$`) & Cache Efficiency

- Replaces low-signal session/response/active-day summary cards with **API Equivalent Cost (`$`)**, **Cache Savings (`$`)**, **Cache Hit Rate (`%` + Cache Reuse Multiplier)**, and **Daily / Hourly Avg Cost (`$`)**, plus per-model, per-Effort, and per-account USD cost columns.

### 4. Streamlined Risk Verification & Shadowrocket Bridge UX

- Shows a clear green **Step 1 Complete (3/3)** banner when static checks pass before live probing, removes duplicate/no-op header buttons, arranges the Shadowrocket QR generator and 4-step guide into a balanced 2-column grid, and auto-splits pasted proxy strings (`socks5://user:pass@host:port` or `host:port:user:pass`).

### 5. Companion Browser Verification Card, CLI Browser Return & Log Dismissal

- Integrates the verification scope note into a unified dark two-tier identity card on `browser.html`, adds **Open Claude.ai**, **Open official usage page**, and **Return to CLI browser** shortcuts to identity cards and menus, routes warming browser logs directly inside the **Warming** section, and ensures **Dismiss** completely hides finished operation logs.

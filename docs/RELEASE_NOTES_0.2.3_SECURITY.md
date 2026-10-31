<!--
[INPUT]: Independent Windows x64 Claude-Local 0.2.3 security, anti-leak kill-switch, strict-route remediation, warming lifecycle protection, full-chain backup, multi-account UI polish and audited installer receipts.
[OUTPUT]: Bilingual public release notes for v0.2.3 without private runtime data or unverified artifact values.
[POS]: Public release notes linked from README.md, README_EN.md and GitHub Releases; the older RELEASE_NOTES_0.2.3.md remains a historical development record.
[PROTOCOL]: Retain CCBaga/MIT attribution and data-format compatibility; record artifact checksums only from the audited build.
-->

# Claude-Local 0.2.3 发布说明 / Release Notes

**Claude-Local 基于 [CCBaga](https://github.com/liseami/CCBaga)（[@liseami](https://github.com/liseami) 及贡献者）二次开发并独立维护，保留原贡献者版权与 [MIT 许可](https://github.com/yq04/Claude-Local/blob/main/LICENSE)。** 第三方组件仍遵循各自许可，详见 [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md)。

Windows 10 / 11 x64 · [下载安装包 (Download Installer)](https://github.com/yq04/Claude-Local/releases/download/v0.2.3/Claude-Local_0.2.3_x64-setup.exe) · [交付核验 (Verification)](https://github.com/yq04/Claude-Local/blob/main/docs/RELEASE_VERIFICATION_0.2.3_SECURITY.md)

安装包 / Installer: `Claude-Local_0.2.3_x64-setup.exe` · `140,883,227` bytes (134.36 MiB)

SHA-256: `fa122f952b9a0a7987e51047eb3b341171820e58823a4b15380cd85d362b3e31`

源码 / Source: [`dd25de8432ccfa3609d40881c40b4fa60b038b24`](https://github.com/yq04/Claude-Local/commit/dd25de8432ccfa3609d40881c40b4fa60b038b24)

```powershell
Get-FileHash .\Claude-Local_0.2.3_x64-setup.exe -Algorithm SHA256
# Expected SHA-256: fa122f952b9a0a7987e51047eb3b341171820e58823a4b15380cd85d362b3e31
```

---

## 简体中文

`Claude-Local 0.2.3` 围绕**伴生浏览器按需无阻断防泄露断路器（Kill-Switch）**、**Clash Verge / Mihomo `strict-route` 分层闭环修复向导**、**养号卡片常驻国家/时区锁定与打开前防漂移核验**、**养号全阶段防封 SOP 折叠参考**、**高消耗速率温和提示**、**全链路加密备份扩展**以及**多账号与养号交互细节打磨**完成全面升级。

### 1. 伴生浏览器按需无阻断防泄露断路器（F1）

- **按需轻量巡检，零闲置开销**：仅在检测到受管伴生浏览器（CLI 身份槽位或养号槽位）正在运行时启动后台巡检；无受管浏览器运行时自动休眠，不发起任何网络探测。
- **双通道故障触发**：
  1. **系统 TUN 虚拟网卡掉线（每 5 秒本地核验）**：当当前运行槽位依赖系统 TUN 路由（未配置独立本地代理端口）且连续两次确认 TUN 网卡断开时，立即调用优雅退出流程关闭全部运行中的受管伴生浏览器，阻断 Chromium 回退物理网卡直连导致真实本地 IP 暴露。
  2. **出口 IP 国家漂移（每 60 秒低频核验）**：当探测到的当前出口国家与该槽位锁定的预期国家不一致时，立即保护性关闭受管伴生浏览器。
- **绝不拦截后续正常使用，绝不触碰 CLI**：
  - 断路器为**单次急停 + 状态提醒**，**不是**持久锁死门禁：触发后托盘图标切换为红色警示并在「浏览环境」顶部展示红色横幅，用户恢复代理后点击「打开浏览器并实测」或养号卡片「打开网页」即可正常启动并自动清除告警。
  - **绝对不触碰、不中断正在运行的 `claude.exe`（Claude Code CLI）终端会话**。

### 2. Mihomo / Clash Verge `strict-route` 分层闭环修复向导（F2）

- **直击三层配置覆盖痛点**：针对 Clash Verge Rev「订阅配置 → 全局扩展覆写（Merge） → 运行期生成配置（`clash-verge.yaml`）」三层架构下仅开启主界面 TUN 开关仍可能导致运行期 `tun.strict-route: false` 的问题，在「风控验证」页面的 `strict-route` 警告项旁新增 **「修复 Strict-Route」** 按钮。
- **一键复制 Merge YAML + 实时复核闭环**：弹窗提供 GUI 开关与全局 Merge 覆写两种永久生效方案，支持一键复制标准 YAML 覆写片段（`tun.strict-route: true` + `dns.enable: true`），并在修改重载后点击「我已完成设置，立即复核」直接重跑 `system_network_audit` 验证运行期配置。

### 3. 养号卡片常驻国家/时区锁定与打开前防漂移核验（F3）

- **首次核验自动锚定**：养号卡片新增向后兼容字段 `registered_country`、`registered_timezone`、`last_probe_country`、`last_probe_timezone` 与 `last_probe_at`。首次通过伴生浏览器完成环境核验并锁定有效地区时，自动记录该卡的常驻国家与时区。
- **打开前跨国漂移拦截确认**：后续点击养号卡片打开网页前，后台自动比对当前出口国家与卡片锁定国家；若发生跨国漂移（如锁定 `US` 而当前出口为 `SG`），弹出警示确认框，支持「取消」、「仍要打开（不改锁定）」或「更新锁定地区并打开」。
- **工牌零溢出漂移徽章与手动修正**：当最近探测国家与锁定国家不一致时，在卡片环境行内联显示紧凑琥珀色徽章（保持 `180×286` 工牌固定几何尺寸）；支持在编辑弹窗中手动修改或清空锁定国家/时区。

### 4. 养号阶段防封操作指南（SOP）与高消耗速率提示（F4 & F5）

- **编辑弹窗内嵌折叠 SOP**：在养号卡片新建/编辑弹窗底部内嵌默认收起的阶段化防封操作指南（涵盖待注册核验、刚过 KYC 前 72 小时观察期、日常轻度对话与 Pro 绑卡转正注意事项），不占用主界面卡片高度。
- **额度详情高负荷温和提示**：在身份「额度与重置权益」弹窗中，当 5 小时窗口已用达到 `85%` 及以上，或 7 天窗口进度显著超前（`deltaUsedPct >= 15%`）时，展示非阻断的抗风控节奏提示。

### 5. 全链路加密备份扩展与多账号体验打磨（F6 & Polish）

- **全链路加密备份覆盖养号与手动订阅记录**：`identity-vault/warming_cards.json` 与 `identity-vault/manual_subscriptions.json` 现已纳入 `.clbackup` 整库加密导出、完整性预检（含 `browser_bindings` 槽位与正整数种子校验）、启动前自动救援备份及隔离恢复。
- **多账号与养号交互优化**：
  - 当伴生浏览器当前选中养号卡槽位时，当前 CLI 身份的「同步订阅日期与额外重置」可直接定位并打开其已绑定的独立 CLI 浏览器资料完成同步，无需先手动切回槽位。
  - 操作进度面板完成后支持一键「关闭记录」与随时「查看上次记录」；返回 CLI 浏览器自动清理陈旧提示；区分自动续订日与手动到期日的悬停说明。

### 6. 资料兼容与交付核验

- **100% 向下兼容**：已有加密身份库（`BAGAID01` / `.baga`）、SQLite `user_version = 3`、主密钥、账号 HMAC、浏览器确定性种子与个人资料目录保持完全兼容；从 `0.1.x`、`0.2.0` 或 `0.2.2` 升级无需重建身份，亦不中断正在运行的 `claude.exe` 会话。建议升级前在「软件设置 → 数据管理」导出一份 `.clbackup` 口令加密备份。
- **解包与隐私审计**：本次安装包在独立中性目录构建，通过 109 个解包资源文件的白名单与哈希核对，29 项外置隐私探针扫描 `0` 命中（详见 [v0.2.3 交付核验](https://github.com/yq04/Claude-Local/blob/main/docs/RELEASE_VERIFICATION_0.2.3_SECURITY.md)）。这些合成与静态核验不代表真实账号服务端授权或安装/卸载向导全生命周期验收。

---

## English

**Claude-Local is derived from [CCBaga](https://github.com/liseami/CCBaga) by [@liseami](https://github.com/liseami) and contributors, and is maintained independently. The original contributors' copyright and [MIT license](https://github.com/yq04/Claude-Local/blob/main/LICENSE) are retained.** Third-party components remain subject to their own terms in [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md).

`Claude-Local 0.2.3` introduces an **On-Demand, Non-Blocking Companion Browser Kill-Switch**, a **Layered `strict-route` Remediation Guide & Live Re-verify Loop**, **Warming Card Country/Timezone Lock & Pre-open Drift Protection**, **Stage-Specific Anti-Ban SOP Reference**, **High-Load Quota Pace Hints**, **Full-Chain Encrypted Vault Backup Extension**, and **Multi-Account Workflow Polish**.

### 1. On-Demand, Non-Blocking Companion Browser Kill-Switch (F1)

- **On-Demand Monitoring with Zero Idle Overhead**: Background checks run only while a managed companion browser profile (`browser/contexts/*/profile` or `browser/profile`) is active, sleeping completely when all managed browsers are closed.
- **Dual-Trigger Protection**:
  1. **System TUN Drop (5s local check)**: If a running profile relies on system TUN routing (no explicit per-slot proxy) and the TUN adapter drops across two consecutive checks, all running managed companion browser slots are gracefully closed to prevent direct physical-adapter IP exposure.
  2. **Exit Country Drift (60s check)**: If the observed exit country drifts from the slot's locked country, running managed companion browser slots are closed protectively.
- **Never Blocks Subsequent Use & Never Touches CLI**:
  - Acts as a one-shot emergency stop + banner/tray alert rather than a persistent lock: once the user restores their proxy and clicks **Open browser & check** or opens any warming card, the browser launches normally and clears the alert automatically.
  - **Never interrupts, stops, or modifies running `claude.exe` (Claude Code CLI) sessions**.

### 2. Layered `strict-route` Remediation Guide & Re-verify Loop (F2)

- Adds a **Fix Strict-Route** action next to the `strict-route` check on the **Risk & KYC** page, explaining Clash Verge Rev's three-layer config precedence (`Subscription -> Global Merge Override -> Runtime clash-verge.yaml`), offering one-click copy for the Global Merge YAML snippet, and providing a **Re-verify Now** button to re-run `system_network_audit` in place.

### 3. Warming Card Country/Timezone Lock & Pre-open Drift Check (F3)

- Automatically anchors `registered_country` and `registered_timezone` on the first verified browser check, prompts before opening a warming card if the current exit country differs from the locked country, displays a compact inline drift badge within the fixed `180×286` card geometry, and allows manual editing or clearing in the card dialog.

### 4. Stage Anti-Ban SOP Reference & Quota Pace Hint (F4 & F5)

- Adds a collapsed stage-aware SOP `<Disclosure>` inside the warming card create/edit dialog (covering pre-KYC checks, the first 72 hours post-KYC, daily free warming, and Pro upgrade/CLI promotion) and a non-blocking pacing hint in the quota details dialog when 5h usage >= 85% or 7d pace delta >= +15%.

### 5. Full-Chain Vault Backup Extension & Workflow Polish (F6 & Polish)

- Extends `.clbackup` password-encrypted export, preflight verification (including `browser_bindings` slot/seed validation), automatic rescue backups, and isolated restore to include optional `identity-vault/warming_cards.json` and `identity-vault/manual_subscriptions.json`.
- Enables account-bound subscription sync even when a warming card slot is selected, adds dismiss/reopen controls to the operation activity log, clears stale quota feedback on returning to the CLI browser, and distinguishes auto-renewal vs. manual expiry tooltips.

### 6. Data Compatibility & Delivery Verification

- **Full Backward Compatibility**: Existing encrypted vaults (`BAGAID01` / `.baga`), SQLite `user_version = 3`, master keys, account HMACs, deterministic browser seeds, and browser profiles remain 100% compatible. Upgrading from `0.1.x`, `0.2.0`, or `0.2.2` requires no identity recreation and never interrupts running `claude.exe` sessions. Export a password-encrypted `.clbackup` archive before upgrading.
- **Payload & Privacy Audit**: Built in a fresh neutral staging directory, the NSIS installer passed an extracted-payload allowlist and hash audit across all 109 files, and all 29 external privacy probes returned 0 findings (see [v0.2.3 Delivery Verification](https://github.com/yq04/Claude-Local/blob/main/docs/RELEASE_VERIFICATION_0.2.3_SECURITY.md)). Synthetic and static audits do not substitute for live account authorization or full installer/uninstaller lifecycle acceptance.

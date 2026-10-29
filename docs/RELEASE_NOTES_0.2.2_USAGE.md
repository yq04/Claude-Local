<!--
[INPUT]: Version 0.2.2 account-attribution reliability, token-focused analytics, account-isolated shared-ledger HUD and audited installer receipts.
[OUTPUT]: Bilingual public release notes for Claude-Local v0.2.2 without private runtime data or unverified artifact values.
[POS]: Current public release description; the older RELEASE_NOTES_0.2.2.md remains a historical development record.
[PROTOCOL]: Retain CCBaga/MIT attribution and data-format compatibility; record artifact checksums only from the audited build.
-->
# Claude-Local 0.2.2

**Claude-Local 基于 [CCBaga](https://github.com/liseami/CCBaga)（[@liseami](https://github.com/liseami) 及贡献者）二次开发并独立维护，保留原贡献者版权与 [MIT 许可](https://github.com/yq04/Claude-Local/blob/main/LICENSE)。** 第三方组件仍遵循各自许可，详见 [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md)。

Windows 10 / 11 x64 · [下载安装包](https://github.com/yq04/Claude-Local/releases/download/v0.2.2/Claude-Local_0.2.2_x64-setup.exe)

安装包 / Installer: `Claude-Local_0.2.2_x64-setup.exe` · `140,697,822` bytes (134.18 MiB)

SHA-256: `981b26f6cec183cabf58baefe8bb8184a4d9d647eb30cc65570dd3e111838617`

源码 / Source: [`13dd440ae448bd2c2fd0d52b069c14210fea3427`](https://github.com/yq04/Claude-Local/commit/13dd440ae448bd2c2fd0d52b069c14210fea3427)

```powershell
Get-FileHash .\Claude-Local_0.2.2_x64-setup.exe -Algorithm SHA256
# Expected SHA-256: 981b26f6cec183cabf58baefe8bb8184a4d9d647eb30cc65570dd3e111838617
```

## 简体中文

0.2.2 新增身份卡片 `PRO`/`MAX` 右侧 `MM/DD` 订阅到期显示与手动充值补录，新增「风控验证」出口一致性与手机同住宅出口 KYC 桥接工作台，并改善新账号统计归属及账号隔离 HUD 指标。

- **身份卡片订阅到期显示（`MM/DD`）**：在每张身份卡片的 `PRO` / `MAX` 徽章右侧显示月/日格式的订阅到期日期（如 `11/12`）。支持通过已绑定伴侣浏览器一键「同步浏览器订阅」自动获取，也可点击徽章或卡片 `⋯` 菜单「设置订阅到期」填入充值日期自动推算 `+1 个自然月` 或直接指定到期日（加密身份库同目录独立私有 DACL 存储，零 `.claude.json` 写入、不中断运行中的 `claude.exe`）。
- **风控验证与手机同住宅出口 KYC 桥接**：新增「风控验证」页面，支持 `claude.ai` 与 `withpersona.com` 跨域出口 IP 一致性检测、DNS/DoH 泄露审计，以及 Shadowrocket / Clash Mi / Stash / sing-box 离线配置生成与二维码投送，确保手机实名认证与桌面端共用同一静态住宅出口。
- **账号统计更可靠**：统计身份独立于归档登记；受控新登录后，续聊产生的新响应可按登录证据归属。账号视图仅显示有依据的记录，「全部」保留完整统计口径。
- **用量页聚焦 Token 与共享账本 HUD**：突出总量及未缓存输入、输出、缓存写入、缓存读取四类构成；HUD 按当前账号显示滚动近 5 小时 Token、缓存命中与近 10 分钟平均 `tok/m`。账号下拉仅保留「全部」与动态账号列表。
- **保留现有工作流**：继续支持时间/账号筛选、IANA/DST、TSV 导出和 HUD 三态、置顶、锁定、磁吸、自动隐藏、透明度与主题同步。已有身份库、`.baga` 归档、密钥及浏览器资料格式保持兼容。

本次安装包通过 108 个解包资源文件的审计，17 项私有隐私探针均无发现；相关合成检查已通过。这些检查不等于真实账号授权或安装/卸载向导全生命周期验收。

Token 统计来自本地已有记录，不能换算为订阅账单或剩余额度。升级前建议导出口令加密备份。README 用量页为 0.2.2 合成截图，其他页面保留标注版本的旧版示例。

## English

**Claude-Local is derived from [CCBaga](https://github.com/liseami/CCBaga) by [@liseami](https://github.com/liseami) and contributors, and is maintained independently. The original contributors' copyright and [MIT license](https://github.com/yq04/Claude-Local/blob/main/LICENSE) are retained.** Third-party components remain subject to their own terms in [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md).

Version 0.2.2 adds `MM/DD` subscription expiry badges next to `PRO`/`MAX` on identity cards, introduces the Risk & KYC cross-domain exit consistency and mobile same-residential KYC bridge workbench, and improves account-attribution analytics and the shared-ledger floating HUD.

- **Identity card subscription expiry (`MM/DD`)**: Displays the monthly subscription expiry date (`MM/DD`) directly to the right of the `PRO` / `MAX` badge on each identity card. Supports automatic sync from the bound companion browser profile (`Sync browser subscription`) as well as manual recharge-date (`+1 calendar month`) or expiry-date entry (`Set subscription expiry`) stored in a DACL-protected local file without touching `.claude.json` or interrupting `claude.exe`.
- **Risk & KYC verification & mobile residential bridge**: Adds the Risk & KYC page for `claude.ai` vs. `withpersona.com` exit-IP consistency checks, DNS/DoH leak auditing, and offline Shadowrocket / Clash Mi / Stash / sing-box profile generation with local QR code delivery so mobile Persona KYC shares the exact desktop static residential exit.
- **More reliable account statistics**: Statistics identities register independently of saved archives. New responses in resumed sessions can use evidence from a controlled sign-in. Account views show supported records; All accounts preserves the full accounting scope.
- **Token-focused analytics & shared-ledger HUD**: Highlights totals and uncached input, output, cache writes, and cache reads; the HUD filters by the current account for rolling 5h tokens, cache hit rate, and fixed 10-minute average `tok/m`.
- **Existing workflows preserved**: Retains time/account filters, IANA/DST, TSV export, and HUD modes, Pin, Lock, snap, auto-hide, opacity, and theme sync. Existing vaults, `.baga` archives, keys, and browser profiles remain format-compatible.

The installer passed an extracted-payload audit covering 108 resource files, and all 17 private privacy probes returned no findings. Relevant synthetic checks passed. These checks do not establish live account authorization or full installer/uninstaller lifecycle acceptance.

Local token records do not convert to subscription charges or remaining quota. Export a password-encrypted backup before upgrading. README usage images show synthetic 0.2.2 data; other pages retain labeled historical examples.

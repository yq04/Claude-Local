<!--
[INPUT]: Version 0.2.2 account-attribution reliability, token-focused analytics and account-isolated shared-ledger HUD.
[OUTPUT]: Bilingual public release notes for Claude-Local v0.2.2 without private runtime data or unverified artifact values.
[POS]: Current public release description; the older RELEASE_NOTES_0.2.2.md remains a historical development record.
[PROTOCOL]: Retain CCBaga/MIT attribution and data-format compatibility; record artifact checksums only from the audited build.
-->
# Claude-Local 0.2.2

**Claude-Local 基于 [CCBaga](https://github.com/liseami/CCBaga)（[@liseami](https://github.com/liseami) 及贡献者）二次开发并独立维护，保留原贡献者版权与 [MIT 许可](https://github.com/yq04/Claude-Local/blob/main/LICENSE)。** 第三方组件仍遵循各自许可，详见 [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md)。

Windows 10 / 11 x64 · [下载安装包](https://github.com/yq04/Claude-Local/releases/download/v0.2.2/Claude-Local_0.2.2_x64-setup.exe)

## 简体中文

0.2.2 改善新账号与续聊记录的统计归属，并将用量页和悬浮监控窗统一为有记录依据的 Token 指标。

- **账号统计更可靠**：统计身份独立于归档登记；受控新登录后，续聊产生的新响应可按登录证据归属。账号视图仅显示有依据的记录，「全部」保留完整统计口径。
- **用量页聚焦 Token**：突出总量及未缓存输入、输出、缓存写入、缓存读取四类构成；显示明确会话数、活跃天数、去重响应与全部模型/Effort 分布，移除美元成本和缓存节省金额。账号下拉仅保留「全部」与动态账号列表。
- **HUD 与用量页共享账本**：按当前账号显示滚动近 5 小时 Token、四类构成、缓存命中与近 10 分钟平均 `tok/m`。无法确认账号或读取失败时显示未知；移除假定上下文容量和缺少依据的耗尽时间预测。
- **保留现有工作流**：继续支持时间/账号筛选、IANA/DST、TSV 导出和 HUD 三态、置顶、锁定、磁吸、自动隐藏、透明度与主题同步。已有身份库、`.baga` 归档、密钥及浏览器资料格式保持兼容。

Token 统计来自本地已有记录，不能换算为订阅账单或剩余额度。升级前建议导出口令加密备份；安装包大小与 SHA-256 以本次 Release 的实际产物记录为准。README 用量页为 0.2.2 合成截图，其他页面保留标注版本的旧版示例。

## English

**Claude-Local is derived from [CCBaga](https://github.com/liseami/CCBaga) by [@liseami](https://github.com/liseami) and contributors, and is maintained independently. The original contributors' copyright and [MIT license](https://github.com/yq04/Claude-Local/blob/main/LICENSE) are retained.** Third-party components remain subject to their own terms in [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md).

Version 0.2.2 improves attribution for new accounts and resumed sessions, and aligns analytics and the floating HUD around recorded token usage.

- **More reliable account statistics**: Statistics identities register independently of saved archives. New responses in resumed sessions can use evidence from a controlled sign-in. Account views show supported records; All accounts preserves the full accounting scope.
- **Token-focused analytics**: Highlights totals and uncached input, output, cache writes, and cache reads; shows explicit sessions, active days, unique responses, and all-model/Effort distributions. Removes USD cost and cache-savings amounts. The account dropdown contains only All accounts and the dynamic account list.
- **One ledger for analytics and HUD**: Filters by the current account and shows rolling 5h tokens, composition, cache hit rate, and a fixed 10-minute average `tok/m`. Unverified accounts or read failures show unknown values. Removes assumed context capacity and unsupported exhaustion-time predictions.
- **Existing workflows preserved**: Retains time/account filters, IANA/DST, TSV export, and HUD modes, Pin, Lock, snap, auto-hide, opacity, and theme sync. Existing vaults, `.baga` archives, keys, and browser profiles remain format-compatible.

Local token records do not convert to subscription charges or remaining quota. Export a password-encrypted backup before upgrading. Installer size and SHA-256 come from this Release's actual build records. README usage images show synthetic 0.2.2 data; other pages retain labeled historical examples.

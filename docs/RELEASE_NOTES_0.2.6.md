<!--
[INPUT]: Source-confirmed Windows x64 0.2.6 card ordering, silent local refresh, promotion fix, HUD lifecycle/click-through, targeted quota queries, Smart Relay, usage exports and payment-site guidance.
[OUTPUT]: Bilingual public release notes; artifact hashes come only from the audited build's SHA256SUMS.txt.
[POS]: Public release notes linked from both READMEs and the v0.2.6 GitHub Release.
[PROTOCOL]: Retain attribution and persistent format compatibility; distinguish copy-only environment handoff from cancelled portable identity packages.
-->

# Claude-Local 0.2.6 发布说明 / Release Notes

Claude-Local 基于 [CCBaga](https://github.com/liseami/CCBaga)（[@liseami](https://github.com/liseami) 及贡献者）二次开发并独立维护，保留原贡献者版权与 [MIT 许可](https://github.com/yq04/Claude-Local/blob/main/LICENSE)。第三方组件遵循各自许可，详见 [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md)。

Windows 10 / 11 x64 · [下载安装包 / Download installer](https://github.com/yq04/Claude-Local/releases/download/v0.2.6/Claude-Local_0.2.6_x64-setup.exe) · [Release](https://github.com/yq04/Claude-Local/releases/tag/v0.2.6) · [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.2.6/SHA256SUMS.txt)

## 简体中文

0.2.6 聚焦身份工作台、额度小窗与本地用量分析的日常操作体验，包含已实现的 P0–P7 优化及后续界面与转正修复。

- **紧凑卡片与排序**：身份卡与养号卡统一为 `166×286`，顶部横条支持拖拽调序、相邻卡片过渡与边缘自动横滚，也可用左右方向键调序；两栏顺序分别保存在本机。
- **5 秒静默本地同步**：定时检查本地额度与订阅元数据变化，摘要更新不再触发整栏加载闪烁；浏览器运行状态相同值去重。这不是每 5 秒在线查询额度。
- **转正与新身份引导**：空卡分为浏览器核验/登录、CLI 授权两步；未登录工作区即使留有项目、历史或缓存，普通保存和切换也不会再生成多余空白「当前身份」卡。恢复检查点仍保留中断后的工作文件。
- **额度小窗（HUD）**：完善静态隐藏窗口生命周期、权限、透明圆角及位置记忆；提供 5h/7d 时间进度游标、Windows 鼠标穿透和托盘/主界面恢复交互入口。移除底部接力横条，避免遮住三张指标卡。
- **智能接力与定向查询**：接力面板增加账号池容量汇总、`auto / session / manual` 三态会话保持，并让已推定重置且恢复余量的账号参与就绪评估；在线查询可选择「仅查未知/过期」。接力默认关闭，切换仍遵守进程检查和确认流程。
- **用量分析与导出**：增加 `tok/req`、`$/req` 单次均值、峰值时段徽章、账号表五维排序、时段明细花费/缓存率及 TSV 花费字段，支持复制脱敏 Markdown 简报。美元金额为官方 API 单价折算的等效花费。
- **环境交接与支付指引**：身份/养号卡保留「复制跨机防关联交接卡」，供人工核对环境配置；补充 PayPal/Stripe/KYC 站点数据清理指引和 PayPal 设置页地址复制，扩充支付关联域名与远程 DoH 的同出口配置提示。

现有全库 `.clbackup` 口令加密备份保留。单身份加密导入/导出和 `.bagapack` / `CLPACK01` 跨机身份包方案已取消，不属于本版功能或后续实施承诺；复制交接卡不转移登录凭据或浏览器会话。环境核验与配置建议不保证账号不受风控。

`BAGAID01` / `.baga`、SQLite `user_version = 3`、已有主密钥、账号 HMAC 与浏览器种子保持兼容；升级保留已有身份库与浏览器资料，不主动终止运行中的 `claude.exe`。0.2.6 使用新标签与新资产，既有 0.2.5 标签和安装包保持不变。

## English

Claude-Local is derived from [CCBaga](https://github.com/liseami/CCBaga) by [@liseami](https://github.com/liseami) and contributors, and maintained independently. Original copyright and the [MIT license](https://github.com/yq04/Claude-Local/blob/main/LICENSE) are retained; third-party terms are documented in [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md).

0.2.6 improves everyday identity, Quota HUD and local usage workflows, combining the implemented P0–P7 improvements with card layout and promotion fixes.

- **Compact, reorderable cards**: Identity and warming cards use a `166×286` layout. Drag their top handles with animated neighbor movement and edge scrolling, or reorder with Left/Right keys. Each rail keeps its own local order.
- **Silent local synchronization every 5 seconds**: Local quota/subscription metadata changes refresh summaries without reloading the card rail; unchanged browser runtime samples are deduplicated. This does not query online quota every 5 seconds.
- **Promotion and new-identity guidance**: Empty cards show separate browser verification/sign-in and CLI authorization steps. An unauthenticated workspace with leftover projects, history or cache no longer produces an extra blank current-identity card during ordinary saves or switches. Recovery checkpoints still preserve work created after an interruption.
- **Quota HUD**: Improves the statically declared hidden window lifecycle, permissions, transparent corners and saved position. Adds 5h/7d time markers, Windows click-through mode and tray/main-window controls to restore interaction. Removing the relay footer keeps all three bottom metrics visible.
- **Smart Relay and targeted queries**: Adds pool capacity summaries and `auto / session / manual` affinity modes, and includes accounts with inferred resets and restored headroom in readiness evaluation. Online queries can target only unknown/stale accounts. Relay remains off by default; switches retain process checks and confirmations.
- **Usage analytics and exports**: Adds average `tok/req` and `$/req`, a peak-period badge, five sortable account dimensions, period cost/cache-hit columns, TSV cost fields and a de-identified Markdown summary copy action. USD figures are equivalent costs calculated from official API prices.
- **Environment handoff and payment guidance**: Keeps Copy Handoff Spec on identity/warming cards for manual environment review. Adds PayPal/Stripe/KYC site-data cleanup guidance and a copyable PayPal settings URL, plus broader payment-domain and remote-DoH routing guidance.

Existing full-vault `.clbackup` password-encrypted backup remains available. Single-identity encrypted import/export and the `.bagapack` / `CLPACK01` portable-identity proposal are cancelled, with no implementation commitment. Copy Handoff Spec transfers no login credentials or browser sessions. Environment checks and configuration guidance do not guarantee freedom from account enforcement.

`BAGAID01` / `.baga`, SQLite `user_version = 3`, existing master keys, account HMACs and browser seeds remain compatible. Upgrades preserve vaults and browser profiles without actively terminating running `claude.exe` sessions. Version 0.2.6 uses a new tag and assets; existing 0.2.5 artifacts remain unchanged.

## 安装包校验 / Installer verification

请将以下结果与本版 Release 的 `SHA256SUMS.txt` 比对。 / Compare the result with `SHA256SUMS.txt` from this release.

```powershell
Get-FileHash .\Claude-Local_0.2.6_x64-setup.exe -Algorithm SHA256
```

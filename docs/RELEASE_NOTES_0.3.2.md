<!--
[INPUT]: Source-confirmed Windows x64 0.3.2 full-stack polish and hardening across identity cards, account isolation, risk avoidance, quota query and usage analytics, plus quota/usage load performance, manual-reset display and quota-details dialog redesign.
[OUTPUT]: Bilingual public release notes; artifact hashes come only from the audited build's SHA256SUMS.txt.
[POS]: Public release notes linked from both READMEs and the v0.3.2 GitHub Release.
[PROTOCOL]: Retain attribution and persistent format compatibility; never require Companion Browser as the Windows default browser.
-->

# Claude-Local 0.3.2 发布说明 / Release Notes

Claude-Local 基于 [CCBaga](https://github.com/liseami/CCBaga)（[@liseami](https://github.com/liseami) 及贡献者）二次开发并独立维护，保留原贡献者版权与 [MIT 许可](https://github.com/yq04/Claude-Local/blob/main/LICENSE)。第三方组件遵循各自许可，详见 [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md)。

Windows 10 / 11 x64 · [下载安装包 / Download installer](https://github.com/yq04/Claude-Local/releases/download/v0.3.2/Claude-Local_0.3.2_x64-setup.exe) · [Release](https://github.com/yq04/Claude-Local/releases/tag/v0.3.2) · [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.3.2/SHA256SUMS.txt)

## 简体中文

0.3.2 是一次面向五大核心域（**身份卡片、账号隔离、风险规避、额度查询、用量分析**）的全量打磨与加固版本，同时根治额度/用量页面卡顿，并重新设计额度详情弹窗。

- **额度与用量加载提速（根治卡顿）**：
  - 含损坏或超长（>2 MiB）记录行的大型会话日志此前不会缓存读取游标，每次用量读取与悬浮窗每个采集周期都会被整文件重新解析；现在以损坏标记缓存游标并保留“存在无效记录”提示，未变化日志全部走零读取快路径。
  - 未变化文件跳过逐文件所有者查询；无新数据时不再产生持久化写入；悬浮窗只做增量采集、不做全量聚合；相同查询在数据未变时复用统计结果；身份页读取不再排队等待用量扫描。
  - 身份页变化检测改为按内容判断，Claude Code CLI 日常改写 `.claude.json` 中的项目统计、提示记录等簿记字段不再触发整页重读；内容未变时不重渲染卡片。
  - 用量页按时段/账号缓存快照，切回已访问时段或重新进入页面立即显示并在后台刷新。
- **额度详情弹窗重新设计**：资料头（头像、名称、邮箱、套餐）→ 5h / 7d 双额度卡片（剩余百分比、进度条、重置时间与倒计时、数据来源与观测时长）→ 7d 消耗步调标签 → 续期时间 / 可用主动重置次数 / 账号隔离状态列表 → 折叠的采集说明；底部主操作「网页同步额度与重置」。修复步调文案出现双加号的问题。
- **主动重置次数显示更可靠**：网页同步额外保存权益的真实到期时间；卡片直接显示上次同步的次数，仅在确认已到期时隐藏；“即将到期”提醒只按真实到期时间计算，不再因 24 小时新鲜度上限误报。
- **多账号网页同步与浏览器隔离**：已保存卡片与当前卡片的「网页同步额度与重置」按目标卡片精确核验身份，每次同步独占临时回环端口，支持多账号并发同步；任意卡片可按需建立专属浏览器槽位，支持多个账号的隔离浏览器同时打开官方用量页与聊天页，互不抢占、互不关闭。
- **账号隔离与净室清洗**：切换到空白环境与移除当前身份时同样清理旧账号缓存；切号时刷新资料获取时间戳；补齐模型目录与 statsig 缓存清理及新版订阅/模型缓存键，设备指纹键保持不动；陈旧锁清理增加竞态保护；Windows 快照跳过开发者模式下的瞬态链接。
- **风险规避**：一键防泄漏模板改用 `DO_NOT_TRACK` / `DISABLE_TELEMETRY` / `DISABLE_ERROR_REPORTING`，不再使用会导致 `/model` 缺少模型的非必要流量开关，并对残留配置给出提示；进程核验改为受限查询权限，不再跨进程读取伴生浏览器内存；伴生浏览器冷启动参数补齐、多槽位 Kill-Switch 守护、配置原子写入。
- **额度查询**：支持 Ultra 无 5h 上限与周期归零推断、模型专项周池（Sonnet / Opus / Fable）与 Ultra / Team / Enterprise 层级；在线唤醒首选模型与 CLI 版本对齐；离线预警 OAuth 刷新凭据过期；SQLite 锁争用与重复读取进一步消除。
- **用量分析**：兼容新版 CLI 的字典形态思考深度并自动回填历史；账号表与导出按各账号实际模型单价计费；补齐新模型单价与快速模式倍率；修复小时粒度截图时区截断、顶栏重叠与浮层遮挡等问题。
- **身份卡片与界面细节**：自动续杯锚点按账号指纹隔离、悬浮小窗过期回退、任务交接弹窗挂载、批量取消状态等修复；卡片横向平滑滚动与恢复默认顺序；本地同步按钮触感确认；智能接力加入临近周重置加权；中英文案全面对齐，最小化时暂停动画与降频计时器以降低负载。

`BAGAID01` / `.baga`、SQLite `user_version = 3`、已有主密钥、账号 HMAC 与浏览器种子 100% 向下兼容；用量账本仅新增一列可重建的游标标记。升级保留已有身份库与浏览器资料，不主动终止运行中的 `claude.exe`。0.3.2 使用新标签与新资产，既有 0.3.1 及更早标签和安装包保持不变。

## English

Claude-Local is derived from [CCBaga](https://github.com/liseami/CCBaga) by [@liseami](https://github.com/liseami) and contributors, and maintained independently. Original copyright and the [MIT license](https://github.com/yq04/Claude-Local/blob/main/LICENSE) are retained; third-party terms are documented in [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md).

0.3.2 is a full polish and hardening release across the five core areas (**identity cards, account isolation, risk avoidance, quota query and usage analytics**). It also removes the quota/usage loading stalls and redesigns the quota details dialog.

- **Faster quota and usage loading**:
  - Large session logs containing a damaged or oversized (>2 MiB) record were never cursor-cached, so every usage read and every HUD collection tick re-parsed them from the start. Cursors are now cached with a damage flag (the "invalid records" notice is kept) and unchanged logs take a zero-read fast path.
  - Unchanged files skip per-file owner queries; scans with no new data no longer commit durable writes; the HUD ingests incrementally without full-history aggregation; identical queries reuse results while data is unchanged; identity reads never queue behind a usage scan.
  - Identity change detection is content-based, so routine CLI bookkeeping writes to `.claude.json` (per-project stats, tips) no longer reload the whole page, and unchanged snapshots do not re-render the cards.
  - The usage page caches snapshots per period/account, so revisiting a period paints instantly while refreshing in the background.
- **Redesigned quota details dialog**: profile header (avatar, name, email, plan) → 5h / 7d window cards (remaining %, progress bar, reset time and countdown, data source and age) → 7d burn-pace chip → renewal date / manual resets / isolation status list → collapsible setup guide, with **Sync web quota & resets** as the primary action. Fixes a doubled plus sign in the pace text.
- **More reliable manual-reset counts**: web sync also stores the real grant end; cards show the last synced count directly and hide it only once it is known to have ended; "expiring soon" now follows the real end instead of the 24-hour freshness bound.
- **Multi-account web sync and browser isolation**: **Sync web quota & resets** verifies the exact target card for both saved and current identities, uses a dedicated temporary loopback port per sync, and supports concurrent multi-account syncs. Any card can get its own browser slot on demand, so several isolated browsers can open the official usage and chat pages side by side without taking over or closing each other.
- **Account isolation and cleanroom**: switching to an empty environment and removing the current identity also prune the previous account's caches; switching refreshes the profile fetch timestamp; model-catalog and statsig caches plus newer subscription/model cache keys are cleaned while device-fingerprint keys stay untouched; stale-lock cleanup gains race protection; Windows snapshots skip transient developer-mode links.
- **Risk avoidance**: the one-click leak-protection template uses `DO_NOT_TRACK` / `DISABLE_TELEMETRY` / `DISABLE_ERROR_REPORTING` instead of the non-essential-traffic switch that hides models from `/model`, and flags leftover settings; process verification uses limited query rights without reading Companion Browser memory; Companion Browser cold-start flags, multi-slot kill-switch guarding and atomic config writes are hardened.
- **Quota query**: Ultra accounts without a 5h limit and weekly reset inference, model-scoped weekly pools (Sonnet / Opus / Fable) and Ultra / Team / Enterprise tiers are supported; the online wakeup model and CLI version are aligned; OAuth refresh-credential expiry is flagged offline; SQLite lock contention and repeated reads are reduced further.
- **Usage analytics**: dictionary-shaped thinking depth from newer CLIs is parsed and history is backfilled; the account table and exports price each account by its actual models; new model prices and fast-mode multipliers are added; hourly screenshot timezone truncation, header overlap and popover clipping are fixed.
- **Identity cards and UI details**: auto-wakeup anchors are isolated per account fingerprint; HUD stale fallback, task-handoff dialog mounting and batch-cancel state are fixed; card rails scroll smoothly and can restore the default order; local sync gives tactile confirmation; Smart Relay weighs upcoming weekly resets; bilingual copy is aligned, and animations and timers pause or slow down while the window is hidden.

`BAGAID01` / `.baga`, SQLite `user_version = 3`, existing master keys, account HMACs and browser seeds remain 100% compatible; the usage ledger only gains one rebuildable cursor flag column. Upgrades preserve vaults and browser profiles without terminating running `claude.exe` sessions. Version 0.3.2 uses a new tag and assets; existing 0.3.1 and earlier artifacts remain unchanged.

## 安装包校验 / Installer verification

请将以下结果与本版 Release 的 `SHA256SUMS.txt` 比对。 / Compare the result with `SHA256SUMS.txt` from this release.

```powershell
Get-FileHash .\Claude-Local_0.3.2_x64-setup.exe -Algorithm SHA256
```

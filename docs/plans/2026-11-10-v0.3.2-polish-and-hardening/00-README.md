<!--
[INPUT]: Full-stack source audit of Claude-Local (post-v0.3.1 working tree) + 2026-11-10 deep benchmark of 7 open-source repositories (liseami/CCBaga, Lee-xeo/Claude-Cage, realiti4/claude-swap, errhythm/ccswap, Dudude-bit/ccswap, farion1231/cc-switch, ccusage/ccusage) + prior Magpie/Orca/Cockpit-Tools references.
[OUTPUT]: Evidence-backed v0.3.2 audit findings, open-source comparison matrix, and 3-track implementation blueprint across Identity Cards, Account Isolation, Risk Avoidance, Quota Query, Usage Analytics, UI/Copywriting/Motion, and Concurrency/Load.
[POS]: Authoritative engineering & design plan for Claude-Local v0.3.2. Contains zero real identities, emails, proxy credentials, or personal machine paths.
[PROTOCOL]: Update status upon verification; preserve BAGAID01/.baga, SQLite user_version=3, HMAC, CCBaga seed domain, s13 device fingerprint continuity, and running claude.exe processes.
-->
# Claude-Local v0.3.2 深度调研、开源对标与全维度精修方案

## 一、 调研与对标概览

围绕 **身份卡片管理、账号隔离、风险规避、额度查询、用量分析** 五大核心域，以及 **文字内容、排版样式、交互反馈、切换动画、并发负载** 全链路细节，我们对当前代码库进行了逐行静态与运行时契约审查，并横向拆解了截至 2026-11-10 的 **7 个标杆 GitHub 开源项目**（辅以既有的 `magpie`、`orca`、`cockpit-tools` 对照）：

| 对标项目 | 核心长板与对 `Claude-Local v0.3.2` 的启发 |
| :--- | :--- |
| **`liseami/CCBaga`** | `NtQueryInformationProcess(ProcessCommandLineInformation=60)` 零 `PROCESS_VM_READ` 伴生浏览器命令行读取 + 文件句柄 `(VolumeSerialNumber, FileIndex)` 目录匹配；`.claude/debug/latest` 开发者模式重解析点豁免；显式默认端口（`:80`/`:443`）代理解析；`.claude.json` 订阅迁移键同步。 |
| **`Lee-xeo/Claude-Cage`** | `~/.claude/settings.local.json` 与托管配置层审计、环境覆盖变量排查、事件驱动按分钟边界对齐的 `QuotaClock`（后台隐藏零唤醒）。（注：明确排除其 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` 做法，避免阻断 GrowthBook 导致 `Fable 5.2` 与 `/usage` 异常。） |
| **`realiti4/claude-swap`** | Claude Ultra 套餐 `"five_hour": null` 无 5h 上限语义兼容；`GET /api/oauth/profile` 中 `Ultra` / `Team Premium` / `Enterprise` / `Lapsed` 订阅层级消歧；`.credentials.json` 离线 `refreshTokenExpiresAt` 7 天到期预警；`claude-haiku-5-5` 低成本唤醒探针；`limits[]` 专项周池识别。 |
| **`Dudude-bit/ccswap` & `errhythm/ccswap`** | 智能接力 `SoonReset (24h)` 临期周额度优先收割策略；免费重置卡（`manual_resets_valid_until`）`<=1h` / `<=24h` / `<=3d` 三级过期紧迫度视觉提示；异步操作按钮焦点保持。 |
| **`farion1231/cc-switch`** | 切号恢复时刷新 `oauthAccount.profileFetchedAt` 防止残留会话用旧令牌覆盖 `.claude.json`；锁文件清理前 `mtime` 二次核验防竞态；手动刷新按钮 `550ms` 最小旋转时长 + `✓` 完成态微交互反馈。 |
| **`ccusage/ccusage`** | Claude Code `v2.1.322` 对象格式 `effort: {"level": "high"}` 解包；`claude-mythos-preview` 与 `fable-5-2` 单价区分及 `usage.speed`（`fast`/`ultrafast`）倍率校准；多账号分模型真实等效成本归集。 |
| **`yetone/magpie` & `stablyai/orca`** | 批量查询回执省略零值桶（消除“0 刷屏”）；账号池采用真实平均余量替代跨倍率失真的百分比简单相加；安全文案克制表达（陈述已核验配置边界而非承诺绝对零风险）；深色/毛玻璃表面采用 `color-mix()` 语义色替代硬编码浅色色块。 |

> **边界重申**：严格遵守 `CLAUDE.md` 与 `AGENTS.md`，**不实现**已于 2026-11-02 取消的单账号 `.bagapack` 导出方案；保留 `BAGAID01`、`.baga`、SQLite `user_version=3`、HMAC、`CCBaga` 种子域与 `s13` 设备指纹连续性；绝不中断任何运行中的 `claude.exe`。

---

## 二、 审查发现的核心缺陷与优化清单（按三大并行轨道划分）

### Track 1：账号净室隔离、风险规避与伴生浏览器防漏加固
1. **修复切空身份与删除当前号绕过 `maintain_account_caches` 的净室漏洞**（`src-tauri/src/identities/store.rs`）：
   - `Store::switch` 此前仅在 `incoming.is_some()` 时调用 `maintain_account_caches`，导致切往 `"empty"` 或 `Store::delete("current")` 时未触发 `cleaner_identity.rs` 的 `acct == None` 净室分支，遗留 `metricsStatusCacheByPrincipal`、`groveConfigCache`、`.claude/statsig`、`.claude/cache/model-catalog` 与 `.claude/telemetry/*.json`。
2. **跨号模型目录隔离、`profileFetchedAt` 防回写戳与 `v2.1.322` 键补齐**（`src-tauri/src/cleaner_identity.rs`、`cleaner_config.rs`、`cleaner.rs`、`identities/archive.rs`）：
   - 切入已保存账号时同步清理 `.claude/cache/model-catalog` 与 `.claude/statsig`，更新 `oauthAccount.profileFetchedAt` 为当前毫秒时间戳；动态裁剪 `(fable*|mythos*)*OrgPickMove*` 键，补齐 `fable52OrgPickMove*` 与 4 项订阅提示计数键（严守 `s13` 红线）；补齐 `GRPC_PROXY` 诊断与清理；锁清理增加 `mtime` 防竞态复核；归档扫描跳过 Windows 开发者模式 `.claude/debug/latest` 临时链接。
3. **对齐 `Fable 5.2` GrowthBook 要求，重构 CLI 遥测护盾模板与审计**（`src-tauri/src/risk_check.rs`、`src/risk-model.ts`、`src/risk-verification.tsx`、`src/claude-residue-panel.tsx`、`src/vps.tsx`）：
   - 从一键 `settings.json` 防漏模板中移除会阻断 GrowthBook 特性拉取、隐藏 `Fable 5.2` 的 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1"`，改用 `DISABLE_TELEMETRY: "1"` + `DISABLE_ERROR_REPORTING: "1"` + `DO_NOT_TRACK: "1"`；
   - 当检测到用户残留 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` 时给出明确琥珀色告警提示；统一 Rust 与 TS 在 Windows 大小写不敏感环境变量下的 `proxy_env_complete` 判定；扩展只读审计覆盖 `settings.local.json` 与项目级 `projects.*.mcpServers`。
4. **伴生浏览器零 `PROCESS_VM_READ` 检查、TOCTOU 冷启动封堵与多槽位 Kill-Switch**（`src-tauri/src/windows_process.rs`、`browser/quota_existing.rs`、`browser/kill_switch.rs`、`browser/profile.rs`、`browser/config.rs`）：
   - 浏览器进程参数读取优先采用 `NtQueryInformationProcess(ProcessCommandLineInformation)` + 文件句柄 `(VolumeSerialNumber, FileIndex)` 身份比对；
   - `quota_existing.rs` 复用完整防漏启动参数，杜绝浏览器刚退出瞬间触发裸参数冷启动；
   - `kill_switch.rs` 覆盖全部运行中受管槽位的代理/TUN 与国家配置；`profile.rs` JSON 写入补齐唯一临时文件 + `sync_all()`；`config.rs` 兼容显式 `:80`/`:443` 端口代理地址。

### Track 2：额度后端并发、Ultra/重置卡/专项池适配与用量分析 2.2
1. **SQLite 并发锁消除与归属防断层**（`src-tauri/src/identities/database.rs`、`usage.rs`、`profile.rs`、`scripts/claude_quota_online.py`）：
   - `Database::open` 对已初始化 `user_version == 3` 的库走只读快路径，消除每次 UI 读取开启 `BEGIN IMMEDIATE` 写事务导致的锁争用；
   - 为只读连接补齐 `2500ms` `busy_timeout`，并在 `mark_external_gap` 遇到已有库锁繁忙错误时安全中止而非误插 `NULL` 登出断层。
2. **Claude Ultra 无 5h 上限、7d 免费重置归零、专项周池与离线重登预警**（`scripts/claude_quota.py`、`claude_quota_online.py`、`quota_archive.py`、`browser-runtime/quota-bridge/*`、`src-tauri/src/browser/quota_bridge.rs`、`identities/profile.rs`）：
   - 支持 Ultra 账号 `"five_hour": null` 网页快照导入与额度评估；
   - 将 `resets_at: null` 且 `0.0` 的归零逻辑扩展至 `seven_day`，解决周重置卡后旧满额残留；
   - 解析 `limits[]`（`weekly_scoped` 如 `Fable`）与 `7d_oi` 响应头，支持专项周池回退与详情展示；
   - 提取 `/api/oauth/profile` 非敏感订阅层级（区分 `Ultra` / `Team Premium` / `Enterprise` / `Lapsed`），唤醒探针首选 `claude-haiku-5-5`；离线提取 `.credentials.json` 的 `refreshTokenExpiresAt` 提供 7 天内重登预警；流式读取超大 JSONL 会话并消除 `quota_ledger.json` 单次读取中的重复解析。
3. **用量分析 `v2.1.322` 字典 `effort` 回填、多账号精准计费、I/O 减负与高清截图修复**（`src-tauri/src/identities/usage.rs`、`src/usage-*`）：
   - `usage.rs` 支持解包字典格式 `effort`（`{"level": "high"}` 及 `/output_config/effort`），升级 `USAGE_PARSER_VERSION = 3` 自动无损回填历史会话思考深度；
   - `scan_dir` 在文件 `size` 与 `mtime` 未变时跳过 8 KiB SHA-256 头部读取，归属汇总改用 SQL `GROUP BY` 索引聚合，闲置磁盘读取降低 99%+；
   - 为每个 `UsageAccount` 附带各自真实的 `models` 分布，修复「全部账号」表格与 TSV 中所有账号按全局第一模型（如 `Fable`）单价高估 4～80 倍的失真；区分 `Mythos` 与 `Fable` 徽章标签及 `mythos-preview` / `speed` 倍率；
   - 修复 `usage-screenshot.ts` 小时级峰值切片 `.slice(-5)` 把时区偏移 `"-05:00"` 当作时间 `"05:00"` 的 Bug、长标题与筛选元信息重叠问题，以及截图与页面峰值/均值美元口径微小偏差；修复数据视图 3 列网格顶部模型 Effort 浮层向上遮挡标题的问题。

### Track 3：身份卡片、智能接力、悬浮窗、双语文案、深色/毛玻璃视觉与前端并发精修
1. **修复前端状态串扰与文案/路由缺陷**（`src/identities.tsx`、`identity-connections.tsx`、`main.tsx`）：
   - `persistedWakeupAnchorMap` 改按不可变 `fingerprint` 索引，杜绝切号后唤醒徽章串到新账号；
   - 修复批量取消按钮直接读取 `ref.current` 不触发重绘、连接修复弹窗重复渲染路由提示、净室审计时间线显示原始键名 `'wakeup.toggleOn'`、CLI 交接卡硬编码美西地区，以及 `Ctrl+K` 打开「任务交接模板」无响应的问题（挂载至 `Root` 受控弹窗，保持 `Help` 静态文档契约）。
2. **前端 IPC 风暴治理与后台零空转**（`src/floating-monitor.tsx`、`floating-monitor-model.ts`、`identities.tsx`、`warming-cards.tsx`）：
   - 去重待命提示广播并复用单例 `BroadcastChannel`；悬浮窗仅在账本更新或切号消息时拉取原生遥测，纯界面偏好/待命变更零 IPC；
   - 在线批量查询期间合并节流 `read(false)` 并去重轮询快照；主窗口隐藏时暂停倒计时脉冲并对齐分钟边界；
   - 提取共用横向滚轮弹簧滚动 Hook 同步赋能「养号」卡片栏；补齐键盘无障碍焦点触发与「恢复默认卡片顺序」入口。
3. **深色/毛玻璃对比度统一、微交互反馈与双语词条精修**（`src/style.css`、`identity-productivity.css`、`productivity-shell.css`、`smart-relay-model.ts`、`locales/zh.yaml`、`locales/en.yaml`）：
   - 将全部硬编码浅色警告/恢复/会话框与深色不可见运行圆点升级为 `color-mix()` 语义自适应样式，修复 `:root[data-reduce-motion="true"]` 选择器并将激活卡呼吸光环改为零重绘合成层表现；
   - 本地同步与刷新引入 `550ms` 最小旋转感知与 `✓` 完成确认态，「网页同步额度与重置」增加单账号级加载指示（绝不在 `.identity-card` 渲染 `.identity-card-status`）；
   - 智能接力接入 `SoonReset (24h)` 临期周额度收割加分、账号池真实均值余量与 `formatQuotaPercent` 诚实百分比，重置卡增加到期紧迫度着色；
   - 清理全部散落的内联 `locale === 'en'` 硬编码文案，统一 HUD 与卡片步速正负号表达（消除 `"余量 -12%"` 双重否定），精简批量完成零值播报，修正过期按钮引用与中英排版细节，并对齐 3 处遗留 `180px` 测试断言至 `166×286` 现行工牌规格。

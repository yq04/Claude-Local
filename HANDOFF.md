<!--
[INPUT]: Final owner decisions, immutable v0.3.2 baseline (260f80e / tag v0.3.2, verified at a72a145), 2026-11-12~11-14 v0.3.3 release increments (2.7 CLI proxy/risk-verification UI hardening, 2.9 4-track root-cause fixes, 2.10 workstation Magpie/Mode-A-B/port-healing notes, and 2.11 Usage Analytics KPI/model/poster alignment + v0.3.3 version bump, audited NSIS build, and local 0.3.3 atomic hot-update).
[OUTPUT]: Context-free session handoff covering: (1) what task we are doing, (2) what is completed, (3) where we are stuck, (4) next-step plan, and (5) pitfalls never to repeat.
[POS]: Root maintenance handoff for a zero-context successor session. Real identities, emails, IP/proxy credentials, process IDs, browser seeds, private probe values, workstation paths and screenshots stay out of tracked files.
[PROTOCOL]: Updated on 2026-11-14 EST; workstation-specific CLI/proxy/Magpie/binary tooling handoff is kept strictly in the gitignored .local/tasks/20261112-session-handoff/HANDOFF.local.md file.
-->
# Claude-Local 会话交接（HANDOFF.md）

更新时间：2026-11-14 00:22，America/New_York（EST）。

## 接手先读：30 秒全局速览

1. **当前版本与 Git 基线**：正在完成 **`v0.3.3`** 正式补丁版本发布闭环（基线为不可变的 `v0.3.2` 提交 `260f80e` / `a72a145`），已同步全部版本元数据、[`docs/RELEASE_NOTES_0.3.3.md`](docs/RELEASE_NOTES_0.3.3.md)、[`README.md`](README.md)、[`README_EN.md`](README_EN.md)、[`docs/RELEASE_POLICY.md`](docs/RELEASE_POLICY.md) 与 [`.github/ISSUE_TEMPLATE/bug_report.yml`](.github/ISSUE_TEMPLATE/bug_report.yml)。
2. **当前工作区与本机安装状态（`v0.3.3` 全量验证、NSIS 打包与本机原子热更新已生效）**：
   - **2.7 节（2026-11-12 晚）**：完成了 **CLI 代理/遥测安全边界统一判定与防断流界面提示增强**；
   - **2.8 节（2026-11-13 晨）**：完成了仓库只读全栈审计，并打通了外置 **Magpie 网关 + Claude Code CLI Gemini 子代理多账号多模型无碰撞并发调度**；
   - **2.9 节（2026-11-13 晚）**：并行完成四条实战改进（CLI 句柄级存活核验与分级徽章、瞬态锁退避自愈 + 未保存切号零残留自动回滚 + 一键干净恢复、用量分析 `单会话均耗` / `单次均耗` KPI 升级，以及外置子代理 `-Resume` / `[AGY-EXECUTION-TRACE]`）；
   - **2.10 节（2026-11-13 深夜）**：完成外置 Magpie 插件审计、9 席三池嵌套溢出路由、`claude.exe v2.1.325.0` 混合编排与 Clash Verge Rev 启动自更新端口自愈；
   - **2.11 节（2026-11-14，本轮新增）**：完成 **用量分析顶栏 KPI 对齐、模型分布 2×2 等高排版 + 等宽占比列与 2× Retina 分享海报排版精修**（[`src/usage-statistics.tsx`](src/usage-statistics.tsx)、[`src/usage-statistics.css`](src/usage-statistics.css)、[`src/usage-screenshot.ts`](src/usage-screenshot.ts)、[`src/locales/zh.yaml`](src/locales/zh.yaml)、[`src/locales/en.yaml`](src/locales/en.yaml)、[`src/CLAUDE.md`](src/CLAUDE.md)），完成 **`0.3.3` 升版**、全套回归验证（`bun test` 195 pass、`cargo test --release --features custom-protocol` 332 passed / 2 ignored、Python 8 套 114/114、Playwright 全套件）、中性目录 NSIS 打包审计（109 文件 0 发现，`Claude-Local_0.3.3_x64-setup.exe` SHA-256 `4af97dc04a099f41b27ca4821af246bbfca1424838aeb54465bd2fa3e7f184d4`）以及 **本机原子热更新至 `0.3.3`**（`hostSha256` `1f65697954a866f088f440451e8a288885ccc68500e54a1b578930d3cc83ae7b`，27 文件对账一致，交互桌面已重拉，`missingClaudeCount == 0`）。
   - 工作区另保留既有未暂存 `AGENTS.md`（**严禁暂存或提交**）。
   - 若同时需要接手本机工作站外置 CLI / Magpie / 子代理工具链状态，请另行阅读 Git 忽略文件 `.local/tasks/20261112-session-handoff/HANDOFF.local.md`。
3. **零上下文新会话必读顺序**：
   - 第 1 步：阅读本文、根目录 `AGENTS.md`（本地规则文件，**严禁 `git add` / `commit`**）与 [`CLAUDE.md`](CLAUDE.md)；
   - 第 2 步：若需确认 `v0.3.2` 已发布基线详情，阅读 [`docs/RELEASE_VERIFICATION_0.3.2.md`](docs/RELEASE_VERIFICATION_0.3.2.md) 与 [`docs/plans/2026-11-10-v0.3.2-polish-and-hardening/00-README.md`](docs/plans/2026-11-10-v0.3.2-polish-and-hardening/00-README.md)；
   - 第 3 步：若需继续修改代码，先读对应目录的 `CLAUDE.md`（[`src/CLAUDE.md`](src/CLAUDE.md)、[`src-tauri/CLAUDE.md`](src-tauri/CLAUDE.md)、[`src-tauri/src/identities/CLAUDE.md`](src-tauri/src/identities/CLAUDE.md)、[`src-tauri/src/browser/CLAUDE.md`](src-tauri/src/browser/CLAUDE.md)、[`src/locales/CLAUDE.md`](src/locales/CLAUDE.md)、[`scripts/CLAUDE.md`](scripts/CLAUDE.md)）及目标文件头部的 `[INPUT]/[OUTPUT]/[POS]` 注释；
   - 第 4 步：若需接手本机工作站外置 CLI 工具链状态，再读 `.local/tasks/20261112-session-handoff/HANDOFF.local.md`。

---

## 1. 我们在做什么任务

### 1.1 产品定位与不可逾越的边界
- **独立产品身份**：`Claude-Local` 是本仓库独立拥有并维护的 Windows 10/11 x64 多账号防关联工作台（主程序 `claude-local.exe`，Bundle ID `ai.local.claude-local`，伴生指纹浏览器注册名 `Claude-Local-Browser`）。严禁添加任何外部上游 remote、自动上游同步或官方自动更新源。
- **运行目录隔离**：
  - 用户配置、加密身份保险箱（`.baga` 归档 + `identities.sqlite`）与伴生浏览器槽位位于 `%APPDATA%\ai.local.claude-local`；
  - 桌面端默认安装位于 `%LOCALAPPDATA%\Programs\Claude-Local`；
  - Claude Code CLI 的 `statusLine` 被动采集脚本位于 `~/.local/bin/claude_quota.py`（同目录依赖 `~/.local/bin/quota_archive.py`）；
  - 技术栈：**Tauri 2 (Rust)** + **React 19 / TypeScript / Tailwind 4 / Cromma UI** + **Python 3 单写者跨进程锁额度账本采集器**。

### 1.2 本阶段核心目标（`v0.3.2` 已发布基线 + 发布后防风控打磨）
- **已交付主线（`v0.3.2`，已提交并发布）**：围绕五大核心域（身份卡片管理、账号隔离、风险规避、额度查询、用量分析）完成了开源对标、重构加固、卡顿性能优化、主动重置次数三态修复、额度详情弹窗重设计以及 GitHub Release `v0.3.2`（`Claude-Local_0.3.2_x64-setup.exe`）打包发布（详见 [`docs/RELEASE_VERIFICATION_0.3.2.md`](docs/RELEASE_VERIFICATION_0.3.2.md)）。
- **本轮增量任务（2026-11-12 晚 ~ 2026-11-13 深夜，基于 `a72a145`）**：
  1. 针对用户分享的 X 平台 Claude 防封实操帖与长文进行逐项核对，甄别真伪（保留「CLI 显式固定本地 HTTP 代理防休眠/切 Wi-Fi TUN 掉线直连」「不轻信 TUN 已连接状态而应核对真实代理连接日志」「官方 Electron 桌面端显式代理边界」等有效工程实践；拒绝其「脏/机房 IP 无所谓」「移除显式代理环境」「推广虚拟卡与邀请码」等与风控原则冲突的做法）；
  2. 对照补齐 `Claude-Local` 风控验证页原先仅检查 `telemetry_shield_active` 而忽略 `proxy_env_complete` / `socks5_in_cli_env` 的显示缺口，并统一多面板安全边界纯函数判定；
  3. 对 `Claude-Local` 仓库进行全栈架构审查，并基于 Magpie 网关日志与 Claude Code CLI 运行记录定位 Gemini 子代理用量偏低与并发阻塞根因，改造外置多账号多模型并派配置与派发脚本；
  4. **2026-11-13 晚专项攻坚**：针对用户实测反馈的四类核心体验与可靠性痛点——（a）关闭 CLI 终端后身份页仍残留已退出 PID 且活跃卡片误显“运行中”、（b）未保存当前身份切换偶发锁冲突时生成多余“当前身份 / 恢复前状态”卡片且需手动删除重切、（c）用量分析页“缓存节省”指标对订阅制用户缺乏行动指导意义、（d）外置子代理一次性单轮调用无法追问且返回摘要缺少工具/命令级可观测轨迹——对标开源最佳实践完成全栈根治并重编嵌入式 Release 主程序完成本机原子热更新；
  5. **2026-11-13 深夜多模型协同与基础设施加固**：审计外置 Magpie 网关 Antigravity 插件体系的真实工程价值，激活已完成周重置的多席位高阶配额并构建三池正交分流与嵌套溢出路由；核验 X 平台关于 Claude Code `v2.1.325.0`、`/advisor` 与对抗审阅的最新实践并重构 6-Tier 混合子代理编排；同时根治系统重启更新 Clash Verge Rev 引发的规则代理端口漂移与后台守护进程 Windows Job-Object 连坐回收隐患。

---

## 2. 已经完成了什么

### 2.1 开源标杆调研与全栈对抗审阅（已完成）
- 在 Git 忽略目录 `.local/research/v0.3.2-benchmark/` 与 `.local/research/v0.3.0-benchmark/` 下完成了对 **11 个同类标杆项目**（`CCBaga`、`Claude-Cage`、`claude-swap`、`ccswap` 双实现、`cc-switch`、`ccusage`、`magpie`、`orca`、`cockpit-tools`、`Antigravity-Manager`）的源码拆解与本仓全链路对抗审查；
- 输出了完整架构方案文档 [`docs/plans/2026-11-10-v0.3.2-polish-and-hardening/00-README.md`](docs/plans/2026-11-10-v0.3.2-polish-and-hardening/00-README.md)（及同目录 `CLAUDE.md`，已登记至根 [`CLAUDE.md`](CLAUDE.md)）；
- 将版本号统一升至 **`0.3.2`**（[`package.json`](package.json)、[`src-tauri/Cargo.toml`](src-tauri/Cargo.toml)、[`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json)、[`src-tauri/Cargo.lock`](src-tauri/Cargo.lock)、[`src-tauri/CLAUDE.md`](src-tauri/CLAUDE.md)）。

### 2.2 五大核心域与全局细节升级完成项（全部受跟踪与新增文件均保持纯 LF）

#### （1）账号隔离（Account Isolation）
- **跨号净室清洗闭环**（[`src-tauri/src/identities/store.rs`](src-tauri/src/identities/store.rs)、[`src-tauri/src/cleaner_identity.rs`](src-tauri/src/cleaner_identity.rs)、[`src-tauri/src/cleaner_config.rs`](src-tauri/src/cleaner_config.rs)、[`src-tauri/src/cleaner.rs`](src-tauri/src/cleaner.rs)）：
  - 修复 `Store::switch("empty")`（切至空白环境）与 `Store::delete("current")`（移除当前身份）此前绕过 `maintain_account_caches(None)` 导致 `.claude.json` 残留旧账号 `metricsStatusCacheByPrincipal` / `groveConfigCache` 条目的漏口；
  - 切号写入身份时同步刷新 `oauthAccount.profileFetchedAt = now_ms`，避免新身份首次启动因陈旧缓存时间戳触发异常重拉；
  - 在 `Some(acct)` 分支补齐 `.claude/cache/model-catalog` 与 `.claude/statsig` 清理；
  - 动态匹配清理 `(fable*|mythos*)*OrgPickMove*` 及 `claude.exe v2.1.322` 新增的 6 项订阅/模型缓存键，同时严格保留 `s13` 设备指纹键不动；
  - `clear_stale_locks` 增加 `mtime >= 10s` 竞态保护；代理敏感键与环境诊断统一纳入 `GRPC_PROXY`。
- **Windows 快照兼容**（[`src-tauri/src/identities/archive.rs`](src-tauri/src/identities/archive.rs)）：
  - 采集活跃身份快照时跳过 Windows 开发者模式自动生成的 `.claude/debug/latest` 瞬态重解析链接，根治 `reparse_snapshot` 误报错。

#### （2）风险规避与伴生浏览器加固（Risk Avoidance & Browser Hardening）
- **防泄漏自检与模板升级**（[`src-tauri/src/risk_check.rs`](src-tauri/src/risk_check.rs)、[`src/risk-model.ts`](src/risk-model.ts)、[`src/risk-verification.tsx`](src/risk-verification.tsx)、[`src/claude-residue-panel.tsx`](src/claude-residue-panel.tsx)）：
  - 从一键防泄漏 `settings.json` 模板中移除会阻断 GrowthBook 并导致 `/model` 丢失 `Fable 5.2` 的 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`，改为安全的 `DO_NOT_TRACK: "1"` + `DISABLE_TELEMETRY: "1"` + `DISABLE_ERROR_REPORTING: "1"`，并在检测到用户残留该变量时展示琥珀色告警徽章（`nonessential_traffic_blocked`）；
  - 合并检查 `settings.json` 与 `settings.local.json`，统一 Windows 大小写无关代理环境变量校验，并新增 `projects.*.mcpServers` 有界扫描。
- **Windows 原生反检测与零 `PROCESS_VM_READ`**（[`src-tauri/src/windows_process.rs`](src-tauri/src/windows_process.rs)）：
  - 改用 `PROCESS_QUERY_LIMITED_INFORMATION` 权限下的 `NtQueryInformationProcess(ProcessCommandLineInformation = 60)` 与 `GetFileInformationByHandle` 目录句柄比对，彻底消除对伴生 `chrome.exe` 的跨进程虚拟内存读取（`PROCESS_VM_READ`）。
- **伴生浏览器冷启动、多账号并行槽位落盘与多槽位 Kill-Switch**（[`src-tauri/src/identities/browser_link.rs`](src-tauri/src/identities/browser_link.rs)、[`src-tauri/src/browser/workspaces.rs`](src-tauri/src/browser/workspaces.rs)、[`src-tauri/src/browser/quota_connection.rs`](src-tauri/src/browser/quota_connection.rs)、[`src-tauri/src/browser/quota_existing.rs`](src-tauri/src/browser/quota_existing.rs)、[`src-tauri/src/browser/kill_switch.rs`](src-tauri/src/browser/kill_switch.rs)、[`src-tauri/src/browser/profile.rs`](src-tauri/src/browser/profile.rs)、[`src-tauri/src/browser/config.rs`](src-tauri/src/browser/config.rs)）：
  - 新增 `Database::ensure_identity_binding` 与 `workspaces::ensure_identity_slot` 按需幂等落盘机制：任意已保存卡片或当前活跃身份在显式打开 `claude.ai` / 官方用量页或发起网页同步时，均自动补齐专属 `(slot, seed)` 及 `contexts/<slot>/{config.json, seed.owner, profile/}`，支持**多账号隔离浏览器同时并排打开官方用量页与聊天页**（互不抢占 `browser.active`、互不关闭其他账号窗口，顶栏 `⋯` 菜单新增「多账号同时打开官方用量页」一键能力）；
  - 修复 `quota_existing` 冷启动拉起浏览器时缺少完整防指纹/WebRTC/QUIC 参数的短暂窗口；
  - 升级 `kill_switch` 并发守护 `legacy` + `contexts/*` 下所有运行中浏览器槽位；
  - `profile::write_json` 改为唯一临时文件 + `sync_all` + 原子 `rename`；代理配置支持显式 `:80` / `:443` 默认端口。

#### （3）额度查询与 SQLite 并发零争用（Quota Query & SQLite Concurrency）
- **网页同步额度与重置多账号并发修复**（[`src-tauri/src/browser/quota_bridge.rs`](src-tauri/src/browser/quota_bridge.rs)、[`src-tauri/src/browser/server.rs`](src-tauri/src/browser/server.rs)、[`src-tauri/src/browser/quota_existing.rs`](src-tauri/src/browser/quota_existing.rs)、[`src/identities.tsx`](src/identities.tsx)）：
  - 根治已保存卡片与当前活跃卡片点击「网页同步额度与重置」（`identities_sync_subscription`）必报 `quotaOnline.accountMismatch` 的缺陷（原 `server.rs` 误取活跃 CLI 的 `32-hex` 身份 ID 与目标卡片 ID 或 `"current"` 比对，且共用单一全局 `Browser.session` 票据）；
  - 改为按目标卡片精确解析 `(collector_account_id, expected_fingerprint)`（`target_browser_binding` + `verify_ticket_binding`），每次网页同步独占临时 `127.0.0.1:0` 回环监听端口（`receive_subscription_sync`）并支持最多 16 个并发票据与前端按账号独立 `syncingAccountIds` 并发同步，不再锁死弹窗或打断其他账号浏览器。
- **Ultra 无 5h 上限、专项周池与离线凭证寿命**（[`src-tauri/src/browser/quota_bridge.rs`](src-tauri/src/browser/quota_bridge.rs)、[`browser-runtime/quota-bridge/content.js`](browser-runtime/quota-bridge/content.js)、[`src-tauri/src/identities/online.rs`](src-tauri/src/identities/online.rs)、[`src-tauri/src/identities/profile.rs`](src-tauri/src/identities/profile.rs)、[`scripts/claude_quota.py`](scripts/claude_quota.py)、[`scripts/claude_quota_online.py`](scripts/claude_quota_online.py)、[`scripts/quota_archive.py`](scripts/quota_archive.py)）：
  - 全链路支持 Claude Ultra 的 `"five_hour": null`（`quota_no_5h_limit`，卡片与悬浮小窗显示「无上限 / No limit」，CLI 输出 `unlimited`，且纳入智能接力候选池）及 `seven_day` `0% + resets_at: null` 归零推断；
  - 解析并保留 `weekly_scoped`（`seven_day_sonnet` / `seven_day_opus` / `seven_day_fable`）专项周池与 `Ultra` / `Team` / `Enterprise` 订阅层级；
  - 在线 1-token 唤醒首选模型升级为 `claude-haiku-5-5`（含自动回退链），`DEFAULT_CLI_VERSION` 对齐 `2.1.322`；
  - 离线提取 OAuth `refreshTokenExpiresAt`（`quota_cache.json` 升至 `v: 5` 并改为原子替换落盘），在本地提前预警凭证过期；`quota_archive.py` 补齐 `GRPC_PROXY`。
- **SQLite 锁争用消除与 I/O 减负**（[`src-tauri/src/identities/database.rs`](src-tauri/src/identities/database.rs)、[`src-tauri/src/identities/usage.rs`](src-tauri/src/identities/usage.rs)）：
  - `Database::open` 在检测到 `user_version == 3` 且 `browser.draft` 已就绪时直接走零写事务快速路径（保留 `PRAGMA synchronous=FULL`）；
  - 只读连接增加 `busy_timeout(2500ms)`；`mark_external_gap` 遇到瞬态锁繁忙直接安全返回，不再误把锁冲突写成 `NULL` 未归因缺口；
  - 消除 `state_for` 重复读取 `quota_ledger.json`，并将 `.jsonl` 扫描改为有界流式读取。

#### （4）用量分析 2.2（Usage Analytics 2.2）
- **`v2.1.322` Effort 解包与按账号真实模型计费**（[`src-tauri/src/identities/usage.rs`](src-tauri/src/identities/usage.rs)、[`src/usage-model.ts`](src/usage-model.ts)、[`src/usage-statistics.tsx`](src/usage-statistics.tsx)、[`src/usage-export.ts`](src/usage-export.ts)、[`src/usage-screenshot.ts`](src/usage-screenshot.ts)）：
  - 兼容解包 `claude.exe v2.1.322` 字典形态 `effort` / `output_config.effort`，将 `USAGE_PARSER_VERSION` 从 `2` 升至 `3` 自动回填历史分档；
  - 增量扫描先执行零文件打开的 `(mtime_ns, size)` 内存游标比对（空闲重扫磁盘句柄打开次数降低 >99%），并利用 `events_account` 索引加速聚合；
  - 为每个账号独立输出 `models: Vec<UsageModel>`，使账号表与 TSV 导出按各账号实际使用的模型单价精确计费（消除全局平均单价误差）；补齐 `claude-mythos-preview`（`$25/$125`）与 `usage.speed: "fast"` 倍率；
  - 修复 PNG 长图导出在小时粒度下 `.slice(-5)` 误截时区偏移的 Bug、顶栏 `scopeMeta` 重叠、KPI 卡片成本口径差异及数据视图 Effort 浮层遮挡。

#### （5）身份卡片、智能接力、悬浮 HUD、排版样式与低负载优化
- **交互与状态准确性**（[`src/identities.tsx`](src/identities.tsx)、[`src/warming-cards.tsx`](src/warming-cards.tsx)、[`src/card-order.ts`](src/card-order.ts)、[`src/smart-relay-model.ts`](src/smart-relay-model.ts)、[`src/floating-monitor.tsx`](src/floating-monitor.tsx)、[`src/main.tsx`](src/main.tsx)）：
  - 修复 `persistedWakeupAnchorMap` 跨号串染（改按 64 位 `fingerprint` 隔离）、HUD 额度过期时回退旧百分比、`Ctrl+K` 任务交接弹窗未挂载、CLI 交接区域硬编码美区、批量取消 `batchCanceling` 状态与单卡同步旋转反馈；
  - 身份轨与养号轨共享平滑横向滚轮转换，支持「恢复默认卡片顺序」，本地同步按钮提供 `550ms` 旋转 + `✓` 触感确认，重置卡徽章支持紧迫度分级，智能接力新增 24h 临近周重置加权（`SoonReset`）与真实 `avg5hRemainingPct`。
- **文案、视觉与前后端降载**（[`src/locales/zh.yaml`](src/locales/zh.yaml)、[`src/locales/en.yaml`](src/locales/en.yaml)、[`src/style.css`](src/style.css)、[`src/identity-productivity.css`](src/identity-productivity.css)、[`src/productivity-shell.css`](src/productivity-shell.css)）：
  - 修复 `wakeup.toggleOn` 裸键、`risk.feedback.copied` 漏翻键与 `routeHelp` 重复句，中英双语键与插槽 100% 对齐；
  - 消除 HUD 在本地偏好/主题广播时误触发 `monitor_live_telemetry` 的 IPC 风暴，合并批量同步期间的 `identities_read` 请求，窗口最小化/隐藏时降频计时器并注入 `data-window-hidden="true"` 暂停 CSS 无限动画；
  - 移除活跃卡片 60fps `box-shadow` 动画改为零重绘立体环，修复 `:root[data-reduce-motion="true"]` 属性选择器，并用 `color-mix()` 优化暗色与毛玻璃表面对比度。

### 2.3 全套自动化验收记录（全部通过）
- `bun test`：**192 pass, 0 fail**（26 个测试文件，14,497 项断言，含双语词条完整性校验）。
- `bun run build`（`tsc --noEmit && vite build`）：**0 错误通过**（`dist/` 双入口已构建）。
- `cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local`：**326 passed, 0 failed, 2 ignored**（Release 测试必须带 `--features custom-protocol`，否则 `compile_error!`；ignored 含 `usage_perf` 合成基准）。
- `cargo build --release --features custom-protocol --manifest-path src-tauri/Cargo.toml`：**0 错误通过**（`src-tauri/target/release/claude-local.exe` 版本 `0.3.2`，在 `dist/` 构建完成后编译，内嵌资源 100% 同步）。
- Python 合成回归套件：**95 / 95 全部通过**（`test-claude-quota-local.py` 38 项、`test-claude-quota-online.py` 39 项、`test-quota-archive.py` 7 项、`test-runtime-resources.py` 2 项、`test-audit-windows-package.py` 9 项）。
- Playwright 合成 GUI 与 MV3 桥接套件：**全部通过**
  - `node --experimental-strip-types scripts/test-identities-ui.ts --cards-only`（28 项）
  - `node --experimental-strip-types scripts/test-identities-ui.ts --warming-only`（29 项）
  - `node --experimental-strip-types scripts/test-identities-ui.ts --online-only`（10 项）
  - `node scripts/test-local-shell.mjs .local/preview/v0.3.2-monitor --monitor-only`（中英 × 浅深 × 展开/紧凑/贴边胶囊 12 模态 + 未确认账号态，`outside: []`, `clipped: []`）
  - `node scripts/test-usage-statistics.mjs .local/preview/v0.3.2-usage --usage-reliability-only`（11 项功能 + 8 组响应式布局）
  - `node scripts/test-quota-browser-bridge.mjs` 与 `node scripts/test-quota-integration.mjs`（MV3 配对去重、快照过滤、Worker 重启与指纹校验通过）

### 2.4 本机无感热更新状态（已完成）
- 通过忽略脚本 `.local/tasks/20261110-hotupdate-0.3.2/hotupdate-0.3.2.ps1` 完成原子热更新，原安装文件备份于 `.local/tasks/20261110-hotupdate-0.3.2/backups/`，回执位于 `.local/tasks/20261110-hotupdate-0.3.2/deployment-receipt.json`（性能优化前的回执另存为同目录 `deployment-receipt.pre-perf.json`）：
  - `%LOCALAPPDATA%\Programs\Claude-Local\claude-local.exe`：版本 **`0.3.2`**（含 2.5 性能优化、2.6 重置次数与额度详情弹窗重设计），SHA-256 `187d357ce1b5e26a1f7444f89b7bed609a2b2f69627beaeb13228517f60396d4`（已通过 `--quota-core` 管道自检并在交互桌面拉起）；
  - `%LOCALAPPDATA%\Programs\Claude-Local\browser-ui/*` 与 7 个 `runtime-resources.json` 运行时文件：全部完成 SHA-256 对账（共校验 27 个目标文件）；
  - `~/.local/bin/claude_quota.py`（SHA-256 `44a3d106abf793a01bd43a276501baa629880da3f9d087209d81a947a0076f5a`）与 `~/.local/bin/quota_archive.py`（SHA-256 `7c87f01bd94c389fe305d39018862a070a28a983720d0a042c0927b71cea7547`）：已同步更新；
  - `missingClaudeCount = 0`（零中断 CLI 与伴生浏览器）。

### 2.5 额度/用量卡顿专项优化（2026-11-11，已并入 v0.3.2 并热更新）
- **根因（只读诊断真实账本游标确认）**：含无效/超长(>2MiB)终止行的会话日志此前永不缓存游标，11 个文件（约 359 MB）在每次用量读取与每个 HUD 采集周期（约 5s）被整文件重解析，并长时间持有 `USAGE_LOCK`，连带阻塞身份页读取。修复后真实环境 546/546 个日志（2.66 GB）全部走零读取快路径。
- **后端**（[`usage.rs`](src-tauri/src/identities/usage.rs)、[`usage_attribution.rs`](src-tauri/src/identities/usage_attribution.rs)、[`online.rs`](src-tauri/src/identities/online.rs)、[`mod.rs`](src-tauri/src/identities/mod.rs)、[`quota_setup.rs`](src-tauri/src/quota_setup.rs)）：损坏游标缓存（`files.damaged` 列重放 `invalid_records`）；未变文件跳过逐文件 SID 查询；空扫描零持久写（`last_scan` 进程内记忆、≤60s 落盘）；`usage_identities` 变更门控 UPSERT；账本 schema/DACL 每进程一次（旧版 fallback 冻结仍每次执行）；HUD 只增量采集不全量聚合；聚合 15 分钟时隙记忆本地日 + O(1) 账号映射；账本/目录/live HMAC/查询/分钟不变时复用进程内快照；身份读取对用量锁 `try_lock`；同一组待修复归档每进程只 `Store::open` 一次；`identities_quota_revision` 改异步并按内容/语义哈希（剔除 `.claude.json` 高频簿记键）；`quota_setup_status` 改异步。
- **前端**（[`usage-statistics.tsx`](src/usage-statistics.tsx)、[`identities.tsx`](src/identities.tsx)）：用量页按查询键会话缓存快照（切回/重进即时绘制、后台重验）；身份页原生快照内容不变时不 `setState`，避免整页重渲染。
- **合成基准**（[`usage_perf_tests.rs`](src-tauri/src/identities/usage_perf_tests.rs)，`#[ignore]`，560 文件/12 万事件/含损坏行）：未变树扫描 1400→21–30 ms（损坏文件不再重解析）、HUD 采集 86→26–34 ms、空提交 11–17→0.1 ms、同查询重复读取 220→30 ms。
- **顺带修复**：`browser/server.rs` 测试仍构造已移除的 `Session.port` 字段导致 `cargo test` 无法编译；`scripts/test-usage-statistics.mjs` 完整模式的模型行顺序断言对齐家族优先级排序。完整模式在第 523 行仍有一个**与本次无关的既有样式断言**（身份卡额度字号期望 12px 实际 11px），HANDOFF 原验收仅使用 `--usage-reliability-only`（11 项 + 8 布局，已通过）。

### 2.6 重置次数“消失”修复与三态显示（2026-11-11，已并入 v0.3.2 并热更新）
- **现象与根因**：用户反馈“之前还有的重置次数现在没了”。只读核对 `quota_web_metadata.json`：3 个账号的网页同步已超过 24h，`manual_resets_valid_until` 被设计为 `min(真实 grant ends_at, 观测+24h)`，到点后卡片按旧逻辑**整行隐藏**，与性能优化无关（文件 02:51 后未变，消失时间约 20:00 早于 20:53 热更新）。
- **修复**：[`quota_bridge.rs`](src-tauri/src/browser/quota_bridge.rs) 额外回传未截断的 `manual_resets_grant_ends_at`（仅正余额）；[`claude_quota_online.py`](scripts/claude_quota_online.py) 严格校验后随同次观测写入/替换/移除（[`claude_quota.py`](scripts/claude_quota.py) 摘要保留键同步）；[`online.rs`](src-tauri/src/identities/online.rs) `metadata_entry` 合理性过滤；前端 [`identity-online-quota.ts`](src/identity-online-quota.ts)：未知是否到期时**直接显示上次同步的次数**（按所有者要求不附加“待同步/24h”文案）；**真实到期已过** → `ended` 隐藏（详情显示“已到期”）。临期紧迫度只按真实到期计算（不再因 24h 截断误报“即将过期”）。
- **额度详情弹窗重设计**（点击卡片额度进度条打开）：参考 Antigravity-Manager 的卡片化详情风格，改为资料头 → 5h/7d 双窗口卡片（含来源圆点与观测时长）→ 7d 步调芯片条 → 事实列表（续期/重置次数/隔离状态/凭据提醒）→ 折叠说明 → 脚注；页脚次要操作居左、主按钮「网页同步额度与重置」居右。样式在 [`style.css`](src/style.css) `.quota-details-*`，修复了 `++41%` 双加号文案问题。
- **验证**：详见 [`docs/RELEASE_VERIFICATION_0.3.2.md`](docs/RELEASE_VERIFICATION_0.3.2.md)（`bun test` 193 pass / Rust 327 passed / Python 核心 85 通过 / Playwright 67 通过）。

### 2.7 本轮新增：CLI 安全边界统一判定与防断流界面完善（2026-11-12 晚，工作区未提交）
- **统一纯函数边界判定**（[`src/risk-model.ts`](src/risk-model.ts)）：新增并导出 `isCliSecurityShieldOk(cliSec)`（同时校验 `telemetry_shield_active && !nonessential_traffic_blocked && proxy_env_complete && !socks5_in_cli_env`）与 `isCliMcpBoundarySafe(cliSec)`，由 [`src/claude-residue-panel.tsx`](src/claude-residue-panel.tsx) 与 [`src/risk-verification.tsx`](src/risk-verification.tsx) 共同调用，消除两处界面布尔判定不一致。
- **修复风控页胶囊误判并显式标黄**（[`src/risk-verification.tsx`](src/risk-verification.tsx)）：
  - 原仅依据 `telemetry_shield_active` 点亮绿标，导致「开了遥测护盾但缺少显式 HTTP 代理（仅靠 TUN，休眠唤醒/切 Wi-Fi 易抖动直连）」或「误填 `socks5://`（触发 Bun Issue #71177）」时仍误显绿色 `shieldOk`；现改用 `isCliSecurityShieldOk(cliSec)`，未达标统一标 `.warn` 并附悬停提示 `risk.cliSecurity.shieldWarnHint`；
  - 新增显式告警胶囊 `data-risk-cli-proxy="socks5"` 与 `data-risk-cli-proxy="incomplete"`，直接给出缺项说明。
- **双语提示词与休眠/桌面端指引对齐**（[`src/locales/zh.yaml`](src/locales/zh.yaml)、[`src/locales/en.yaml`](src/locales/en.yaml)、[`src/CLAUDE.md`](src/CLAUDE.md)）：
  - 更新 `risk.audit.remediationHint` 与 `risk.audit.cliSettingsMergeHint`（补充：合盖休眠唤醒 / 切 Wi-Fi 重连后重新点击实测、在 Clash 连接日志确认实际命中线路、官方 Electron 桌面端默认不读取 CLI proxy env 如混用需显式附加 `--proxy-server` 参数）；
  - 双语同步新增 5 个键：`risk.cliSecurity.shieldWarnHint`、`risk.cliSecurity.proxyEnvIncompleteWarn`、`risk.cliSecurity.proxyEnvIncompleteHint`、`risk.cliSecurity.socks5Warn`、`risk.cliSecurity.socks5Hint`。
- **单测与验证状态（最后一次编辑后实测通过）**：
  - [`src/risk-model.test.ts`](src/risk-model.test.ts) 新增回归断言（覆盖全硬化、TUN-only 仅开遥测缺显式代理、`socks5://`、`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` 阻塞及 `null`/`undefined`）；
  - 修改后的 7 个文件均校验保持纯 LF（`CR=0`）；
  - 执行 `bun test`：**193 pass, 0 fail**（26 个测试文件，14,585 次 `expect()`，含 `i18n.test.ts` 双语键/插槽与 JSX 门禁）；
  - 执行 `bun run build`（`tsc --noEmit && vite build`）：**0 错误通过**（662 modules）；
  - **未执行项**：本次未修改 `src-tauri/*.rs` 与 `scripts/*.py`，尚未执行 `cargo test`、`cargo build --release --features custom-protocol`、本机热更新及 `bun run build:windows`。

### 2.8 本轮新增：`Claude-Local` 只读审计与外置 CLI/Magpie 多账号多模型子代理完善（2026-11-13 晨）
- **`Claude-Local` 仓库只读审计结论（其中第 5 项测试断言漂移与第 6 项 `node.exe`/`bun.exe` 查询已在 2.9 节顺带根治，其余待后续排期决定）**：
  1. [`src/claude-residue-panel.tsx`](src/claude-residue-panel.tsx) 已与 [`src/risk-verification.tsx`](src/risk-verification.tsx) 共用 `isCliSecurityShieldOk`，但遗漏了后者的 `socks5_in_cli_env` 与 `!proxy_env_complete` 具体原因提示胶囊（仅靠遥测标志亮黄时缺少细项说明）；
  2. [`src-tauri/src/browser/oauth_route.rs`](src-tauri/src/browser/oauth_route.rs) 的授权路由守卫排除了 `https://platform.claude.com/oauth/authorize`（且有显式反向单测），与早先设计文档存在规格漂移；
  3. CLI 安全边界审计逻辑同时存在于 [`src-tauri/src/risk_check.rs`](src-tauri/src/risk_check.rs) 与 [`src/risk-model.ts`](src/risk-model.ts)（运行时走 Rust、部分单测走 TS）；
  4. [`src/smart-relay-model.ts`](src/smart-relay-model.ts) 存在未使用的 `autoSwitchWhenIdle`、重复分支三元表达式与重复名称比较，且接力冷却状态仅存 WebView `localStorage`，未与 Rust [`identities/wakeup.rs`](src-tauri/src/identities/wakeup.rs) 打通；
  5. 文档/样式/测试漂移：[`src/style.css`](src/style.css) 已采用 `166px` 卡片宽，部分旧注释与 [`scripts/CLAUDE.md`](scripts/CLAUDE.md) 仍写 `180×286`；*（注：[`scripts/test-usage-statistics.mjs`](scripts/test-usage-statistics.mjs) 完整模式 `.identity-quota-reset` `12px` vs `11px` 样式断言已在 2.9 节修复并通过全套 38 项校验）*；
  6. *（已在 2.9 节根治）* [`src-tauri/src/windows_process.rs`](src-tauri/src/windows_process.rs) 识别 `node.exe` / `bun.exe` 启动参数现已优先调用 `PROCESS_QUERY_LIMITED_INFORMATION` 下的 `NtQueryInformationProcess(60)`，仅在极端失败时回退 PEB 读取，而原生 `claude.exe` 与伴生 `chrome.exe` 全程零 `PROCESS_VM_READ`。
- **外置 Magpie + Claude Code CLI 子代理链路诊断与完善（外置脚本/配置，仓库外独立验收通过）**：
  - **诊断结论**：子代理实际执行深度极高（历史 216 次正常退出中仅 1 次合成短烟测；`hydrogen-high` 平均每会话 32–43 轮、`95.5%` Prompt 缓存命中、Brain 中位数 122 步/65 次工具调用），并未偷懒。用量看似偏低且单号倾斜的原因在于：`gemini-4-hydrogen` 刚启用约 7.5h、外置默认配置仍偏向 `argon`、`xhigh` 原被设成单号直连绕过 Magpie、Magpie 本机版本无 `burstSpread` 且 `maxConcurrency` 未限制导致并发全挤到单个最早重置 Pro 账号（其余 5 个高余量 Pro 账号几乎闲置），同时 1 个 ToS-403 账号仍启用、3 个耗尽 Ultra 账号未设 95% 窗口上限，且客户端脚本与 28 份规则文件硬编码了 `MAX 3` 全局信号量。
  - **落地完善与验收**：在外置 Magpie 网关启用 `antigravity.maxConcurrency = 1` + `queueLimit: 0` + `queueWait: 0`，在 provider 与全部 `group/*` 显式统一 `routing: "pace"` + `affinity: "session"`，禁用 ToS-403 账号并给耗尽 Ultra 账号加 7d `95%` 窗口上限（重置后自动恢复）；外置派发器移除 3 槽硬限改为基于健康账号数动态伸缩的命名互斥槽数组（`Max(8, healthy * 2)` + 单独 `Max 2` 直连守卫 + `xhigh` 改走 Magpie 池优先 + 6h/30-40 保留清理保护 + PS 5.1/7 双 AST 校验）；同步更新 `~/.claude/` 及隔离工作区的 `CLAUDE.md` 与全部 26 份子代理定义。四路跨模型并发实测分散命中 5 个健康账号，单账号活跃并发 `<= 1` 且未碰触被隔离/封顶账号。具体工作站路径、备份清单与实测回执见 `.local/tasks/20261112-session-handoff/HANDOFF.local.md`。

### 2.9 本轮新增：四大实战痛点根治、开源标杆对齐、嵌入式 Release 重编与本机热更新生效（2026-11-13 晚，已部署验证）
- **痛点 1 — CLI 已退出进程残留显示与活跃卡片“运行中”误导（对标 `cc-switch` / `claude-swap` / `CCBaga` / `Antigravity-Manager`）**：
  - **根因定位**：（a）Windows 下关闭终端后若父进程（如 Windows Terminal / ConPTY）尚未释放子进程句柄，已退出的 `claude.exe` 仍会短暂出现在 `CreateToolhelp32Snapshot` 中，而原 `windows_process.rs` 未校验内核对象退出态；（b）`identities_quota_revision` 仅哈希账本与 `.claude.json` 语义字段，忽略进程启停，导致终端关闭后前端 `state.processes` 一直停留在旧快照，点击“切换”直接弹出旧缓存列表；（c）活跃身份卡无条件渲染“运行中”，即使 0 个 CLI 会话也让用户误以为进程未关。
  - **全栈修复**（[`src-tauri/src/windows_process.rs`](src-tauri/src/windows_process.rs)、[`src-tauri/src/identities/profile.rs`](src-tauri/src/identities/profile.rs)、[`src-tauri/src/identities/mod.rs`](src-tauri/src/identities/mod.rs)、[`src-tauri/src/monitor_window.rs`](src-tauri/src/monitor_window.rs)、[`src-tauri/src/main.rs`](src-tauri/src/main.rs)、[`src/identity-model.ts`](src/identity-model.ts)、[`src/identities.tsx`](src/identities.tsx)）：
    - `Handle::open_limited` 请求 `PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE`（无权限时回退 `PROCESS_QUERY_LIMITED_INFORMATION`），新增 `is_alive()`（`WaitForSingleObject(0) == WAIT_TIMEOUT`，回退 `GetExitCodeProcess == STILL_ACTIVE`），在 `claude_processes` / `kill_process` / `browser` / `browser_runtime` 中过滤已退出僵尸句柄并自动剔除 `CLAUDE_PROC_CACHE` 死 PID；`node.exe`/`bun.exe` 优先走 `NtQueryInformationProcess(60)`；
    - 新增单次 Toolhelp 扫描的亚毫秒 IPC `identities_live_sessions`（返回 `{ running, cli_running, processes, active_sessions }`），前端在**打开切换/采集/删除弹窗前、确认弹窗打开期间（2s 轮询）、窗口 `focus`/`visibilitychange`、以及 5s 空闲心跳分支**静默同步实时会话（保持 `identities_quota_revision` 零额外 I/O）；
    - 活跃卡片 `.identity-live-badge` 按真实态分级显示 **`CLI 运行中`（`CLI running`）/ `CLI 运行中 · N` / `桌面端运行`（`Desktop active`）/ `当前使用`（`Active`）**（悬停展示工作区与 PID），且无运行中进程时切换弹窗改用平和提示 `identitySafety.switchIdleHint`。
- **痛点 2 — 身份切换瞬态锁自愈、未保存当前身份失败零残留自动回滚与一键干净恢复（对标 `cc-switch` staging+rollback、`claude-swap` 备份校验与 `Claude-Cage` 锁管理）**：
  - **根因定位**：Windows 上刚退出的 `claude.exe` / WebView / 杀软可能短暂持有 `.claude.json` 或 `.claude/debug` 句柄触发 `ERROR_SHARING_VIOLATION (32)` / `ERROR_ACCESS_DENIED (5)`；同时原 `Store::switch` 在 `clear` 前就将未保存活跃账号插入 SQLite（名为 `"当前身份"` 并标记 `recovery`），一旦后续校验或清理报错，回滚后仍把临时 `"当前身份"` 卡片留在列表中，若点击横幅恢复还会再生成 `"恢复前状态"` 检查点卡片。
  - **三层自愈修复**（[`src-tauri/src/cleaner_io.rs`](src-tauri/src/cleaner_io.rs)、[`src-tauri/src/cleaner_targets.rs`](src-tauri/src/cleaner_targets.rs)、[`src-tauri/src/cleaner.rs`](src-tauri/src/cleaner.rs)、[`src-tauri/src/identities/private.rs`](src-tauri/src/identities/private.rs)、[`src-tauri/src/identities/archive.rs`](src-tauri/src/identities/archive.rs)、[`src-tauri/src/identities/database.rs`](src-tauri/src/identities/database.rs)、[`src-tauri/src/identities/browser_link.rs`](src-tauri/src/identities/browser_link.rs)、[`src-tauri/src/identities/store.rs`](src-tauri/src/identities/store.rs)、[`src-tauri/src/browser/workspaces.rs`](src-tauri/src/browser/workspaces.rs)、[`src-tauri/src/windows_process.rs`](src-tauri/src/windows_process.rs)）：
    - **预防与重试层**：`kill_process` 对已退出 PID 幂等返回 `Ok(())` 并同步 `wait_exited(1500ms)`（`open_terminate_limited` 零 `PROCESS_VM_READ`）；`wait_claude_workspace_handles_released(&root, 600ms)` 等待关键文件写共享锁释放；`cleaner::file_io` 与 `cleaner_io::atomic_write` 先释放文件句柄再对 `os error 5 / 32 / 33 / 145` 执行有界指数退避重试；`cleaner_targets::measure`（目录不哈希易受瞬态锁影响的父目录修改时间）与 `archive::walk_workspace` 统一跳过 `.claude/debug/latest` 及 `*.tmp.*` / `.oauth_refresh.lock*` / `.storage-write.lock` 等瞬态文件；
    - **单故障零残留自动回滚层**：`Database::snapshot_before_switch` + `abort_pending` 在 `Store::switch` 任一阶段失败时完整恢复切前工作区凭据/历史/账号缓存并核验 `live_key` HMAC，彻底清除本次临时创建的 `"当前身份"` 卡片与 `.baga` 归档（严保既有已保存卡片与养号晋升 `abort_promotion` 不变），伴生浏览器仅在 `was_running == true` 时重拉；
    - **崩溃后一键干净恢复层**：新增 `Store::recover_clean(&reporter)` 并接入 `.identity-recovery` 横幅一键 `recoverNow()`（无需再弹出检查点命名框、不衍生 `"恢复前状态"` 卡片，且若崩溃后用户登录了全新第 3 账号仍自动抢救保护）。
- **痛点 3 — 用量分析页“缓存节省”虚荣指标替换为高价值 `单会话均耗`（对标 `ccusage` session 视图、`opcode` 与 OpenTelemetry GenAI 规范）**：
  - **改造落地**（[`src/usage-model.ts`](src/usage-model.ts)、[`src/usage-statistics.tsx`](src/usage-statistics.tsx)、[`src/usage-screenshot.ts`](src/usage-screenshot.ts)、[`src/usage-export.ts`](src/usage-export.ts)，**Rust `usage.rs` 零改动、零新增磁盘/SQLite 开销**）：
    - 新增 `summarizeSessionEfficiency` 与 `formatTurnsPerSession`，将顶栏 KPI #2 替换为 **`单会话均耗`（`Avg. session cost`，副文案 `均 X 轮/会话 · 均 Y 输出`，悬停展示会话数、单会话均总 Token 及长会话 `/compact` 优化提示，兼容 0 用量 `$0.00` 与历史缺省会话 `'—'`）**；
    - 模型分布行右侧副标改为 `{requests} 次响应 · 命中 {rate}`，账号明细表末列及排序键由“缓存节省”改为 **`单次均耗`（`Avg. turn cost`）**，并同步更新 2× Retina Canvas 海报与 Markdown 摘要导出（TSV 导出保留 `cache_savings_usd` 列确保外部脚本兼容）。
- **痛点 4 — 外置子代理多轮 `-Resume` 会话延续、`[AGY-EXECUTION-TRACE]` 完整轨迹与 `-Status` 实时探针（仓库外落地）**：
  - 外置派发器新增 `-Resume <SessionId|Tag>` + `-SessionTag <Slug>`（默认锁定首轮模型/Effort 命中同一账号与约 95% Prompt 缓存，24h Brain/会话保留与缺失快速报错）、`>20KB` 超长 Prompt 自动落盘挂载、按轮次增量切片的 `[AGY-EXECUTION-TRACE]`（`Write-BoundedOutput` 仅裁剪正文中部而 100% 保留轨迹尾块，同时 `-OutputFile` 交付物剥离全部元数据保持纯 Markdown）以及 `-Status [-Watch]` 实时监控（详见 `.local/tasks/20261112-session-handoff/HANDOFF.local.md`）。
- **全量交叉验收与嵌入式 Release 构建回执（2026-11-13 晚全部通过）**：
  - `cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local`：**332 passed, 0 failed, 2 ignored**（新增 Windows 僵尸句柄存活单测、未保存切号失败零残留回滚单测、`recover_clean` 单测、瞬态锁指纹不变单测与共享锁排空重试单测全部通过，0 新增警告）；
  - `bun test`：**195 pass, 0 fail**（26 个测试文件，14,643 次 `expect()`，含双语键/插槽/错误码 AST 门禁）；
  - `bun run build` + `python scripts/browser_ui.py dist`：**0 错误通过**；
  - Python 离线合成套件（8 套全量）：**114 / 114 全部通过**（`test-claude-quota-local.py` 38、`test-claude-quota-online.py` 40、`test-quota-archive.py` 7、`test-runtime-resources.py` 2、`test-audit-windows-package.py` 9、`test-fetch-browser.py` 4、`test-quota-runtime.py` 3、`test-migrate-local-data.py` 11）；
  - Playwright 串行合成 GUI 套件：**全部通过**（`test-identities-ui.ts` 四模式共 68 项、`test-usage-statistics.mjs` 完整 38 组 + `--quick-only` 16 项、`test-local-shell.mjs --monitor-only` 12 模态）；
  - **嵌入式 Release 主程序构建与本机原子热更新验证**：`cargo build --release --features custom-protocol --manifest-path src-tauri/Cargo.toml` 产出 `src-tauri/target/release/claude-local.exe`（版本 `0.3.2`，`17,131,008` 字节，SHA-256 `8afacf384d771613e03983c4acbae961aafbe40e445e11a8730f85e3805f55f9`），通过 `--quota-core` 管道自检后，已由 `.local/tasks/20261113-hotupdate-post-0.3.2/hotupdate.ps1` 原子部署至 `%LOCALAPPDATA%\Programs\Claude-Local\`（备份存放在 `.local/tasks/20261113-hotupdate-post-0.3.2/backups/`，回执存放在 `.local/tasks/20261113-hotupdate-post-0.3.2/deployment-receipt.json`）：27 个目标文件（含 7 个变更的 `browser-ui/*` 与 `claude-local.exe`，以及 `~/.local/bin/{claude_quota.py,quota_archive.py}`）全部通过 SHA-256 对账，新桌面窗口已在交互会话成功重拉并持续存活，全程 `missingClaudeCount == 0`。

### 2.10 本轮新增：外置 Magpie 插件生态评估、9 席三池嵌套溢出路由、`/advisor` + `/devil-advocate` 6-Tier 混合编排与代理自愈（2026-11-13 深夜，外置工具链零中断生效）
- **Magpie Antigravity 插件生态源码核验结论**：
  - 逐项拆解网关内置 Go 引擎与社区插件后确认：原生内置 `antigravity` provider 已完整支持多席位 OAuth 池化、多窗口 `pace` 配额步调、`session` 会话亲和、6h 故障休眠、画图与联网搜索；社区替代鉴权插件（`@magpie-community/opencode-antigravity-auth`）会丢失画图端点与 6h 休眠保护并引入额外 Bun IPC 开销，`@magpie-community/agent-agy` 会覆盖双端 `settings.json` 破坏直连 OAuth 回退隔离，而任何将官方 `claude.exe` 桥接至第三方网关的插件均触犯双端封号红线（一律不安装/不启用）。
  - 启用网关原生内置 `imageGen` / `searcher` 路由，并在外置 Antigravity CLI 的 `mcp_config.json` 中通过 `serverUrl` 协议挂载本地回环 `magpie-web-search`（`web_search`、`web_fetch`）与 `magpie-image`（`generate_image`、`generate_video`、`generation_result`）MCP 工具（实测 JSON-RPC `initialize` 与 `tools/list` 均返回 `HTTP 200`；纯只读观测面板插件 `page-model-quota` / `page-usage-tree` / `page-usage-board` 保持可选）。
- **9 活跃席位三池正交分流与 `order -> pace` 嵌套跨池溢出热重载**：
  - 在 `LockFileEx` 文件锁保护下修复席位状态漂移：重新启用已完成 7d 周重置的 3 个 Google AI Ultra 席位并保持永久 ToS-403 席位隔离（仅隔离其 Antigravity 条目、保留其独立 Claude 条目），形成 **9 个活跃健康席位（6 Pro + 3 Ultra）**；
  - 将 `antigravity.maxConcurrency` 提升至 `2`（保留 `routing: "pace"`、`affinity: "session"`、`capCareful: true`、Ultra 席位 7d `95%` 上限及当前交互席位 5h `88%` 余量保护），对外暴露 10 个模型与 **16 个路由组**（`/v1/models` 实测暴露 26 项）：采用**外层 `routing: "order"` 包装内层 `routing: "pace"` 池组**的嵌套结构，实现 **`Carbon`（3 个 Ultra 席位优先消费闲置配额）-> `Hydrogen`** 与 **`Argon`（6 个 Pro 独立 7d 池、零消耗 Hydrogen 配额）-> `Hydrogen`** 的跨池无损自动溢出；同步升级外置派发器的 Pro/Ultra 分池槽位感知与 `flash-lite`、`flash-high`、`ag-opus-high`、`ag-sonnet-high` 完整 12 字段路由契约（PS 5.1 与 PS 7 双端 AST 零错误通过）。
- **X 平台前沿工作流核验、6-Tier `/advisor` 混合舰队与 `/devil-advocate` 对抗门禁落地**：
  - 核实本机 `claude.exe` 已是上游最新 **`v2.1.325.0`**（无需执行 `claude update`；二进制已原生内置 `claude-fable-5-2`、`/advisor` 与 `advisor_20260301` 服务端工具）；查明在防风控 `DISABLE_TELEMETRY=1` / `DO_NOT_TRACK=1` 下实验性 `/advisor` 与本地 GrowthBook 缓存默认被抑制的机制，定位零外发遥测离线解锁双环境变量（留待用户退出 CLI 后按场景 E 可选写入 `~/.claude/settings.json`）；
  - 原子更新双目录 `CLAUDE.md`（主 `~/.claude/CLAUDE.md` 尾部 `Fable 5.2` 工程协议保持字节级一致）、全部 **26 份 `agents/*.md`**（将 `argon-reviewer` 与 `argon-scout` 归位至独立 7d 池 `gemini-4-argon-high` 并在 `argon-reviewer` 内置强制 **Devil's Advocate 钢人反驳三步门禁**，将 13 个子代理收敛为 **6 个正交主力专家 + 7 个 `[Alias]` 兼容入口**）以及双目录斜杠命令 `/devil-advocate`、`/advisor-mode`，确立 **Mode A（默认 `Fable 5.2 Lead + /advisor off`）vs Mode B（可选 `Sonnet 5.5 + /advisor fable`，严守三门禁与 `Ctx < 150k` 未缓存读取护栏）**、**三池并发波次（`Argon-High + Carbon-High + Hydrogen-High/XHigh`）** 与 **`-SessionTag` / `-Resume` 默认多轮热缓存续接**。
- **Clash Verge Rev 启动自更新端口漂移动态自愈与 Windows Job-Object 脱钩守护**：
  - 定位系统重启后 Clash Verge Rev `v2.5.8 -> v2.5.10` 启动自更新时，旧服务托管的 `verge-mihomo` 在重装前数秒仍占用默认 `mixed-port` 导致新进程将当次会话 `clash-verge.yaml` 的 `mixed-port` 自动顺延的竞态根因；核实主 `~/.claude/settings.json` 与 `Claude-Local` 伴生浏览器均绑定在 `Script.js` 注入的独立 `listeners` 住宅家宽专口上，完全不受 `mixed-port` 顺延影响（**100% 免疫**）；
  - 在外置派发器与中继启动脚本部署动态规则代理端口探测与网关配置热同步（优先读取运行时 `clash-verge.yaml` `mixed-port` 并核验 `mihomo|clash` 进程归属，**硬性排除主 `Claude` 专属家宽口与本地网关口**，规则代理全灭时保持 fail-closed `exit 2`），并将后台守护拉起方式改为 WMI `Invoke-CimMethod -ClassName Win32_Process -MethodName Create` 脱离调用方 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 作业对象，跨独立会话验证持续存活（机器级细节见 `.local/tasks/20261112-session-handoff/HANDOFF.local.md`）。

---

### 2.11 本轮新增：用量分析 KPI / 模型分布 / 分享海报对齐与 `v0.3.3` 打包验证与热更新（2026-11-14）
- **用量分析对齐与模型分布 2×2 排版精修**（[`src/usage-statistics.tsx`](src/usage-statistics.tsx)、[`src/usage-statistics.css`](src/usage-statistics.css)、[`src/usage-screenshot.ts`](src/usage-screenshot.ts)、[`src/locales/zh.yaml`](src/locales/zh.yaml)、[`src/locales/en.yaml`](src/locales/en.yaml)、[`src/CLAUDE.md`](src/CLAUDE.md)）：
  - 统一 `.usage-summary` / `.usage-metric` 上缘基线对齐并采用 `.usage-metric-sub-item` 防换行原子片段，保证「API 等效花费」与「单会话均耗」数值与副文案视觉对齐；
  - 将 `.usage-model-caption` 重构为规整 `2×2` 等高微指标网格与右对齐等宽字体 `.usage-model-share` 列（附紧凑 `·` 汇总），并同步对齐 2× Retina Canvas 长图海报绘制。
- **全量回归验收（`0.3.3` 升版后运行）**：
  - `bun test`：**195 pass, 0 fail**（26 文件，14,728 次 `expect()`）；`bun run build`（662 modules）+ `python scripts/browser_ui.py dist` 通过；
  - `cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local`：**332 passed, 0 failed, 2 ignored**；
  - Python 离线合成套件 8 套全量：**114 / 114 通过**；
  - Playwright 串行合成套件：**全部通过**（`usage-reliability` 11 项 + 8 布局、`--quick-only` 16 项、完整 Usage 38 项、`--monitor-only` 12 模态、`--cards-only` 28、`--warming-only` 29、`--online-only` 10、`--quota-reset-only` 8）。
- **中性目录 NSIS 打包审计与本机 `0.3.3` 原子热更新**：
  - [`scripts/build-windows-share.ps1`](scripts/build-windows-share.ps1) 生成并通过 `privacy-audit.json`（109 文件、7 项外置工作站路径探针、0 发现），产出 `Claude-Local_0.3.3_x64-setup.exe`（`140,980,435` 字节，SHA-256 `4af97dc04a099f41b27ca4821af246bbfca1424838aeb54465bd2fa3e7f184d4`）；
  - 通过 `.local/tasks/20261113-hotupdate-post-0.3.2/hotupdate.ps1 -ExpectedVersion '0.3.3'` 完成本机原子热更新（27 文件 SHA-256 对账一致，`hostSha256` `1f65697954a866f088f440451e8a288885ccc68500e54a1b578930d3cc83ae7b`，重拉交互桌面，`missingClaudeCount == 0`）。

## 3. 当前卡在哪

**没有任何代码缺陷、测试失败或本机部署未同步项阻塞。** 当前处于 **`v0.3.3` 正式发布收尾** 阶段：

1. **本机桌面端与外置混合工具链均已无损生效并在线运行**：
   - `%LOCALAPPDATA%\Programs\Claude-Local\claude-local.exe` 与 `browser-ui/*` 已原子热更新至 **`0.3.3`** Release 构建（SHA-256 `1f65697954a866f088f440451e8a288885ccc68500e54a1b578930d3cc83ae7b`，交互桌面窗口已验证存活，`missingClaudeCount == 0`）；
   - 外置 9 席三池嵌套路由网关、回环 MCP、动态规则代理端口自愈、WMI Job-Object 守护以及 6-Tier 子代理舰队均已热加载就绪（详见 `.local/tasks/20261112-session-handoff/HANDOFF.local.md`）。
2. **工作区受跟踪改动清单（与本地未暂存 `AGENTS.md` 严格分离）**：
   - 仅显式暂存并提交经过隐私与 LF 核验的源码/版本/文档文件，**严禁暂存或提交 `AGENTS.md` 与 `.local/`**。
3. **可选后续动作**：
   - 用户可在退出所有活跃 `claude.exe` 会话后按下方 **场景 E** 可选写入 2 个零遥测 `/advisor` 环境变量以启用 Mode B；或按 **场景 C** 视需要清理 2.8 剩余的 4 项轻量代码整理点。

---

## 4. 下一步计划是什么（给零上下文新会话的执行手册）

### 场景 A：用户要求将当前已在本机热更新验收的 2.7 + 2.9 增量打成新补丁版本（如 `v0.3.3`）并正式发布
1. **切勿修改或移动已发布的 `v0.3.2` 标签与安装包**；按新版本升版本号（`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.lock`、`src-tauri/CLAUDE.md`、`src/locales/{zh,en}.yaml` 若涉及版本文案）。
2. 编写对应版本 `docs/RELEASE_NOTES_<ver>.md` 与验证文档，并在 [`CLAUDE.md`](CLAUDE.md) 登记。
3. 跑齐 `bun test`、`bun run build`、`cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local`、Python 合成套件与 Playwright 相关回归。
4. 源码文件清单核对与隐私/行尾预检：
   - 运行 `git status --short` 逐一核对文件，仅显式 `git add` 经审查的跟踪源码与文档：
     - **严禁暂存或提交 `AGENTS.md`**；
     - **严禁暂存或提交 `.local/`** 下的任何文件；
   - 确认所有待提交文本保持纯 LF（`0` CRLF）且零工作站绝对路径/个人身份/代理凭据泄露。
5. 调用 `bun run build:windows`（[`scripts/build-windows-share.ps1`](scripts/build-windows-share.ps1)）生成中性目录 NSIS 安装包并完成解包白名单与外置隐私探针审计，再执行新 commit / 新 tag / 发布上传（如同步热更新本机，传 `-ExpectedVersion '<ver>'` 给 `.local/tasks/20261113-hotupdate-post-0.3.2/hotupdate.ps1`）。

### 场景 B：用户在工作区继续新增改动后需要再次热更新本机桌面端
1. 按顺序执行 `bun test` -> `bun run build` -> `cargo test --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --bin claude-local` -> `cargo build --release --features custom-protocol --manifest-path src-tauri/Cargo.toml`（严禁中断任何运行中 `claude.exe`）；
2. 先用 `pwsh -NoProfile -File .local/tasks/20261113-hotupdate-post-0.3.2/hotupdate.ps1 -PlanOnly` 复核变更清单，获得允许后执行 `pwsh -NoProfile -File .local/tasks/20261113-hotupdate-post-0.3.2/hotupdate.ps1` 完成备份、原子替换、交互桌面重拉与 `missingClaudeCount == 0` 对账。

### 场景 C：用户要求顺带清理 2.8 剩余的 4 项轻量代码整理点
- 按需补齐 [`src/claude-residue-panel.tsx`](src/claude-residue-panel.tsx) 的 `socks5_in_cli_env` / `!proxy_env_complete` 细项提示胶囊、核对 [`src-tauri/src/browser/oauth_route.rs`](src-tauri/src/browser/oauth_route.rs) 的 `platform.claude.com` 守卫意图、清理 [`src/smart-relay-model.ts`](src/smart-relay-model.ts) 未使用字段及对齐剩余旧注释中的 `166×286` 引用后，再走场景 A 或 B 构建验收。

### 场景 D：用户继续处理工作站外置 CLI / Magpie / 子代理工具链
- 请先阅读 `.local/tasks/20261112-session-handoff/HANDOFF.local.md`，按其中记录的备份、嵌套溢出路由、Pro/Ultra 分池槽位、动态规则代理发现、`-Resume` 多轮机制与进程约束继续操作。

### 场景 E：用户在退出活跃 `claude.exe` 后希望安全解锁零遥测 Mode B `/advisor` 能力
1. 确认所有活跃 `claude.exe` 会话已由用户正常退出（严禁强杀；无需执行 `claude update`，`v2.1.325.0` 已原生内置 `claude-fable-5-2` 与 `/advisor`）；
2. 先备份主 `~/.claude/settings.json`，仅在其顶层 `"env"` 对象内追加以下 2 个键值（**保持既有 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`GRPC_PROXY` 显式住宅 HTTP 代理不变，保持 `DISABLE_TELEMETRY: "1"`、`DO_NOT_TRACK: "1"`、`DISABLE_ERROR_REPORTING: "1"` 不变，绝不添加 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`，且严禁写入任何外置 Relay 工作区的 `settings.json`**）：
   ```json
   "CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL": "1",
   "CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF": "1"
   ```
3. 以 `UTF-8 no-BOM` 保存后，可在 `Claude-Local`「风控验证」页确认 `isCliSecurityShieldOk` 仍保持绿色通过（零外发遥测）；
4. 日常默认保持 **Mode A**（`Fable 5.2` 主控 + `/advisor off`）；仅在上下文较短（`Ctx < 150k`）的纯串行编码实现会话中按需切换 `/model sonnet` + `/advisor fable`（可通过 `/advisor-mode` 查看三门禁细则），一旦 `Ctx >= 150k` 立即执行 `/advisor off`（或先 `/compact`）改用外置三池子代理，规避未缓存全量上下文读取成本。

---

## 5. 有哪些踩过的坑，绝对不要再踩

### 5.1 绝对安全与隐私红线
1. **严禁中断任何正在运行的 `claude.exe`（Claude Code CLI）或伴生 `chrome.exe` 进程**：
   - 无论是跑测试、构建还是本机部署热更新，都绝不能停止 `claude.exe`；热更新前、后必须快照比对 `(Id, StartTime)` 并断言 `missingClaudeCount == 0`。
2. **严禁把 `AGENTS.md` 或 `.local/` 暂存或提交进 Git，严禁写入本机隐私信息**：
   - `AGENTS.md` 含有本地工作区未提交变更，切勿 `git add .` 或 `git commit -a`（必须显式指定文件路径暂存）；
   - 严禁在任何受 Git 跟踪的文件中出现本机绝对工作区路径、真实或掩码邮箱前缀、账号 UUID、代理凭据、浏览器随机种子、备份随机 ID 或进程 PID；所有跟踪文本文件必须保持 `UTF-8 no-BOM` + 纯 LF（`\n`）行尾。
3. **严守已取消的功能边界**：
   - 单账号 `.bagapack` / `CLPACK01` 导出导入功能已于 2026-11-02 被所有者明确取消（见 [`CLAUDE.md`](CLAUDE.md) 第 26 行），任何时候都不要重新实现其四个阶段。
4. **保持持久化兼容格式不变**：
   - `BAGAID01` 魔数、`.baga` 加密归档结构、SQLite `user_version=3`、账号 HMAC 算法及历史遗留 `CCBaga` 浏览器种子域字符串属于持久化兼容层，严禁在优化或重构中改动。

5. **先查 `git log` / `git tag` 再判断当前发布状态，严禁重写已发布 tag**：
   - `v0.3.2` 已经过 `260f80e` + `a72a145` 提交并作为不可变资产发布，绝不要覆盖移动 `v0.3.2` tag。任何新会话接手时必须先执行 `git status --short && git log -n 3 --oneline` 核对当前基线，再决定后续版本策略。
6. **风控验证页严禁脱离 `isCliSecurityShieldOk` 单字段判绿，也严禁乱改用户既有本机代理**：
   - 检查 CLI 安全护盾时必须通过 `isCliSecurityShieldOk`（`telemetry_shield_active && !nonessential_traffic_blocked && proxy_env_complete && !socks5_in_cli_env`），仅检查 `telemetry_shield_active` 会遗漏 TUN-only 缺显式 HTTP 代理及 `socks5://` 误配；
   - 评估外部“防封攻略”时务必逐条对照现有代码核实——切勿盲从“改用普通/机房 IP 也可以”“删除代理 env 只靠系统 TUN”“填入虚拟卡/邀请码”等反向建议，也严禁擅自调试或覆盖用户本机既有的 `~/.claude/settings.json` 与桌面代理规则。
7. **受跟踪文档严禁出现工作站路径、PID 或私钥信息**：
   - `HANDOFF.md` 与所有 Git 受跟踪文件只能引用 `%APPDATA%` / `%LOCALAPPDATA%` / `~/.claude/` 等通用约定路径；所有涉及工作站私有路径、进程 PID、本机备份与补丁日志的交接信息一律写入 `.local/` 忽略目录。
8. **外置 Magpie 插件边界、嵌套 `order -> pace` 溢出路由、Clash 端口漂移隔离与 Windows 脚本/编码坑点（详见 `HANDOFF.local.md`）**：
   - **严禁安装替换内置引擎的 Magpie 社区鉴权/桥接插件**：`opencode-antigravity-auth` 缺失画图与 6h 休眠保护，`agent-agy` 覆盖双端 `settings.json` 破坏直连回退隔离，任何将官方 `claude.exe` 桥接至第三方网关的插件均属双端封号红线；Antigravity CLI 的 `mcp_config.json` 挂载远程 HTTP MCP 必须使用 `"serverUrl"` 键（写成 `"url"` 或 `"httpUrl"` 会被静默忽略）；
   - **跨池溢出组必须采用外层 `routing: "order"` 嵌套内层 `routing: "pace"` 子组**：Magpie `group.go` 中 `pools("pace") == true` 会将同组内不同模型打平混排，且 `group/*` 显式结构会覆盖 `provider` 的 `affinity`；必须让内层单模型池组显式携带 `routing: "pace"` + `affinity: "session"`，再由外层 `routing: "order"` 组按池优先级串联溢出；对周期耗尽的 Ultra 席位配置 `accountWindowCaps`（如 `95%`）以待周重置自动恢复，仅禁用永久 ToS-403 条目；
   - **Clash Verge Rev 自更新 `mixed-port` 顺延竞态与住宅家宽口绝对隔离**：Clash Verge Rev 启动自更新时旧服务进程短暂占用默认混合端口会令当次会话 `clash-verge.yaml` 的 `mixed-port` 自动顺延，而 `Script.js` 注入的独立 `listeners` 住宅家宽口天然免疫；外置 Gemini 网关与派发器必须动态探测运行时 `clash-verge.yaml` `mixed-port`（核验 `mihomo|clash` 进程），**严禁把任何 Gemini / Antigravity 流量回退到主 `Claude` 专属住宅家宽端口**，规则代理不可用时必须 fail-closed 退出；
   - **Windows `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 连坐回收与非交互桌面 `MainWindowHandle = 0` 陷阱**：AI 工具子进程退出时会由内核 Job Object 连坐强杀普通 `Start-Process` 派生的后台守护进程，拉起长驻网关/桌面进程必须通过 WMI `Win32_Process.Create`（或计划任务）脱离当前 Job Object 并在独立后续命令中复核存活；同时非交互工具桌面因 WindowStation 隔离读取交互进程 `MainWindowHandle` 恒为 `0`，必须在 `SessionId == 1` 的交互 `WinSta0\Default` 上下文内探测真实 `HWND`；
   - **`/advisor` `$8/MTok` 未缓存全量读取与零遥测 GrowthBook 缓存坑点**：每次 `advisor()` 调用均按高阶单价对完整会话上下文做**未缓存读取**，严禁在 `Fable 5.2` 主控下重复挂载同级 Advisor，且 `Mode B` 必须严守 `Ctx < 150k` 与单任务最多 3 次门禁；在 `DISABLE_TELEMETRY=1` 下必须同时配齐 `CLAUDE_CODE_ENABLE_EXPERIMENTAL_ADVISOR_TOOL="1"` 与 `CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF="1"` 方可零遥测离线启用（Relay 环境禁用）；
   - **PowerShell `` "`f" `` `0x0C` 换页符转义污染、命名 `Mutex` 槽位与文件编码契约**：PowerShell 双引号内书写反引号包裹的 `` `file:line` `` 会将 `` `f `` 转义为 `0x0C`（Form-Feed 控制字节）污染提示词——拼接文本一律使用单引号 Here-String `@' ... '@` 并扫描 `< 0x20` 控制字节；含中文的外置 `.ps1` 必须保持 **`UTF-8 WITH BOM + 纯 LF`** 并通过 PS 5.1/7 双端 AST 零错误校验，而受跟踪文件与 `.claude/*.md` / JSON 必须保持 **`UTF-8 no-BOM + 纯 LF`** 且对 `.claude/agents/*.md` 采用目录外暂存 + `[System.IO.File]::Move($tmp, $dst, $true)` 原子替换；高并发槽位使用支持 `AbandonedMutexException` 恢复的命名 `Mutex` 数组（弃用全局命名 `Semaphore`），且并行 `-PromptFile` 首行须带独立角色头以打散会话亲和哈希。

### 5.2 防风控、净室清洗与 CLI 协同坑点
1. **严守 `s13` 设备指纹连续性红线（[`src-tauri/src/cleaner_config.rs`](src-tauri/src/cleaner_config.rs) vs [`src-tauri/src/cleaner_identity.rs`](src-tauri/src/cleaner_identity.rs)）**：
   - `cleaner_config.rs` 的通用 `ACCOUNT_KEYS` 严禁包含 `userID`、`cachedGrowthBookFeatures`、`metricsStatusCacheByPrincipal`、`anonymousId`、`groveConfigCache`（否则会破坏单机设备连续性并令 `s13_account_cleanup_preserves_device_and_client_state` 失败）；
   - 跨号切换时按账号 UUID（`"acct:<uuid>"`）精准裁剪上述缓存只能在 `cleaner_identity.rs::maintain_account_caches` 中执行，且切换空白环境（`empty`）与删除当前账号（`delete("current")`）也必须调用 `maintain_account_caches(None)`。
2. **严禁在 `settings.json` 或防泄漏模板中使用 `"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"`**：
   - 该变量会切断 Claude Code CLI 的 GrowthBook 特性拉取，直接导致 `/model` 选择器隐藏 `Fable 5.2`。关闭遥测仅使用 `DISABLE_TELEMETRY`、`DISABLE_ERROR_REPORTING` 与 `DO_NOT_TRACK`。
3. **严禁对伴生 `chrome.exe` 调用 `PROCESS_VM_READ` 或将其设为系统默认浏览器**：
   - Windows 进程命令行与目录核验必须沿用 [`src-tauri/src/windows_process.rs`](src-tauri/src/windows_process.rs) 中基于 `PROCESS_QUERY_LIMITED_INFORMATION` 的 `NtQueryInformationProcess(60)` 与 `GetFileInformationByHandle` 实现。
4. **修改被动额度脚本必须双路径同步（`~/.local/bin/` + `%LOCALAPPDATA%\Programs\Claude-Local\scripts\`）**：
   - `~/.claude/settings.json` 的 `statusLine` 直接执行 `~/.local/bin/claude_quota.py`，且它会同目录 `import quota_archive`。修改 [`scripts/claude_quota.py`](scripts/claude_quota.py) 或 [`scripts/quota_archive.py`](scripts/quota_archive.py) 后必须同时覆盖这两处，并兼容字典格式的 `effort: {"level": "high"}`。
5. **`save_ledger_and_sync_sqlite` 写回 `identity_summaries` 时切勿丢失网页同步字段**：
   - 构造摘要时必须保留 `manual_resets_remaining`、`manual_resets_valid_until`、`subscription_expires_at`、`subscription_renews_at`、`quota_no_5h_limit` 等元数据；真实 SQLite 位于 `%APPDATA%\ai.local.claude-local\identity-vault\identities.sqlite`。
6. **网页同步（`identities_sync_subscription`）严禁混用 `current_browser_binding` 或共用单一全局 `Browser.session`**：
   - `current_browser_binding` 只返回当前活跃 CLI 的 `state.active`（`32-hex` ID），若拿去与非活跃已保存卡片 ID 或采集器侧当前卡标识 `"current"` 做相等比对，会导致已登录且指纹匹配的账号 **100% 误报 `quotaOnline.accountMismatch`**；网页同步必须统一走 [`quota_bridge::target_browser_binding`](src-tauri/src/browser/quota_bridge.rs) + [`verify_ticket_binding`](src-tauri/src/browser/quota_bridge.rs) 按目标卡片精确核验；
   - 每次网页同步必须通过 [`quota_existing::receive_subscription_sync`](src-tauri/src/browser/quota_existing.rs) 独占 `127.0.0.1:0` 临时回环监听端口，严禁调用会轮换全局令牌并打开空白诊断页的 `launch_locked`。
7. **区分「用户显式打开多账号浏览器」与「后台静默批量回退」的槽位落盘策略，并严守 `Cleaner -> Browser` 锁顺序**：
   - 用户显式打开卡片 `claude.ai` / 官方用量页（`browser_open_identity_profile`、`browser_open_usage`）或发起网页同步时，调用 `materialize_identity_profile_locked` / `ensure_identity_slot` 按需创建 `contexts/<slot>/{config.json, seed.owner, profile/}`，且**绝不改动 `browser.active`、绝不调用会关闭其他账号窗口的 `browser_return_to_cli`**（当前运行卡点「进入 Claude.ai」同样走独立槽位单标签打开，「切回 CLI 浏览器」保留给养号轨显式按钮）；
   - 后台批量额度校准的静默浏览器回退（`resolve_bound_profile_target`）必须保持只读探测，绝不能替从未打开过浏览器的历史卡片静默创建空目录并拉起未登录窗口；
   - 任何同时获取 `State<Cleaner>` 与 `State<Browser>` 的命令必须严格遵守 **`Cleaner` 先、`Browser` 后** 的加锁顺序，且在进入回环异步等待（如 45s 网页同步）前立即释放双锁，严禁持锁等待阻塞 UI 或其他账号浏览器。

### 5.3 构建、嵌入资源与合成测试坑点
0. **用量扫描性能红线（2.5）**：不要恢复“含无效行文件不缓存游标”的旧语义（会让大日志每 5s 整文件重解析）；不要在未变文件快路径前做逐文件 SID/打开操作；不要让空扫描、`observe` 或 HUD 采集产生无条件持久提交；不要让身份页读取阻塞等待 `USAGE_LOCK`。改动后跑 `cargo test --release --features custom-protocol --bin claude-local usage_perf -- --ignored --nocapture` 对比基准。
1. **`--features custom-protocol` 会将 `dist/` 嵌入 `claude-local.exe`**：
   - Release 构建不仅把 `dist/` 拷入安装目录 `browser-ui/`，还会在 `cargo build --release --features custom-protocol` 编译期将 `../dist` 直接嵌入二进制。任何时候改了 `src/*` 前端代码，都必须**先 `bun run build`，再编译 Rust Release 二进制**，顺序绝对不能反。
2. **Rust 测试目标为 `--bin claude-local` 而非 `--lib`，且原生错误键受双语门禁扫描**：
   - 本仓没有独立 `lib.rs` 目标，运行测试必须带 `--bin claude-local`；修改 [`src-tauri/src/quota_core.rs`](src-tauri/src/quota_core.rs) 后必须先 `cargo build --manifest-path src-tauri/Cargo.toml --bin claude-local` 刷新 `target/debug/claude-local.exe`，再跑 `scripts/test-claude-quota-local.py`；
   - `src/i18n.test.ts` 会自动扫描 Rust 源码中的 `quotaOnline.*`、`browser.*` 等错误码字符串——新增或迁移任何后端错误码（如 `quotaOnline.authRequired`）时，必须同步写入 [`src/locales/zh.yaml`](src/locales/zh.yaml) 与 [`src/locales/en.yaml`](src/locales/en.yaml)，否则 `bun test` 会直接失败。
3. **Playwright 本地 Vite 预览脚本必须忽略 `**/.local/**`、绕开本机代理且串行运行**：
   - `.local/research/` 下存放了克隆的对标仓库，Vite 开发服务器必须配置 `watch.ignored: ['**/.local/**']` 与显式 `optimizeDeps.entries`（见 [`scripts/test-identities-ui.ts`](scripts/test-identities-ui.ts) 与 [`scripts/test-local-shell.mjs`](scripts/test-local-shell.mjs)），否则启动时会递归扫描 `.local/` 导致 `page.goto` 超时；
   - 同一工作区下的多组 `test-identities-ui.ts` 子套件（`--cards-only`、`--warming-only`、`--online-only`）共享 `node_modules/.vite` 预构建目录，**必须串行依次执行**，切勿多进程并发启动 Vite 服务器触发依赖重优化锁竞争；
   - 在终端跑 Playwright 本地脚本时，若环境挂有系统代理，先在当前子进程清空代理环境变量并设 `NO_PROXY="127.0.0.1,localhost"`，防止 `127.0.0.1` 回环请求被系统代理拦截。
4. **身份卡片标准尺寸与悬浮窗按钮索引**：
   - 正式与养号身份卡片 CSS 基准尺寸自 `v0.2.6` 起即为 **`166×286`**（切勿回退写成旧 `180×286`）；
   - 悬浮监控小窗顶栏 `.monitor-hud-controls` 共有 **9 个按钮**（`0: 透明度`, `1: 自动贴边`, `2: 贴边收起`, `3: 锁定位置`, `4: 鼠标穿透`, `5: 置顶`, `6: 紧凑模式`, `7: 立即刷新`, `8: 关闭`），编写合成测试选择器时需对应正确索引（见 [`scripts/monitor-layout-checks.mjs`](scripts/monitor-layout-checks.mjs)）。
5. **Windows 进程存活判定、快照目录指纹与前端只读命令白名单坑点（2.9 新增）**：
   - Windows 上父终端（Windows Terminal / ConPTY）未释放句柄时，已退出子进程仍会出现在 Toolhelp 快照中；枚举与结束进程必须保留 `Handle::is_alive()`（`WaitForSingleObject(0) == WAIT_TIMEOUT` / `GetExitCodeProcess == STILL_ACTIVE`），且绝不能把 `identities_quota_revision` 改成高频重做进程扫描（实时会话刷新走独立轻量 `identities_live_sessions`）；
   - [`src-tauri/src/cleaner_targets.rs`](src-tauri/src/cleaner_targets.rs) 的 `measure()` 对普通目录（`meta.is_dir() && !linked(&meta)`）切勿哈希父目录 `last_write_time` / `mtime`（否则在 `.claude/debug` 内创建/删除已过滤的 `.oauth_refresh.lock` 或 `*.tmp.*` 仍会改变目录修改时间导致快照比对误判），文件与重解析链接的时间戳和大小哈希保持不变；
   - 新增任何页面挂载期只读 Tauri IPC 命令时，必须同步检查 [`scripts/quick-setup-checks.mjs`](scripts/quick-setup-checks.mjs) 的 `allowedCommands` 与 [`scripts/test-usage-statistics.mjs`](scripts/test-usage-statistics.mjs) 的 `readCommands` 白名单，确保 `--quick-only` 与完整合成套件不误报越权命令。

---

## 6. 核心文件快速导航

- **方案与交接**：[`HANDOFF.md`](HANDOFF.md)、[`CLAUDE.md`](CLAUDE.md)、[`docs/RELEASE_VERIFICATION_0.3.2.md`](docs/RELEASE_VERIFICATION_0.3.2.md)、[`docs/plans/2026-11-10-v0.3.2-polish-and-hardening/00-README.md`](docs/plans/2026-11-10-v0.3.2-polish-and-hardening/00-README.md)
- **本机工作站外置工具链交接（Git 忽略）**：`.local/tasks/20261112-session-handoff/HANDOFF.local.md`
- **版本与打包审计**：[`package.json`](package.json)、[`src-tauri/Cargo.toml`](src-tauri/Cargo.toml)、[`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json)、[`scripts/build-windows-share.ps1`](scripts/build-windows-share.ps1)、[`scripts/audit-windows-package.py`](scripts/audit-windows-package.py)、[`scripts/runtime-resources.json`](scripts/runtime-resources.json)
- **隔离、风控与伴生浏览器**：[`src-tauri/src/identities/store.rs`](src-tauri/src/identities/store.rs)、[`src-tauri/src/identities/browser_link.rs`](src-tauri/src/identities/browser_link.rs)、[`src-tauri/src/identities/archive.rs`](src-tauri/src/identities/archive.rs)、[`src-tauri/src/cleaner_identity.rs`](src-tauri/src/cleaner_identity.rs)、[`src-tauri/src/cleaner_targets.rs`](src-tauri/src/cleaner_targets.rs)、[`src-tauri/src/cleaner_io.rs`](src-tauri/src/cleaner_io.rs)、[`src-tauri/src/cleaner_config.rs`](src-tauri/src/cleaner_config.rs)、[`src-tauri/src/cleaner.rs`](src-tauri/src/cleaner.rs)、[`src-tauri/src/risk_check.rs`](src-tauri/src/risk_check.rs)、[`src-tauri/src/windows_process.rs`](src-tauri/src/windows_process.rs)、[`src-tauri/src/browser/workspaces.rs`](src-tauri/src/browser/workspaces.rs)、[`src-tauri/src/browser/quota_connection.rs`](src-tauri/src/browser/quota_connection.rs)、[`src-tauri/src/browser/quota_existing.rs`](src-tauri/src/browser/quota_existing.rs)、[`src-tauri/src/browser/kill_switch.rs`](src-tauri/src/browser/kill_switch.rs)、[`src-tauri/src/browser/profile.rs`](src-tauri/src/browser/profile.rs)
- **额度后端与采集脚本**：[`src-tauri/src/identities/mod.rs`](src-tauri/src/identities/mod.rs)、[`src-tauri/src/identities/database.rs`](src-tauri/src/identities/database.rs)、[`src-tauri/src/identities/profile.rs`](src-tauri/src/identities/profile.rs)、[`src-tauri/src/identities/online.rs`](src-tauri/src/identities/online.rs)、[`src-tauri/src/browser/quota_bridge.rs`](src-tauri/src/browser/quota_bridge.rs)、[`src-tauri/src/browser/server.rs`](src-tauri/src/browser/server.rs)、[`browser-runtime/quota-bridge/content.js`](browser-runtime/quota-bridge/content.js)、[`scripts/claude_quota.py`](scripts/claude_quota.py)、[`scripts/claude_quota_online.py`](scripts/claude_quota_online.py)、[`scripts/quota_archive.py`](scripts/quota_archive.py)
- **用量分析 2.2**：[`src-tauri/src/identities/usage.rs`](src-tauri/src/identities/usage.rs)、[`src/usage-model.ts`](src/usage-model.ts)、[`src/usage-statistics.tsx`](src/usage-statistics.tsx)、[`src/usage-export.ts`](src/usage-export.ts)、[`src/usage-screenshot.ts`](src/usage-screenshot.ts)
- **身份卡片、智能接力、悬浮小窗与双语样式**：[`src/identities.tsx`](src/identities.tsx)、[`src/identity-model.ts`](src/identity-model.ts)、[`src/warming-cards.tsx`](src/warming-cards.tsx)、[`src/card-order.ts`](src/card-order.ts)、[`src/smart-relay-model.ts`](src/smart-relay-model.ts)、[`src/floating-monitor.tsx`](src/floating-monitor.tsx)、[`src/main.tsx`](src/main.tsx)、[`src/style.css`](src/style.css)、[`src/identity-productivity.css`](src/identity-productivity.css)、[`src/productivity-shell.css`](src/productivity-shell.css)、[`src/locales/zh.yaml`](src/locales/zh.yaml)、[`src/locales/en.yaml`](src/locales/en.yaml)
- **本机热更新留档（Git 忽略）**：`.local/tasks/20261113-hotupdate-post-0.3.2/hotupdate.ps1`、`.local/tasks/20261113-hotupdate-post-0.3.2/deployment-receipt.json`、`.local/tasks/20261110-hotupdate-0.3.2/hotupdate-0.3.2.ps1`、`.local/tasks/20261110-hotupdate-0.3.2/deployment-receipt.json`

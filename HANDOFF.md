<!--
[INPUT]: Final owner decisions, released v0.3.1 baseline (fa1fedde2982bc123986ed70b8ca95fdeb56e18a), 2026-11-10 open-source benchmark audit (11 GitHub projects), and complete v0.3.2 full-stack polish, hardening, verification, and atomic local hot-update.
[OUTPUT]: Context-free session handoff covering: (1) what task we are doing, (2) what is completed, (3) where we are stuck, (4) next-step plan, and (5) pitfalls never to repeat.
[POS]: Root maintenance handoff for a zero-context successor session. Real identities, emails, IP/proxy credentials, process IDs, browser seeds, private probe values, workstation paths and screenshots stay out of tracked files.
[PROTOCOL]: Backed up prior HANDOFF.md to .local/tasks/20261110-hotupdate-0.3.2/HANDOFF-pre-0.3.2.md.bak (SHA256 A8C4CE9AC175DC15C600C29AAF9003100CD40A1DB5342CD110C5B780C53BFC0C).
-->
# Claude-Local 会话交接（HANDOFF.md）

更新时间：2026-11-11 20:55，America/New_York（EST）。

## 接手先读：30 秒全局速览

1. **当前版本与状态**：全仓已升级并深度打磨至 **`v0.3.2`**，**五大核心域升级、真机验收反馈闭环修复（多账号网页同步额度与重置 + 多账号同时打开隔离官方用量页）、全套自动化测试与本机无感热更新均已 100% 完成**，桌面端主程序与 CLI 被动额度采集器均已在本机运行最新的 `v0.3.2` 版本（全程 `0` 中断任何 `claude.exe` 或浏览器进程）。
2. **当前所处阶段**：遵照所有者明确指令（*“先做好本地热更新，待合适后我再通知进行打包、上传、发布等，版本为 v0.3.2”*），当前处于**等待用户本机体验验收通知**的受控节点——**尚未执行** `bun run build:windows`（NSIS 安装包生成）、`git commit`、`git tag`、`git push` 或 GitHub Release 上传发布。
3. **零上下文新会话必读顺序**：
   - 第 1 步：阅读本文、根目录 `AGENTS.md`（本地工作区未暂存规则文件，**严禁 git add/commit**）与 [`CLAUDE.md`](CLAUDE.md)；
   - 第 2 步：若需查看 `v0.3.2` 详细设计方案与对标结论，阅读 [`docs/plans/2026-11-10-v0.3.2-polish-and-hardening/00-README.md`](docs/plans/2026-11-10-v0.3.2-polish-and-hardening/00-README.md)；
   - 第 3 步：若需继续修改代码，先读对应目录的 `CLAUDE.md`（[`src/CLAUDE.md`](src/CLAUDE.md)、[`src-tauri/CLAUDE.md`](src-tauri/CLAUDE.md)、[`src-tauri/src/identities/CLAUDE.md`](src-tauri/src/identities/CLAUDE.md)、[`src-tauri/src/browser/CLAUDE.md`](src-tauri/src/browser/CLAUDE.md)、[`src/locales/CLAUDE.md`](src/locales/CLAUDE.md)、[`scripts/CLAUDE.md`](scripts/CLAUDE.md)）及目标文件头部的 `[INPUT]/[OUTPUT]/[POS]` 注释；
   - 第 4 步：若用户直接通知“打包、上传、发布 `v0.3.2`”，请直接跳至本文 **第 4 节（下一步计划是什么）** 按 SOP 逐步执行。

---

## 1. 我们在做什么任务

### 1.1 产品定位与不可逾越的边界
- **独立产品身份**：`Claude-Local` 是本仓库独立拥有并维护的 Windows 10/11 x64 多账号防关联工作台（主程序 `claude-local.exe`，Bundle ID `ai.local.claude-local`，伴生指纹浏览器注册名 `Claude-Local-Browser`）。严禁添加任何外部上游 remote、自动上游同步或官方自动更新源。
- **运行目录隔离**：
  - 用户配置、加密身份保险箱（`.baga` 归档 + `identities.sqlite`）与伴生浏览器槽位位于 `%APPDATA%\ai.local.claude-local`；
  - 桌面端默认安装位于 `%LOCALAPPDATA%\Programs\Claude-Local`；
  - Claude Code CLI 的 `statusLine` 被动采集脚本位于 `~/.local/bin/claude_quota.py`（同目录依赖 `~/.local/bin/quota_archive.py`）；
  - 技术栈：**Tauri 2 (Rust)** + **React 19 / TypeScript / Tailwind 4 / Cromma UI** + **Python 3 单写者跨进程锁额度账本采集器**。

### 1.2 本阶段核心目标（`v0.3.2` 全量细节打磨与五大核心域加固）
用户授权对 GitHub 上相关高质量开源项目（`CCBaga`、`CCswap` / `claude-swap`、`CC Switch`、`Claude Cage`、`ccusage` 等）做深度调研、拆解与对比审阅，并对 `Claude-Local` 进行从文字、内容、排版、风格、样式、UI、交互、反馈、切换、动画到流程、负载、并发的全方位精细化升级，重点聚焦五大模块：
1. **身份卡片管理（Identity Card Management）**
2. **账号隔离（Account Isolation）**
3. **风险规避（Risk Avoidance）**
4. **额度查询（Quota Query）**
5. **用量分析（Usage Analytics）**

交付节奏由用户明确划分为两步：
- **第一阶段（已完成）**：完成全部调研、设计、研发、全量测试与本机 `v0.3.2` 热更新；
- **第二阶段（待用户通知后启动）**：生成审计版 Windows NSIS 安装包、执行 Git 提交打标、上传并发布 `v0.3.2`。

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
- **验证**：`bun test` 193 pass；Rust 327 passed；Python online 40 / local 38 / archive 7 / runtime 2 OK；Playwright cards 28 / online 10 / warming 29 通过。旧数据（无 grant 字段）会立即以“待同步”灰显出现；重新网页同步后恢复正常并获得真实到期时间。

---

## 3. 当前卡在哪

**当前没有任何技术阻塞、失败测试或未解决缺陷。**

唯一暂停原因是**严格遵守用户的阶段指令**：用户要求先完成本地热更新供实际体验，待用户确认合适后再通知执行打包、上传、发布 `v0.3.2`。因此当前 Git 暂存区保持为空（`staged_count = 0`），所有 `v0.3.2` 修改均干净保留在工作区中。

---

## 4. 下一步计划是什么（给零上下文新会话的执行手册）

### 场景 A：若用户在体验本机 `v0.3.2` 后提出微调意见
1. 先阅读对应模块的 `CLAUDE.md` 与源文件头部注释再做修改（保持纯 LF 行尾）。
2. 若修改了任何前端文件（`src/*`）：**必须依次运行** `bun test` -> `bun run build` -> `cargo build --release --features custom-protocol --manifest-path src-tauri/Cargo.toml`（因为 `--features custom-protocol` 会把 `dist/` 静态编译进 `claude-local.exe`，只跑 `bun run build` 不重编 Rust 会导致主窗口仍加载旧前端！）。
3. 若修改了 [`scripts/claude_quota.py`](scripts/claude_quota.py) 或 [`scripts/quota_archive.py`](scripts/quota_archive.py)，运行对应 Python 测试后重新执行 `.local/tasks/20261110-hotupdate-0.3.2/hotupdate-0.3.2.ps1` 同步至 `%LOCALAPPDATA%\Programs\Claude-Local` 与 `~/.local/bin/`。

### 场景 B：若用户通知“现在进行 `v0.3.2` 打包、上传、发布”
请严格参考上一次 `v0.3.1` 的审计发版流程（参考 `.local/tasks/20261109-release-0.3.1/` 下的留档脚本与回执），按以下顺序执行：

1. **编写正式版发布说明**：
   - 参照 [`docs/RELEASE_NOTES_0.3.1.md`](docs/RELEASE_NOTES_0.3.1.md) 的结构与脱敏规范，编写 `docs/RELEASE_NOTES_0.3.2.md`（中英或中文清晰列出 `v0.3.2` 五大模块升级与修复项，严禁包含任何本机路径、真实邮箱、代理端口或私有探针文本），并按需更新 [`CLAUDE.md`](CLAUDE.md) 索引。
2. **源码文件清单核对与隐私/行尾预检**：
   - 运行 `git status --short` 逐一核对修改与新增文件（当前共 89 个已跟踪源码/文档/脚本文件修改（不含 `AGENTS.md`）+ 未跟踪目录 `docs/plans/2026-11-10-v0.3.2-polish-and-hardening/` 下 2 个新文档文件 + 新增合成基准 `src-tauri/src/identities/usage_perf_tests.rs`，三者均需显式 `git add`）：
     - **严禁暂存或提交 `AGENTS.md`**（工作区中原本就带有本地规则改动，绝不能入库）；
     - **严禁暂存或提交 `.local/`** 下的任何文件；
   - 检查所有待提交文件确保 `0` 个 CRLF（`\r\n`）且 `0` 个本机工作区绝对路径或个人身份特征泄露；
   - 如需执行外置 29 项隐私探针源码扫描（参照 `.local/tasks/20261109-release-0.3.1/scan-source.py`），若 `%TEMP%` 下原有的临时 `markers.json` 已被系统清理，向用户确认外置探针文件路径或按 [`scripts/audit-windows-package.py`](scripts/audit-windows-package.py) 规范生成外置探针（**绝不能在终端回显或跟踪文件中打印任何探针明文**）。
3. **构建审计版 Windows NSIS 安装包（`bun run build:windows`）**：
   - 调用 [`scripts/build-windows-share.ps1`](scripts/build-windows-share.ps1)（支持 `-SevenZipPath .local\build-tools\7zip-26.04-f4a03f7e\portable\7z.exe` 及可选 `-PrivateMarkersFile`）；
   - 该脚本会自动在工作区与 `USERPROFILE` 之外的干净中立目录（默认磁盘根 `ClaudeLocalBuild/<id>`）执行一次性编译、NSIS 打包、7z 只读解包对账与 [`scripts/audit-windows-package.py`](scripts/audit-windows-package.py) 校验，产物输出至 `.local/artifacts/<id>/`（含 `Claude-Local_0.3.2_x64-setup.exe`、`.sha256`、`resource-manifest.json`、`privacy-audit.json`）；
   - 若用户要求将审计后的安装包 payload 同步部署回本机安装目录，可参照 `.local/tasks/20261109-release-0.3.1/deploy-audited.ps1` 更新本机并保持 `missingClaudeCount == 0`。
4. **Git 提交、打 Tag 与上传发布**：
   - 仅精确 `git add` 经审查的跟踪源码与文档文件（再次 `git diff --cached --name-only` 确认不含 `AGENTS.md` 与 `.local/`）；
   - 提交 `v0.3.2` commit、创建 `v0.3.2` tag，并按用户指定的远端/渠道完成推送与 Release 产物上传（参照 `.local/tasks/20261109-release-0.3.1/github-release-receipt.json` 的资产命名与 SHA-256 核验规范）。

---

## 5. 有哪些踩过的坑，绝对不要再踩

### 5.1 绝对安全与隐私红线
1. **严禁中断任何正在运行的 `claude.exe`（Claude Code CLI）或伴生 `chrome.exe` 进程**：
   - 无论是跑测试、构建还是本机部署热更新，都绝不能停止 `claude.exe`；热更新前、后必须快照比对 `(Id, StartTime)` 并断言 `missingClaudeCount == 0`。
2. **严禁把 `AGENTS.md` 或 `.local/` 暂存或提交进 Git，严禁写入本机隐私信息**：
   - `AGENTS.md` 含有本地工作区未提交变更，切勿 `git add .` 或 `git commit -a`（必须显式指定文件路径暂存）；
   - 严禁在任何受 Git 跟踪的文件中出现本机绝对工作区路径、真实邮箱、账号 UUID、代理凭据、浏览器随机种子或进程 PID；所有跟踪文本文件必须保持纯 LF（`\n`）行尾。
3. **严守已取消的功能边界**：
   - 单账号 `.bagapack` / `CLPACK01` 导出导入功能已于 2026-11-02 被所有者明确取消（见 [`CLAUDE.md`](CLAUDE.md) 第 26 行），任何时候都不要重新实现其四个阶段。
4. **保持持久化兼容格式不变**：
   - `BAGAID01` 魔数、`.baga` 加密归档结构、SQLite `user_version=3`、账号 HMAC 算法及历史遗留 `CCBaga` 浏览器种子域字符串属于持久化兼容层，严禁在优化或重构中改动。

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

---

## 6. 核心文件快速导航

- **方案与交接**：[`HANDOFF.md`](HANDOFF.md)、[`CLAUDE.md`](CLAUDE.md)、[`docs/plans/2026-11-10-v0.3.2-polish-and-hardening/00-README.md`](docs/plans/2026-11-10-v0.3.2-polish-and-hardening/00-README.md)
- **版本与打包审计**：[`package.json`](package.json)、[`src-tauri/Cargo.toml`](src-tauri/Cargo.toml)、[`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json)、[`scripts/build-windows-share.ps1`](scripts/build-windows-share.ps1)、[`scripts/audit-windows-package.py`](scripts/audit-windows-package.py)、[`scripts/runtime-resources.json`](scripts/runtime-resources.json)
- **隔离、风控与伴生浏览器**：[`src-tauri/src/identities/store.rs`](src-tauri/src/identities/store.rs)、[`src-tauri/src/identities/browser_link.rs`](src-tauri/src/identities/browser_link.rs)、[`src-tauri/src/identities/archive.rs`](src-tauri/src/identities/archive.rs)、[`src-tauri/src/cleaner_identity.rs`](src-tauri/src/cleaner_identity.rs)、[`src-tauri/src/cleaner_config.rs`](src-tauri/src/cleaner_config.rs)、[`src-tauri/src/cleaner.rs`](src-tauri/src/cleaner.rs)、[`src-tauri/src/risk_check.rs`](src-tauri/src/risk_check.rs)、[`src-tauri/src/windows_process.rs`](src-tauri/src/windows_process.rs)、[`src-tauri/src/browser/workspaces.rs`](src-tauri/src/browser/workspaces.rs)、[`src-tauri/src/browser/quota_connection.rs`](src-tauri/src/browser/quota_connection.rs)、[`src-tauri/src/browser/quota_existing.rs`](src-tauri/src/browser/quota_existing.rs)、[`src-tauri/src/browser/kill_switch.rs`](src-tauri/src/browser/kill_switch.rs)、[`src-tauri/src/browser/profile.rs`](src-tauri/src/browser/profile.rs)
- **额度后端与采集脚本**：[`src-tauri/src/identities/database.rs`](src-tauri/src/identities/database.rs)、[`src-tauri/src/identities/profile.rs`](src-tauri/src/identities/profile.rs)、[`src-tauri/src/identities/online.rs`](src-tauri/src/identities/online.rs)、[`src-tauri/src/browser/quota_bridge.rs`](src-tauri/src/browser/quota_bridge.rs)、[`src-tauri/src/browser/server.rs`](src-tauri/src/browser/server.rs)、[`browser-runtime/quota-bridge/content.js`](browser-runtime/quota-bridge/content.js)、[`scripts/claude_quota.py`](scripts/claude_quota.py)、[`scripts/claude_quota_online.py`](scripts/claude_quota_online.py)、[`scripts/quota_archive.py`](scripts/quota_archive.py)
- **用量分析 2.2**：[`src-tauri/src/identities/usage.rs`](src-tauri/src/identities/usage.rs)、[`src/usage-model.ts`](src/usage-model.ts)、[`src/usage-statistics.tsx`](src/usage-statistics.tsx)、[`src/usage-export.ts`](src/usage-export.ts)、[`src/usage-screenshot.ts`](src/usage-screenshot.ts)
- **身份卡片、智能接力、悬浮小窗与双语样式**：[`src/identities.tsx`](src/identities.tsx)、[`src/warming-cards.tsx`](src/warming-cards.tsx)、[`src/card-order.ts`](src/card-order.ts)、[`src/smart-relay-model.ts`](src/smart-relay-model.ts)、[`src/floating-monitor.tsx`](src/floating-monitor.tsx)、[`src/main.tsx`](src/main.tsx)、[`src/style.css`](src/style.css)、[`src/identity-productivity.css`](src/identity-productivity.css)、[`src/productivity-shell.css`](src/productivity-shell.css)、[`src/locales/zh.yaml`](src/locales/zh.yaml)、[`src/locales/en.yaml`](src/locales/en.yaml)
- **本机热更新留档（Git 忽略）**：`.local/tasks/20261110-hotupdate-0.3.2/hotupdate-0.3.2.ps1`、`.local/tasks/20261110-hotupdate-0.3.2/deployment-receipt.json`

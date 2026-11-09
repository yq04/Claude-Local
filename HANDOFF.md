<!--
[INPUT]: Final owner decisions, released v0.3.1 source/tag fa1fedde2982bc123986ed70b8ca95fdeb56e18a, documentation commit a9e0a568df1855400143023ece2e03ac96ee3b9a, passing release-source CI (run 42585468806), audited NSIS installer (SHA256 1551e85799f16bb7f6bfa8678d4e13f10e1efce2d85f3a41a10a7f786a7fc281), verified local payload deployment (host SHA256 0579a61aa4886e34d7b22740a807719dc0a061c6abf843a55bafb00621285b66, missingClaudeCount = 0), and 2026-11-09 Smart Relay / Auto-Wakeup frame-rate optimization & 2x Usage poster export.
[OUTPUT]: Context-free session handoff: what task we are doing, what is completed, where we are stuck (none), next steps, and verified pitfalls never to repeat.
[POS]: Root maintenance handoff. Real identities, emails, IP/proxy credentials, process IDs, browser seeds, private probe values, workstation paths and screenshots stay out of tracked files.
[PROTOCOL]: Back up and verify SHA256 before rewriting (backed up to .local/tasks/20261109-release-0.3.1/HANDOFF-pre-session-end-20261109.md.bak, SHA256 789F6700D08F04FB1E1E189821C2C26053D5987492371BA871524E362A7E1BFD). This handoff update is documentation-only: no build/deploy, account action, proxy reload, upload or release-tag movement.
-->
# Claude-Local 会话交接（HANDOFF.md）

更新时间：2026-11-09，America/New_York（EST）。

## 接手先读：当前结论（30 秒速览）

1. **`Claude-Local v0.3.1` 全链路性能优化、本机无感热更新与正式发布已 100% 完结**：
   - 针对用户反馈的「进入智能接力、自动续杯等弹窗页面很卡」问题，已完成从 WebView2 GPU 合成层、React 渲染与事件去重、到 Rust 后端 IPC 单次文件解析与 Python 运行时探针缓存的全链路治理；
   - 连同 `v0.3.1` 用量分析 2× 高清长图海报一键导出、模型与趋势等高排版、净室切号 `s13` 设备指纹连续性（保留 `userID` / `cachedGrowthBookFeatures` / `metricsStatusCacheByPrincipal`）及统一 3 步/4 步引导体验，已完成全套测试、中性环境 NSIS 打包、29 项外置隐私探针审计、本机零中断热更新（`missingClaudeCount = 0`）与 [GitHub Release v0.3.1 (Latest)](https://github.com/yq04/Claude-Local/releases/tag/v0.3.1) 正式发布。
2. **本机 `Gemini 4 Argon` 子代理管线、Magpie 路由与 PowerShell 7 (`pwsh.exe`) 默认化保持完好**：
   - Magpie 保持 `"routing": "pace"` + `"accountCaps": 68` + `"capCareful": true` + `"sink": true` + `firstToken` 超时熔断（`75s`/`60s`/`30s`）；Claude Code 子代理与 Antigravity 权限配置默认使用 **PowerShell 7 (`pwsh.exe` v7.6.8)**。
3. **零上下文新会话接手阅读顺序**：
   - 先读本文、根目录 `AGENTS.md` 与 [`CLAUDE.md`](CLAUDE.md)；
   - 再读 [`docs/RELEASE_VERIFICATION_0.3.1.md`](docs/RELEASE_VERIFICATION_0.3.1.md) 与 [`docs/RELEASE_NOTES_0.3.1.md`](docs/RELEASE_NOTES_0.3.1.md)；
   - 修改任何模块前，先读对应目录的 `CLAUDE.md`（如 [`src/CLAUDE.md`](src/CLAUDE.md)、[`src-tauri/CLAUDE.md`](src-tauri/CLAUDE.md)、[`src-tauri/src/identities/CLAUDE.md`](src-tauri/src/identities/CLAUDE.md)）和目标源文件头部的 `[INPUT]/[OUTPUT]/[POS]` 注释。

---

## 1. 我们在做什么任务

### 1.1 项目背景与边界
`Claude-Local` 是独立拥有并维护的 Windows 10/11 x64 桌面多账号防关联工作台（主程序 `claude-local.exe`，Bundle ID `ai.local.claude-local`，伴生指纹浏览器注册名 `Claude-Local-Browser`，用户数据位于 `%APPDATA%\ai.local.claude-local`，默认安装位于 `%LOCALAPPDATA%\Programs\Claude-Local`）。技术栈为 **Tauri 2 (Rust) + React 19 (TypeScript) + Python 单写者额度账本采集器**。

### 1.2 本次会话的核心任务（已全部完成）
1. **诊断并根治「智能接力」「自动续杯」页面及弹窗交互卡顿问题**：
   - 排查确认卡顿并非电脑物理内存不足，而是由 **WebView2 GPU 合成过载**（全屏 SVG `<feTurbulence>` 实时分形噪声滤镜 + 三层嵌套 `backdrop-filter: blur()` + 弹窗下活跃卡片无限 `box-shadow` 动画）、**React 渲染冗余**（桌面端 1s 定时器与后台 15s 无变化快照事件触发 40 张卡片全量重算、弹窗关闭时仍挂载数百个隐藏 DOM 节点、重开弹窗重复接管已完成批次）以及 **Rust 后端 I/O 与进程冷启动阻塞**（每次 `identities_read` 重复读取解析 `quota_ledger.json` 和 `quota_web_metadata.json` 达 `N + 2` 次、自动续杯每次修改时间窗口重复冷启动 `python.exe` 探针耗时 ~500ms）叠加引起。
2. **完成前后端优化、全套自动化测试、本机无感热更新与 `v0.3.1` 正式发布**：
   - 一次性修复上述全部性能瓶颈，通过 Bun / Rust / Python / Playwright 全套测试；
   - 在独立中性目录构建并通过 109 文件白名单与 29 项外置隐私探针审计（0 发现），在不中断任何运行中 `claude.exe` 的前提下完成本机 `%LOCALAPPDATA%\Programs\Claude-Local` 热更新，并在 GitHub Actions CI 全绿后发布 `v0.3.1` (Latest)。

---

## 2. 已经完成了什么

### 2.1 智能接力与自动续杯弹窗全链路防卡顿优化（2026-11-09 完成）

1. **WebView2 GPU 合成与 CSS 渲染层减负（[`src/style.css`](src/style.css)、[`src/identity-productivity.css`](src/identity-productivity.css)）**：
   - 将 `--glass-noise-image` 全屏实时计算的 `<feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/>` SVG 滤镜置为 `none`，彻底消除 `.app-sidebar` 与 `.workspace` 在弹窗开闭动画和列表滚动时的全屏逐像素 CPU/GPU 滤镜重光栅化；
   - 移除模态遮罩 `.app-dialog-overlay` 的第二层 `backdrop-filter: blur(2px)`（改用纯色半透明遮罩 `rgba(10, 12, 18, 0.44)`），为毛玻璃/自定义壁纸下的模态弹窗赋予 96% 高不透明隔离表面（亮色 `color-mix(in srgb, #ffffff 96%, transparent)` / 暗色 `color-mix(in srgb, #161a24 96%, transparent)`）与 `.app-dialog-position > * { contain: paint; }`；
   - 为 `.identity-wakeup-account-list` 与 `.identity-relay-account-list` 启用 `contain: content`（并为接力池列表增加 `max-height: 240px; overflow-y: auto` 滚动边界），同时在任意模态弹窗开启时（`body:has(.app-dialog-overlay)`）自动暂停底层活跃身份卡片的 `clActiveCardAura` 无限阴影动画。

2. **React 渲染缓存、快照去重与弹窗按需挂载（[`src/identities.tsx`](src/identities.tsx)、[`src/identity-online-quota.ts`](src/identity-online-quota.ts)、[`src/floating-monitor.tsx`](src/floating-monitor.tsx)）**：
   - **后台 15 秒快照去重**：在 [`src/identity-online-quota.ts`](src/identity-online-quota.ts) 的 `publishNativeWakeup` 中增加 JSON 序列化相等性去重（`nativeWakeupSerialized`），配合 [`src-tauri/src/identities/wakeup.rs`](src-tauri/src/identities/wakeup.rs) 仅在 `changed == true` 时发射 `wakeup-scheduler-state` 事件，彻底消除每 15 秒无变化后台轮询触发的整页重绘；
   - **降低高频定时器唤醒**：将桌面态 `IdentityPanel` 的 `nowSec` 定时器从 `1s` 放宽至 `10s`（Playwright 合成测试态 `'identityFixture' in window` 保持 `1s`），将 [`src/floating-monitor.tsx`](src/floating-monitor.tsx) 的时钟定时器从 `1s` 放宽至 `15s`；
   - **40 卡派生计算全面 `useMemo` 化与弹窗子树按需挂载**：对 `batchTargetInfo`、`currentTargetSetKey`、`staleQuotaTargets`、`currentQuota`、`bestSaved`、`relayAccounts`、`relayEval`、`relayPoolSummary`、`wakeupAccountRows` 与 `wakeableCount` 全面启用 `useMemo` 缓存；仅在 `onlinePanelOpen` / `relayPanelOpen` 为 `true` 时计算并挂载弹窗内部重型列表 JSX；
   - **批次快照防重与配置保存队列**：新增 `adoptedTerminalBatchIdRef` 防止重开自动续杯弹窗时重复接管同一已完成批次触发多次重渲染；新增 `autoWakeSavingRef` + `pendingAutoWakePatchRef` 防丢片合并队列，确保快速连续点击预设或修改 `<input type="time">` 时平滑合并保存。

3. **Rust 后端单次文件解析与 Python 运行时探针缓存（[`src-tauri/src/identities/profile.rs`](src-tauri/src/identities/profile.rs)、[`src-tauri/src/identities/online.rs`](src-tauri/src/identities/online.rs)、[`src-tauri/src/identities/mod.rs`](src-tauri/src/identities/mod.rs)、[`src-tauri/src/identities/wakeup.rs`](src-tauri/src/identities/wakeup.rs)）**：
   - **`quota_ledger.json` 与 `quota_web_metadata.json` 单次读取解析**：在 `profile.rs` 中新增 `read_ledger_root` 与 `apply_parsed_ledger_to_summary`，在 `online.rs` 中新增 `read_metadata_root` 与 `apply_parsed_metadata`，将每次 `state_for` 与 `read_with_ledger` 调用中的磁盘读取、DACL 校验与 JSON 解析从 **`N + 2` 次（40 张卡即 42 次）收敛为 1 次**；`state_for(app, false)` 非会话读取路径不再扫描 `usage::observe_current`；
   - **Python 续杯运行时探针内存缓存**：在 `online.rs` 的 `wakeup_runtime_capability` 中增加按 `(脚本路径, 文件长度, 修改时间纳秒)` 键控的内存缓存 `verified_wakeup_runtime_cache()`，并在 `wakeup.rs` 的 `identities_wakeup_configure` 已处于启用且 `runtime == "available"` 状态时跳过重复探针，彻底消除每次点击自动续杯开关或时间预设时约 500ms 的 `python.exe` 冷启动阻塞。

### 2.2 `v0.3.1` 其他已交付特性（同批打包发布）
- **用量分析 2× 高清长图海报导出与模型等高排版（[`src/usage-screenshot.ts`](src/usage-screenshot.ts)、[`src/usage-statistics.tsx`](src/usage-statistics.tsx)、[`src/usage-trend.tsx`](src/usage-trend.tsx)、[`src/usage-model.ts`](src/usage-model.ts)）**：顶栏新增「📸 截图数据」/「📈 截图趋势」与「导出 ▾」菜单，纯前端 Canvas 2D 离线渲染 2× Retina 高清海报（自动应用邮箱脱敏且零网络上传）；三模型分布固定按 `Opus` → `Sonnet` → `Haiku` 排序并与趋势图等高对齐，悬停展示 `Effort 档位分布` 浮层。
- **净室切号设备指纹连续性（`s13`）与统一引导（[`src-tauri/src/cleaner_config.rs`](src-tauri/src/cleaner_config.rs)、[`src/cleaner-activity.tsx`](src/cleaner-activity.tsx)、[`src/identities.tsx`](src/identities.tsx)）**：跨号切换显式保留 `.claude.json` 中的 `userID`、`cachedGrowthBookFeatures` 与 `metricsStatusCacheByPrincipal`；操作进度条收拢为单行水平胶囊，待登录新身份卡与养号引导统一为结构化步骤卡片。

### 2.3 测试、打包审计、本机无感热更新与 GitHub Release `v0.3.1` 正式回执
- **自动化测试全绿**：
  - `bun test`：**185 pass, 0 fail**（26 个文件，14,193 次断言）；
  - `cargo test --manifest-path src-tauri/Cargo.toml --bin claude-local`：**315 passed, 0 failed**；
  - 核心合成 Python 测试（`test-audit-windows-package.py` 9、`test-runtime-resources.py` 2、`test-claude-quota-local.py` 34、`test-claude-quota-online.py` 35）：**80 passed, 0 failed**；
  - Playwright 合成 UI 测试：`--wakeup-only`（13 项检查）、`--quota-reset-only`（8 项检查）及 [`docs/screenshots/0.3.1/`](docs/screenshots/0.3.1/) 4 张中英文合成演示截图生成与元数据剥离全部通过。
- **源码冻结提交与 GitHub Actions CI**：
  - 发布标签 `v0.3.1` 固定于源码提交 [`fa1fedde2982bc123986ed70b8ca95fdeb56e18a`](https://github.com/yq04/Claude-Local/commit/fa1fedde2982bc123986ed70b8ca95fdeb56e18a)；
  - [Windows source checks (run `#42585468806`)](https://github.com/yq04/Claude-Local/actions/runs/42585468806) 对该精确提交执行全部前端、Rust、Python（101 项）与系统修改夹具检查，全部步骤通过。
- **中性环境 NSIS 安装包构建与 29 项隐私探针审计**：
  - [Claude-Local_0.3.1_x64-setup.exe](https://github.com/yq04/Claude-Local/releases/download/v0.3.1/Claude-Local_0.3.1_x64-setup.exe)：`140,896,139` 字节（约 `134.37 MiB`），SHA-256：`1551e85799f16bb7f6bfa8678d4e13f10e1efce2d85f3a41a10a7f786a7fc281`；
  - 未打包宿主 SHA-256：`9ca91cf3f9ff08fb42573f5efe27e46282c6a1fa187c63d8265c31819117b5c9`；NSIS 内宿主 SHA-256：`0579a61aa4886e34d7b22740a807719dc0a061c6abf843a55bafb00621285b66`（唯一差异为偏移 `13554682` 处 Tauri bundle sentinel `UNK` → `NSS` 3 字节转换）；
  - 109 个解包文件白名单校验与 29 项外置隐私探针扫描 **0 项发现（`findings = []`）**。
- **本机零中断无感热更新（`%LOCALAPPDATA%\Programs\Claude-Local`）**：
  - 经 `.local/tasks/20261109-release-0.3.1/deploy-audited.ps1 -Apply` 执行 `--quota-core` 管道冒烟测试、102 个应用文件逐一核验、8 个变更文件备份与原子替换；
  - 安装宿主 SHA-256 为 `0579a61aa4886e34d7b22740a807719dc0a061c6abf843a55bafb00621285b66`（与安装包内宿主完全一致），`0.3.1` 桌面窗口已在交互式会话启动，更新前后运行中的 `claude.exe` 会话零中断（`missingClaudeCount = 0`）。
- **GitHub Release `v0.3.1` 正式发布**：
  - [GitHub Release v0.3.1 (Latest)](https://github.com/yq04/Claude-Local/releases/tag/v0.3.1) 已于 `2026-11-09T08:35:54Z` 正式发布（非草稿、非预发布），安装包与 [`SHA256SUMS.txt`](https://github.com/yq04/Claude-Local/releases/download/v0.3.1/SHA256SUMS.txt) 的 GitHub 服务端 digest 与本地 SHA-256 完全一致。

---

## 3. 当前卡在哪

**当前没有任何技术阻塞、遗留缺陷或未完成任务。**

- `Claude-Local v0.3.1` 源码仓库、本机桌面端（`%LOCALAPPDATA%\Programs\Claude-Local`）与远端 GitHub Release 完全对齐；
- 工作区干净，仅保留用户规则要求不入库的 `AGENTS.md`（未暂存）与 Git 忽略的 `.local/` 私有目录。

---

## 4. 下一步计划是什么

新会话接手时无需执行任何收尾或补救动作，直接等待并响应用户的新指令即可：

1. **若用户提出后续功能开发、界面调整或日常维护需求**：
   - 先阅读目标模块目录下的 `CLAUDE.md` 与源文件头注释；
   - 遵循增量测试与「绝不中断运行中的 `claude.exe`」原则；
   - 若涉及新版本打包与本机无感热更新，直接复用 `scripts/build-windows-share.ps1` 与 `.local/tasks/20261109-release-0.3.1/deploy-audited.ps1` 标准流水线。
2. **若用户在会话中调用 `gemini-4-argon` 系列子代理**：
   - 直接通过 PowerShell 7 (`pwsh.exe`) 调用 `agy-safe.cmd`，单引号 Here-String 管道（`@' ... '@ | python -`）与 Magpie `"pace"` + `68%` 硬水位切号均已就绪。

---

## 5. 有哪些踩过的坑，绝对不要再踩

### 5.1 `Claude-Local` 性能、测试与打包部署铁律（必读）
1. **严禁在全屏容器上使用实时 SVG `<feTurbulence>` 滤镜或多层嵌套 `backdrop-filter: blur()`**：
   - 在 WebView2 高分屏与自定义壁纸下，全屏 `feTurbulence` 滤镜叠加遮罩层与弹窗多层 `backdrop-filter` 会导致打开模态窗或滚动列表时严重的 GPU 合成掉帧；
   - 毛玻璃模式下弹窗必须保持高不透明隔离表面（96%）与 `contain: paint` / `contain: content`，且弹窗关闭时不要在主树中挂载重型列表 DOM。
2. **严禁在 Rust `state_for` / `identities_read` 循环内逐卡重复读取解析 JSON 账本或冷启动外部进程**：
   - `quota_ledger.json` 与 `quota_web_metadata.json` 必须在循环外单次读取解析（`read_ledger_root` / `read_metadata_root`）后按内存引用分发给各张卡片；
   - 自动续杯的 Python 运行时能力探针必须通过 `verified_wakeup_runtime_cache()` 按 `(路径, 长度, mtime)` 缓存，切勿在用户每次点击开关或修改时间窗口时冷启动 `python.exe`。
3. **严禁中断任何正在运行的 `claude.exe`（Claude Code CLI）进程**：
   - 开发、测试与本机桌面端热更新期间，绝不能停止任何 `claude.exe`；热更新前必须记录 `claude.exe` 的 PID 与 `StartTime` 并在更新后核验 `missingClaudeCount == 0`。
4. **严守 `s13` 设备指纹连续性红线（[`src-tauri/src/cleaner_config.rs`](src-tauri/src/cleaner_config.rs)）**：
   - 切勿将 `userID`、`cachedGrowthBookFeatures`、`metricsStatusCacheByPrincipal`、`anonymousId`、`groveConfigCache` 加入 `ACCOUNT_KEYS` 的无条件删除列表，避免同机切换账号时频繁重置设备指纹。
5. **Rust 单元测试目标为 `--bin claude-local` 而非 `--lib`**：
   - 必须使用 `cargo test --manifest-path src-tauri/Cargo.toml --bin claude-local`（共 315 项测试）。
6. **Playwright 合成测试中的真实百分比格式与 Tauri Channel 回调契约**：
   - `QuotaWindow` 使用 `formatTruthfulPercent`（[`src/smart-relay-model.ts`](src/smart-relay-model.ts)），`99.0%`~`99.9%` 会保留一位小数（如 `1%` 已用显示为 `'99.0%'` 而非 `'99%'`），编写 UI 断言时需对齐；
   - 在 `@tauri-apps/api/mocks` 中模拟带 `onProgress` 的 Tauri 命令时，需兼容 `__CHANNEL__:<id>` 字符串并通过 `window.__TAURI_INTERNALS__.runCallback(id, {index, message})` 派发进度事件。
7. **伴生浏览器与持久化格式红线**：
   - 绝不将 `Claude-Local-Browser` 设为系统默认浏览器；保持 `BAGAID01`、`.baga`、SQLite `user_version=3`、账号 HMAC 与 `CCBaga` 种子域字符串不变；单账号跨机导入/导出（`.clpack` / `.bagapack`）已永久取消。
8. **Git、行尾符与 29 项隐私探针红线**：
   - 严禁暂存或提交 `AGENTS.md` 与 `.local/`；严禁在跟踪文件（包括 `scripts/test-*.ts` 截图路径）中写入本机绝对工作区路径（如 `D:/1_Research/...`）、真实账号、邮箱、代理凭据、进程 PID 或 29 项探针明文；
   - 提交前务必将修改的文本文件统一规范为 LF 行尾并通过 `.local/tasks/20261109-release-0.3.1/scan-source.py`（配合 `$env:TEMP\ClaudeLocalAudit-51238531c270496599ffbfee5d4b1d84.json`）扫描确认 `findings = []`；严禁使用 `git add .`、`git add -A`、`git clean`、`git reset --hard`。

### 5.2 本机 `Gemini 4 Argon` 子代理、Magpie 路由与 PowerShell 7 协同铁律（必读）
1. **Magpie 路由保持 `"routing": "pace"` + `"accountCaps": 68` + `"capCareful": true` + `"sink": true` + `firstToken` 超时熔断（`75`/`60`/`30`）**，切勿改回空字符串 `""` (`Smart`) 或纯 `"usage"` (`LeastUsed`)。
2. **子代理内部执行 Python 脚本必须使用 PowerShell 单引号 Here-String 管道（`@' ... '@ | python -`）**，切勿在命令行内联拼接多层转义双引号。

---

## 6. 关键文件与本地证据索引

### 公开文档与核心代码入口
- **发布与核验文档**：[`docs/RELEASE_NOTES_0.3.1.md`](docs/RELEASE_NOTES_0.3.1.md)、[`docs/RELEASE_VERIFICATION_0.3.1.md`](docs/RELEASE_VERIFICATION_0.3.1.md)、[`docs/RELEASE_NOTES_0.3.0.md`](docs/RELEASE_NOTES_0.3.0.md)、[`docs/RELEASE_VERIFICATION_0.3.0.md`](docs/RELEASE_VERIFICATION_0.3.0.md)、[`docs/RELEASE_POLICY.md`](docs/RELEASE_POLICY.md)、[`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md)。
- **本次性能优化与 `v0.3.1` 核心模块**：
  - 前端样式与 GPU 合成优化：[`src/style.css`](src/style.css)、[`src/identity-productivity.css`](src/identity-productivity.css)、[`src/usage-statistics.css`](src/usage-statistics.css)；
  - 前端渲染缓存、快照去重与海报导出：[`src/identities.tsx`](src/identities.tsx)、[`src/identity-online-quota.ts`](src/identity-online-quota.ts)、[`src/floating-monitor.tsx`](src/floating-monitor.tsx)、[`src/usage-screenshot.ts`](src/usage-screenshot.ts)、[`src/usage-statistics.tsx`](src/usage-statistics.tsx)、[`src/usage-trend.tsx`](src/usage-trend.tsx)、[`src/usage-model.ts`](src/usage-model.ts)、[`src/cleaner-activity.tsx`](src/cleaner-activity.tsx)；
  - Rust 后端单次解析与运行时探针缓存：[`src-tauri/src/identities/profile.rs`](src-tauri/src/identities/profile.rs)、[`src-tauri/src/identities/online.rs`](src-tauri/src/identities/online.rs)、[`src-tauri/src/identities/mod.rs`](src-tauri/src/identities/mod.rs)、[`src-tauri/src/identities/wakeup.rs`](src-tauri/src/identities/wakeup.rs)。

### 本机忽略目录与外部环境配置索引（严禁提交至 Git）
- `.local/artifacts/20261109T082243Z-1b99811ba5cf44c194c3b05b66516dfa/`：`v0.3.1` 安装包 `Claude-Local_0.3.1_x64-setup.exe`、`SHA256SUMS.txt`、`privacy-audit.json`、`resource-manifest.json`。
- `.local/tasks/20261109-release-0.3.1/`：
  - `artifact.json` / `source-commit.txt`：`v0.3.1` 构建与冻结源码哈希回执；
  - `deploy-audited.ps1` / `deployment-plan.json` / `deployment-receipt.json` / `deployment-backups/`：本机 102 文件核验、8 文件备份替换、交互式桌面启动及 `claude.exe` 零中断快照回执；
  - `github-release-receipt.json`：GitHub Release `v0.3.1` 服务端资产 digest 核验回执；
  - `HANDOFF-pre-v0.3.1-closeout.md.bak` / `HANDOFF-pre-session-end-20261109.md.bak`：`HANDOFF.md` 重写前备份与 SHA-256 校验记录。

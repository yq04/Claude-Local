<!--
[INPUT]: Final owner decisions, released v0.3.1 source/tag fa1fedde2982bc123986ed70b8ca95fdeb56e18a, passing release-source CI (run 42585468806), audited NSIS installer (SHA256 1551e85799f16bb7f6bfa8678d4e13f10e1efce2d85f3a41a10a7f786a7fc281), verified local payload deployment (host SHA256 0579a61aa4886e34d7b22740a807719dc0a061c6abf843a55bafb00621285b66, missingClaudeCount = 0), and 2026-11-09 Smart Relay / Auto-Wakeup frame-rate optimization & 2x Usage poster export.
[OUTPUT]: Context-free session handoff: what task we are doing, what is completed, where we are stuck (none), next steps, and verified pitfalls never to repeat.
[POS]: Root maintenance handoff. Real identities, emails, IP/proxy credentials, process IDs, browser seeds, private probe values, workstation paths and screenshots stay out of tracked files.
[PROTOCOL]: Back up and verify SHA256 before rewriting (backed up to .local/tasks/20261109-release-0.3.1/HANDOFF-pre-v0.3.1-closeout.md.bak, SHA256 BC1D2F49BC23EE40E029A375B589AF3722C0F6705C68DA5527EA933CE83A2CE0). This handoff update is documentation-only: no build/deploy, account action, proxy reload, upload or release-tag movement.
-->
# Claude-Local 会话交接（HANDOFF.md）

更新时间：2026-11-09，America/New_York（EST）。

## 接手先读：当前结论（30 秒速览）

1. **`Claude-Local v0.3.1` 产品优化、本机热更新与正式发布已 100% 完结**：
   - 针对用户反馈的「进入智能接力、自动续杯等弹窗页面很卡」问题，完成全链路排查与根因治理（GPU 合成层减负 + React 渲染缓存与按需挂载 + Rust IPC 单次读取 + Python 运行时探针缓存），并连同 `v0.3.1` 用量分析 2× 高清长图海报导出、净室切号 `s13` 设备指纹连续性与统一引导体验一起完成构建、审计、本机无感热更新（`missingClaudeCount = 0`）与 [GitHub Release v0.3.1 (Latest)](https://github.com/yq04/Claude-Local/releases/tag/v0.3.1) 正式发布。
2. **本机 `Gemini 4 Argon` 子代理慢速根因排查、Magpie 路由优化与全链路 PowerShell 7 (`pwsh.exe`) 默认化保持完好**：
   - Magpie 保持 `"routing": "pace"` + `"accountCaps": 68` + `"capCareful": true` + `"sink": true` + `firstToken` 超时熔断（`75s`/`60s`/`30s`）；Claude Code 子代理与 Antigravity 权限配置全面默认使用 **PowerShell 7 (`pwsh.exe` v7.6.8)**。
3. **接手阅读顺序**：
   - 先读本文、根目录 `AGENTS.md` 与 [`CLAUDE.md`](CLAUDE.md)；
   - 再读 [`docs/RELEASE_VERIFICATION_0.3.1.md`](docs/RELEASE_VERIFICATION_0.3.1.md) 与 [`docs/RELEASE_NOTES_0.3.1.md`](docs/RELEASE_NOTES_0.3.1.md)；
   - 修改任何模块前，先读对应目录的 `CLAUDE.md` 和目标源文件头部的 `[INPUT]/[OUTPUT]/[POS]` 注释。

---

## 1. 我们在做什么任务

### 1.1 本次会话核心任务：排查修复智能接力/自动续杯页面卡顿，完成本机热更新并正式发布 `v0.3.1`
1. **深度调研与定位卡顿根因**：查明并非电脑内存不足，而是 WebView2 下「全屏 SVG `feTurbulence` 实时分形噪声滤镜 + 三层毛玻璃 `backdrop-filter: blur()` 嵌套合成」叠加上「React 1s/15s 全树重算 + 弹窗关闭时仍挂载数百个隐藏 DOM 节点 + Rust 端 `N + 2` 次重复读取解析 `quota_ledger.json`/`quota_web_metadata.json` + 自动续杯每次点击重复冷启动 `python.exe` 探针」共同导致的 UI 帧率骤降与交互卡顿。
2. **完成前后端全链路优化与验证**：修复 CSS/GPU 合成、React 渲染与快照去重、Rust 单次文件解析与 Python 探针缓存，通过全套前端、Rust、Python 与 Playwright 合成测试。
3. **完成 `v0.3.1` 打包审计、本机零中断热更新与 GitHub Release 发布**：在独立中性目录构建 `Claude-Local_0.3.1_x64-setup.exe`，通过 109 文件白名单与 29 项外置隐私探针审计（`findings = []`），无感更新本机 `%LOCALAPPDATA%\Programs\Claude-Local`（零中断运行中的 `claude.exe`），并在 GitHub Actions CI 全绿后发布 `v0.3.1` (Latest)。

---

## 2. 已经完成了什么

### 2.1 `Claude-Local v0.3.1` 核心优化与正式交付回执（2026-11-09 完成）

1. **智能接力与自动续杯弹窗全链路防卡顿优化**：
   - **GPU 合成层减负（[`src/style.css`](src/style.css)、[`src/identity-productivity.css`](src/identity-productivity.css)）**：
     - 将 `--glass-noise-image` 全屏实时计算的 `<feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/>` SVG 滤镜置为 `none`，消除 `.app-sidebar` 与 `.workspace` 在弹窗动画和列表滚动时的全屏逐像素 CPU/GPU 滤镜重光栅化；
     - 移除模态遮罩 `.app-dialog-overlay` 的第二层 `backdrop-filter: blur(2px)`，为毛玻璃/自定义壁纸下的弹窗赋予 96% 高不透明隔离表面与 `contain: paint`，为 `.identity-wakeup-account-list` 和 `.identity-relay-account-list` 启用 `contain: content`（并为接力池列表增加 `max-height: 240px; overflow-y: auto`），弹窗开启期间自动暂停底层活跃卡片的 `clActiveCardAura` 无限阴影动画。
   - **React 渲染缓存、快照去重与按需挂载（[`src/identities.tsx`](src/identities.tsx)、[`src/identity-online-quota.ts`](src/identity-online-quota.ts)、[`src/floating-monitor.tsx`](src/floating-monitor.tsx)）**：
     - 在 `publishNativeWakeup` 中增加 JSON 序列化相等性去重（`nativeWakeupSerialized`），配合 Rust 侧 `wakeup.rs` 仅在 `changed == true` 时发射 `wakeup-scheduler-state` 事件，彻底消除后台 15 秒无变化轮询触发的全树重绘；
     - 将桌面态 `IdentityPanel` 的 `nowSec` 定时器从 `1s` 放宽至 `10s`（Playwright 合成测试态保持 `1s`），将 `floating-monitor.tsx` 时钟从 `1s` 放宽至 `15s`；
     - 对 `batchTargetInfo`、`currentTargetSetKey`、`staleQuotaTargets`、`currentQuota`、`bestSaved`、`relayAccounts`、`relayEval`、`relayPoolSummary`、`wakeupAccountRows` 与 `wakeableCount` 全面启用 `useMemo` 缓存，仅在 `onlinePanelOpen` / `relayPanelOpen` 为 `true` 时挂载弹窗内部重型列表 JSX，并通过 `adoptedTerminalBatchIdRef` 消除重开自动续杯弹窗时的重复快照接管，通过 `pendingAutoWakePatchRef` 支持快速点击配置时的防丢片合并保存。
   - **Rust 后端单次文件解析与 Python 探针缓存（[`src-tauri/src/identities/profile.rs`](src-tauri/src/identities/profile.rs)、[`src-tauri/src/identities/online.rs`](src-tauri/src/identities/online.rs)、[`src-tauri/src/identities/mod.rs`](src-tauri/src/identities/mod.rs)、[`src-tauri/src/identities/wakeup.rs`](src-tauri/src/identities/wakeup.rs)）**：
     - 新增 `read_ledger_root` / `apply_parsed_ledger_to_summary` 与 `read_metadata_root` / `apply_parsed_metadata`，将 `state_for` 与 `read_with_ledger` 中对 `quota_ledger.json` 和 `quota_web_metadata.json` 的磁盘读取与 JSON 解析从 `N + 2` 次收敛为每次调用仅 1 次；
     - 在 `wakeup_runtime_capability` 中增加按 `(脚本路径, 文件长度, 修改时间纳秒)` 键控的内存缓存 `verified_wakeup_runtime_cache()`，并在 `identities_wakeup_configure` 已处于启用且可用状态时跳过重复探针，彻底消除每次点击自动续杯开关或时间预设时约 500ms 的 `python.exe` 冷启动阻塞。
2. **用量分析 2× 高清长图海报导出、模型等高排版与净室 `s13` 设备指纹连续性**：
   - 新增 [`src/usage-screenshot.ts`](src/usage-screenshot.ts) 纯前端 Canvas 2D 2× Retina 海报渲染引擎（「📸 截图数据」/「📈 截图趋势」一键复制或下载 PNG），三模型分布固定按 `Opus` → `Sonnet` → `Haiku` 排序并与趋势图等高对齐，悬停展示 `Effort 档位分布` 浮层；
   - 净室切号保留 `userID`、`cachedGrowthBookFeatures` 与 `metricsStatusCacheByPrincipal`（`s13` 设备指纹连续性），操作进度收拢为单行胶囊，新身份与养号引导统一为结构化步骤卡片。
3. **测试、打包审计、本机零中断热更新与 GitHub Release `v0.3.1` 正式发布**：
   - `bun test`（185 pass / 0 fail，26 文件，14,193 次断言）、`cargo test --manifest-path src-tauri/Cargo.toml --bin claude-local`（315 pass / 0 fail）、80 项核心合成 Python 测试与 Playwright 合成 UI 测试（含 `--wakeup-only` 13 项、`--quota-reset-only` 8 项）全部通过；
   - 冻结源码提交 [`fa1fedde2982bc123986ed70b8ca95fdeb56e18a`](https://github.com/yq04/Claude-Local/commit/fa1fedde2982bc123986ed70b8ca95fdeb56e18a) 在 GitHub Actions [`Windows source checks` (run `#42585468806`)](https://github.com/yq04/Claude-Local/actions/runs/42585468806) 全部步骤通过；
   - 中性环境构建安装包 `Claude-Local_0.3.1_x64-setup.exe`（`140,896,139` 字节，SHA-256 `1551e85799f16bb7f6bfa8678d4e13f10e1efce2d85f3a41a10a7f786a7fc281`）通过 109 文件白名单与 29 项外置隐私探针审计（`findings = []`，未打包宿主 SHA-256 `9ca91cf3f9ff08fb42573f5efe27e46282c6a1fa187c63d8265c31819117b5c9`，NSIS 内宿主 SHA-256 `0579a61aa4886e34d7b22740a807719dc0a061c6abf843a55bafb00621285b66`，偏移 `13554682` 处 3 字节 `UNK` → `NSS`）；
   - 本机 `%LOCALAPPDATA%\Programs\Claude-Local` 已无感热更新至 `0.3.1`（102 文件逐一校验、8 个变更文件备份替换，安装宿主 SHA-256 `0579a61aa4886e34d7b22740a807719dc0a061c6abf843a55bafb00621285b66`，交互式窗口已启动，`missingClaudeCount = 0`）；
   - [GitHub Release v0.3.1 (Latest)](https://github.com/yq04/Claude-Local/releases/tag/v0.3.1) 已于 `2026-11-09T08:35:54Z` 正式发布，双资产服务端 digest 与本地 SHA-256 完全一致。

---

## 3. 当前卡在哪

**当前没有任何技术阻塞、遗留缺陷或未完成任务。**

- `Claude-Local v0.3.1` 代码库、本机桌面端与远端 GitHub Release 完全对齐；
- 工作区仅保留用户规则要求的 `AGENTS.md`（未暂存）与 Git 忽略的 `.local/` 私有目录。

---

## 4. 下一步计划是什么

新会话接手时无需执行任何收尾动作，直接响应用户的新需求即可：

1. **若用户提出后续版本新功能开发或日常维护**：
   - 先阅读目标模块目录下的 `CLAUDE.md` 与源文件头注释；
   - 遵循增量测试与“绝不中断运行中的 `claude.exe`”原则；
   - 打包与无感热更新可复用 `scripts/build-windows-share.ps1` 与 `.local/tasks/20261109-release-0.3.1/deploy-audited.ps1`。

---

## 5. 有哪些踩过的坑，绝对不要再踩

### 5.1 `Claude-Local` 性能、测试与打包部署铁律（必读）
1. **严禁在全屏容器上使用实时 SVG `<feTurbulence>` 滤镜或多层嵌套 `backdrop-filter: blur()`**：在 WebView2 高分屏与自定义壁纸下，全屏 `feTurbulence` 叠加遮罩层与弹窗多层 `backdrop-filter` 会导致打开模态窗或滚动列表时严重的 GPU 合成掉帧。毛玻璃模式下弹窗应使用高不透明表面（96%）与 `contain: paint` / `contain: content`。
2. **严禁中断任何正在运行的 `claude.exe`（Claude Code CLI）进程**：开发、测试与本机桌面端热更新期间，绝不能停止任何 `claude.exe`。
3. **严守 `s13` 设备指纹连续性红线（[`src-tauri/src/cleaner_config.rs`](src-tauri/src/cleaner_config.rs)）**：切勿将 `userID`、`cachedGrowthBookFeatures`、`metricsStatusCacheByPrincipal`、`anonymousId`、`groveConfigCache` 加入 `ACCOUNT_KEYS` 的无条件删除列表。
4. **Rust 单元测试目标为 `--bin claude-local` 而非 `--lib`**：必须使用 `cargo test --manifest-path src-tauri/Cargo.toml --bin claude-local`（共 315 项测试）。
5. **在线唤醒结果契约（[`scripts/claude_quota_online.py`](scripts/claude_quota_online.py)）**：`run_wakeup` 的 `confirmed_5h` 必须要求 `expired_reset_at is not None and reset_5h > expired_reset_at`。
6. **伴生浏览器与持久化格式红线**：绝不将 `Claude-Local-Browser` 设为系统默认浏览器；保持 `BAGAID01`、`.baga`、SQLite `user_version=3`、账号 HMAC 与 `CCBaga` 种子域字符串不变；单账号跨机导入/导出（`.clpack` / `.bagapack`）已永久取消。
7. **Git 与隐私红线**：严禁暂存或提交 `AGENTS.md` 与 `.local/`；严禁在跟踪文件中写入真实账号、邮箱、代理凭据、进程 PID、29 项探针明文或本机个人绝对路径；严禁使用 `git add .`、`git add -A`、`git clean`、`git reset --hard`。

### 5.2 本机 `Gemini 4 Argon` 子代理、Magpie 路由与 PowerShell 7 协同铁律（必读）
1. **Magpie 路由保持 `"routing": "pace"` + `"accountCaps": 68` + `"capCareful": true` + `"sink": true` + `firstToken` 超时熔断（`75`/`60`/`30`）**，切勿改回空字符串 `""` (`Smart`) 或纯 `"usage"` (`LeastUsed`)。
2. **子代理内部执行 Python 脚本必须使用 PowerShell 单引号 Here-String 管道（`@' ... '@ | python -`）**，切勿在命令行拼接多层转义双引号。

---

## 6. 关键文件与本地证据索引

### 公开文档与核心代码入口
- **发布与核验文档**：[`docs/RELEASE_NOTES_0.3.1.md`](docs/RELEASE_NOTES_0.3.1.md)、[`docs/RELEASE_VERIFICATION_0.3.1.md`](docs/RELEASE_VERIFICATION_0.3.1.md)、[`docs/RELEASE_NOTES_0.3.0.md`](docs/RELEASE_NOTES_0.3.0.md)、[`docs/RELEASE_VERIFICATION_0.3.0.md`](docs/RELEASE_VERIFICATION_0.3.0.md)、[`docs/RELEASE_POLICY.md`](docs/RELEASE_POLICY.md)、[`docs/DISTRIBUTION.md`](docs/DISTRIBUTION.md)。
- **本次性能优化与 `v0.3.1` 核心模块**：[`src/style.css`](src/style.css)、[`src/identity-productivity.css`](src/identity-productivity.css)、[`src/identities.tsx`](src/identities.tsx)、[`src/identity-online-quota.ts`](src/identity-online-quota.ts)、[`src/floating-monitor.tsx`](src/floating-monitor.tsx)、[`src/usage-screenshot.ts`](src/usage-screenshot.ts)、[`src/usage-statistics.tsx`](src/usage-statistics.tsx)、[`src-tauri/src/identities/profile.rs`](src-tauri/src/identities/profile.rs)、[`src-tauri/src/identities/online.rs`](src-tauri/src/identities/online.rs)、[`src-tauri/src/identities/mod.rs`](src-tauri/src/identities/mod.rs)、[`src-tauri/src/identities/wakeup.rs`](src-tauri/src/identities/wakeup.rs)。

### 本机忽略目录与外部环境配置索引（严禁提交至 Git）
- `.local/artifacts/20261109T082243Z-1b99811ba5cf44c194c3b05b66516dfa/`：`v0.3.1` 安装包 `Claude-Local_0.3.1_x64-setup.exe`、`SHA256SUMS.txt`、`privacy-audit.json`、`resource-manifest.json`。
- `.local/tasks/20261109-release-0.3.1/`：构建/部署/发布回执（`artifact.json`、`source-commit.txt`、`deployment-plan.json`、`deployment-receipt.json`、`github-release-receipt.json`）及 `HANDOFF.md` 重写前 SHA-256 备份（`HANDOFF-pre-v0.3.1-closeout.md.bak`）。

<!--
[INPUT]: Verified 0.3.0 delivery receipts, current repository state and the owner's final session-handoff request.
[OUTPUT]: Context-free task/status/next-step guide with exact delivery evidence and operational pitfalls.
[POS]: Repository root handoff; machine paths, PIDs, credentials and private probes stay in ignored .local/.
[PROTOCOL]: Archive this file and verify SHA256 before rewriting. Documentation-only commits never rebuild or move product tags.
-->
# Claude-Local 会话交接

更新日期：2026-10-24。本文件面向完全没有本会话上下文的新会话。先读本文、根目录 `AGENTS.md`、`CLAUDE.md`，修改具体模块前再读相应目录的 `CLAUDE.md` 和源码头部。

**当前事实：0.3.0 已完成全部源码提交、中性环境 NSIS 安装包打包、13 项私密探针审计、本机可回滚热更新及 GitHub `v0.3.0` 正式发布（过往所有历史 Release 与构建草稿已按用户要求清空，当前仅发布唯一安装包文件 `Claude-Local_0.3.0_x64-setup.exe`）。没有发布阻塞，也没有需要继续运行的构建、上传或子代理任务。用户最后只要求整理交接，不要自动再次构建、安装或发布。**

---

## 1. 我们在做什么任务

Claude-Local 是本仓库独立维护的 Windows x64 桌面产品，React/TypeScript 提供界面，Tauri/Rust 管理本机能力，Python 采集并写入额度账本。主程序 `claude-local.exe`，标识 `ai.local.claude-local`；伴生浏览器为 Claude-Local Browser。数据按用户保存在 `%APPDATA%/ai.local.claude-local`，普通启动不启动浏览器，只有用户动作或 `--browser` 才启动。

本会话承接 `0.2.4` 交付基线，按用户明确要求完成了四项核心升级与一次全链路深度排查修复，并交付 **`0.3.0`**：

1. **自定义本地壁纸与 5 层光学级毛玻璃视觉系统（方案 A 完整旗舰版）**：
   - 新增本地壁纸导入与主色调自动取色引擎（`src/wallpaper-store.ts`），支持 PNG / JPG / WebP / GIF 壁纸上传、Canvas 等比压缩（最长边 `<= 1920px`）与高饱和像素加权计算推荐强调色（`rgbToSuggestedAccent` / `sampleRgbaBufferForAccent`）。
   - 新增 Rust 原生外观与壁纸持久化模块（`src-tauri/src/ui_appearance.rs`），将 15 项 UI 外观偏好与自定义壁纸原子写入 `%APPDATA%\ai.local.claude-local\ui-appearance.json` 与 `ui-wallpaper.json`（上限 `6 MiB`，严格校验 Data URI MIME 头），并同步 Windows 原生窗口亮/暗色句柄主题。
   - 新增 5 套一键主题预设（羊皮纸经典、极光毛玻璃、落日琥珀玻璃、沙丘暖金玻璃、星云暗夜玻璃）、6 色强调色、5 种背景氛围及 3 维连续光学调校滑块（毛玻璃模糊度 `8px–40px`、面板不透明度 `45%–92%`、壁纸暗化遮罩 `0%–65%`）。
2. **当前活跃账号实时 Token/额度悬浮监控小窗（Floating Monitor HUD）**：
   - 新增 Tauri v2 独立置顶无边框透明悬浮窗模块（`src-tauri/src/monitor_window.rs`、`src/floating-monitor.tsx`、`src/floating-monitor-model.ts`、`src/floating-monitor.css`），由身份管理页顶栏「悬浮监控窗」按钮一键开关，窗口坐标持久化至 `%APPDATA%\ai.local.claude-local\monitor-window-state.json`。
   - 实时呈现当前活跃账号、CLI 运行状态脉冲灯（运行中 `2.5s` / 空闲 `8s` 自适应本地轮询，零后台网络请求）、5h/7d 双窗口剩余百分比与精确重置倒计时、窗口消耗速率（Burn Rate Pace）与预计耗尽时间（Exhaustion ETA）、以及今日输入/输出/缓存/推理 Token 明细与最近 5 分钟 `tok/m` 实时流速。
   - 支持主窗口（`"main"`）与悬浮窗（`"monitor"`）通过 `BroadcastChannel('claude-local:monitor-bus')` 及 `storage` 事件实时同步主题模式、6 色强调色、自定义壁纸、毛玻璃光学参数与中英双语切换。
3. **四维防封号与防风控安全加固**：
   - **进程探测零跨进程内存读取**：重构 `src-tauri/src/windows_process.rs`，对原生 `claude.exe` / `versions\X.Y.Z.exe` / `cowork-svc.exe` 仅使用 `PROCESS_QUERY_LIMITED_INFORMATION` 受限句柄（`Handle::open_limited`）并结合 `(pid, created)` 进程缓存（`CLAUDE_PROC_CACHE`），彻底消除 `PROCESS_VM_READ` 与 `ReadProcessMemory`，杜绝触发反作弊/EDR 遥测。
   - **官方 Claude Code CLI 协议头指纹与出口国家预检门禁**：更新 `scripts/claude_quota_online.py`，对齐真实 CLI 的 `User-Agent: claude-cli/<version> (external, cli)`、`anthropic-version: 2023-06-01`、`x-app: cli` 请求头；并在手动在线校准前通过同一代理请求 Cloudflare `https://www.anthropic.com/cdn-cgi/trace` 校验出口国家/地区（拦截 `CN` / `HK` / `MO` / `RU` / `BY` / `IR` / `KP` / `SY` / `CU`），严防直连或非支持地区 IP 触发账号封禁。
4. **开源竞品生产力交互体验升级**：
   - 身份工牌新增 5h/7d 额度消耗速率标签（偏快 / 平衡 / 充裕，`computeWindowPace`）；
   - 文件残留清理新增 5 类筛选胶囊（全部 / 缓存 / 认证 / 历史 / 备份）及实时单项计数；
   - CLI 维护页新增环境变量导出预览（PowerShell / Bash / JSON 三格式脱敏预览与一键复制）；
   - 用量分析页新增 4 维效率 KPI 摘要卡片（缓存命中节省比、输出/输入比、日均 Token、活跃模型数）；
   - 全局升级物理弹簧点击反馈、View Transitions API 平滑切换动画及 UI/等宽字体栈设置。

---

## 2. 已经完成了什么

### 2.1 当前用户可见行为

- **身份管理、本地额度同步与悬浮监控窗（HUD）**：
  - 身份页顶栏右侧提供「悬浮监控窗」切换按钮（带活跃脉冲圆点）、「同步本地额度」主按钮和「⋯」在线额度工具菜单。当前账号保持置顶，其余卡片按原生记录顺序显示（`180×286` 工牌，无搜索/排序控件）。
  - 展开身份卡片详情时，5h/7d 窗口除显示剩余/已用百分比与重置时间外，还根据已过窗口时间比例与消耗比例显示速率徽章（「速率偏快」琥珀色、「速率平衡」中性色、「余量充裕」翠绿色）。
  - 点击「悬浮监控窗」可随时打开或关闭 `320×236` 独立置顶无边框 HUD 小窗：支持任意拖拽、自动记忆屏幕坐标、一键刷新本地遥测、一键聚焦主窗口，并实时折射当前壁纸与毛玻璃参数。
- **自定义本地壁纸与 5 层光学级毛玻璃（`软件设置 -> 外观与布局`）**：
  - 顶部提供「5 套主题预设一键切换」（羊皮纸经典、极光毛玻璃、落日琥珀玻璃、沙丘暖金玻璃、星云暗夜玻璃）。
  - 支持亮色/暗色/跟随系统、6 色强调色（陶土橙、座舱蓝、翡翠绿、星云紫、绯红玫瑰、琥珀金）、工作区表面风格（座舱卡片 / 毛玻璃悬浮 / 纯净扁平）、背景氛围（纯净极简 / 极光弥散 / 落日余晖 / 深海流光 / 星云暗夜 / 自定义壁纸）。
  - 自定义壁纸区支持上传本地图片、预览缩略图与分辨率、一键应用从壁纸自动提取的推荐强调色、清除壁纸，并通过 3 条连续光学滑块实时调节毛玻璃模糊度（`8px–40px`）、面板不透明度（`45%–92%`）与壁纸暗化遮罩（`0%–65%`）。
  - 支持界面字体栈（系统默认 / Inter 现代无衬线 / 霞鹜文楷开源字体）、代码与数字等宽字体（Cascadia Mono / JetBrains Mono / 系统等宽）、界面缩放（`90%–110%`）与减少动画开关。
- **账号安全、防封号与环境防串号**：
  - 原生 `claude.exe` 进程检测仅使用 `PROCESS_QUERY_LIMITED_INFORMATION` 句柄并缓存 `(pid, created)`，零 `PROCESS_VM_READ`。
  - 手动在线校准请求严格携带官方 CLI 请求头指纹，并在请求前校验代理出口国家/地区。
  - 内置浏览器启动页遵循全局打码偏好；回环摘要支持 CLI 代理比对提醒；残留扫描只读检测系统级 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN` 环境变量覆盖告警。

### 2.2 各版本的关系

- `0.2.0`–`0.2.3`：实现统一在线额度编排、运行环境/代理约束、全库加密备份与救援、系统修改记录、手工交接载入导出、恢复本地同步默认值并移除身份页冗余搜索/排序。
- `0.2.4`：完成账号安全加固、`reset_inferred` 到期窗口额度显示与本地新消耗基线优化、Cockpit Tools 设置页胶囊 Tabs 对齐及左侧导航菜单升级。
- `0.3.0`（当前版本）：完成自定义本地壁纸与 5 层光学级毛玻璃视觉系统（含 Rust 原生持久化）、活跃账号实时 Token/额度悬浮监控窗（HUD）、四维防封号安全加固（零 `PROCESS_VM_READ`、CLI 协议头指纹、Cloudflare 出口国家预检）及生产力交互全面升级，并按用户要求清空过往历史 Release，仅发布单个 `Claude-Local_0.3.0_x64-setup.exe` 安装包。

### 2.3 `0.3.0` 交付基线与证据

- 产品源码提交和远端固定标签 `v0.3.0`：`4779be9cbf7d7a0924d28f5ae827bceb98aca480`。
- [GitHub 正式发布 v0.3.0 (Latest)](https://github.com/yq04/Claude-Local/releases/tag/v0.3.0) 已发布；过往 21 个历史 Release 与草稿标签均已清理完毕，当前 Release 仅包含唯一安装包资产 `Claude-Local_0.3.0_x64-setup.exe`（`140,444,345` 字节 / `133.94 MiB`）。
- 安装器 `Claude-Local_0.3.0_x64-setup.exe` SHA256：`2447d00a052efa820f429078aedbe1b79f09440fe9dbf873ab1b7ab5f6a98e29`（与 GitHub 服务端原生资产摘要 `sha256:2447d00a052efa820f429078aedbe1b79f09440fe9dbf873ab1b7ab5f6a98e29` 逐字节一致）。
- 宿主 `claude-local.exe` SHA256：`3cc7d435a0028f9e2523e83526f38090dededb1e39044a846344de1fcc465149`。
- 独立资源审计 109 项、私密探针 13 项，零发现（`findings: 0`）。本机 102 个安装文件核验通过，13 个变更文件先备份后替换。
- 更新后版本（`0.3.0`）、唯一主窗口句柄、Rust 额度核心（`--quota-core`）检查通过。更新前后未停止任何 `claude.exe` 或浏览器进程（`missingClaudeCount: 0`）。
- 私有回执与构建产物保存在忽略目录 `.local/`：`.local/last-local-update.json`、`.local/artifacts/20261024T101411Z-4584d22dd95d4d4589f53afd1dcf1b6b/`、`.local/release-0.3.0/`。实际安装路径和回滚备份从 `.local/last-local-update.json` 读取，不硬编码进文档或 Git。

### 2.4 已执行的验证

- **前端、壁纸引擎与跨窗口同步单元测试**：`bun test` **21 个测试文件、106 项测试（9,370 断言）全部通过**；`bun run build`（`tsc --noEmit && vite build`）与 `python scripts/browser_ui.py dist` 零错误通过。
- **窗口与侧栏多分辨率几何巡检**：`node scripts/test-usage-statistics.mjs --layout-only`（调用 `scripts/window-layout-checks.mjs`，覆盖 `760×640`、`1040×720`、`1440×900` 下的中英双语及 `classic`/`compact` 侧栏模式，**96 项布局断言全部通过**）与 `--quick-only`（16/16）全部通过。
- **身份与额度 UI 专项回归**：`node --experimental-strip-types scripts/test-identities-ui.ts` 的 `--online-only`（10/10）、`--quota-reset-only`（6/6）、`--cards-only`（26/26）、`--passive-only`（1/1）全部通过；`node scripts/test-local-shell.mjs` 通过（`errors: []`）。
- **Python 与 Rust 原生测试**：`test-claude-quota-online.py`（31/31，含 CLI 指纹与 Cloudflare 出口国家门禁）、`test-claude-quota-local.py`（34/34）、`test-audit-windows-package.py`（9/9）、`test-runtime-resources.py`（2/2）、`test-quota-archive.py`（6/6）、`test-quota-runtime.py`（3/3）及 Rust `monitor_window`（3/3）、`ui_appearance`（4/4）、`local_edition_tests`、`exact_arguments`、`passive_quota_revision` 全部通过（0 warnings）。

---

## 3. 当前卡在哪、遗留什么、设计偏差

**没有交付阻塞。用户授权的 `0.3.0` 全部功能研发、深度排查修复、本地热更新、NSIS 安装包打包、过往 Release 清理与 GitHub 上传均已完成；本次仅收尾交接文档。** 没有需要继续等待的后台脚本或子代理，也不需要再次确认发布。

保留以下实际边界，不要为了“清零待办”冒险操作：

- **本地无感热更新 vs 安装器全流程验收**：本机采用审计后的文件替换热更新（`.local/tools/complete-local-update-0.3.0.ps1`），没有在用户机器上直接运行 NSIS 安装器或卸载器。安装、升级、卸载和系统设置的实际修改验收只在一次性 Windows 环境执行。
- **悬浮监控窗零网络轮询边界**：悬浮监控窗（`?window=monitor`）与主窗口的身份页一样，100% 仅读取本地账本（`quota_ledger.json`、`quota_web_metadata.json`）与 `~/.claude/projects` JSONL 本地流式文件，绝不自动发起任何 OAuth 后台网络轮询，确保零封号风险。
- **代理协议边界**：Python 额度校准代理仅支持当前明确实现的无认证 HTTP CONNECT；不支持的 HTTPS 代理、SOCKS 或代理认证会明确拒绝，禁止静默回退直连。
- **全库备份边界**：备份/救援恢复到新的私有副本，不自动激活或合并当前身份库；不包含未保存当前 CLI 内容或浏览器资料。
- **工作树保留边界**：当前工作分支为 `feature/functional-reliability-20261023`，同时已非强制推送到远端 `main`。保留用户已有的 `AGENTS.md` 修改及未跟踪的 `--help/`、`.planning/`、`.rivet/`、`docs/superpowers/`、`docs/plans/2026-10-22-identity-quota.md`、`p6b-i18n.json`、`TOKEN_MONITOR_RESEARCH_AND_PLAN.md`，不要顺手提交或删除。

---

## 4. 下一步计划是什么与代码入口

1. **新会话启动检查**：先只读查看 `git status`、最近提交、版本清单、最终回执（`.local/last-local-update.json`）和用户最新反馈。远端 tag 可用 `git ls-remote --tags origin refs/tags/v0.3.0` 核对。
2. **无新需求则保持静默已交付状态**：当前 `0.3.0` 已完整交付。若用户继续提出新需求或反馈，按改动范围精准修改并运行对应验证。
3. **未来新版本发布规范**：若未来需要发布 `0.3.1` 或 `0.4.0`，延续用户在本会话确立的精简 Release 规范——使用 `.local/tools/complete-local-update-<ver>.ps1` 完成中性环境构建、13 项探针审计与本机热更新，并在 GitHub Release 中**仅上传 `Claude-Local_<ver>_x64-setup.exe` 安装包文件**，不要上传其它附属文件。

核心源码入口：
- `src/floating-monitor.tsx`、`src/floating-monitor-model.ts`、`src/floating-monitor.css`、`src-tauri/src/monitor_window.rs`：独立置顶 Token/额度悬浮监控窗（HUD）、自适应本地轮询、消耗速率/ETA 计算与跨窗口状态同步。
- `src/wallpaper-store.ts`、`src/settings.tsx`、`src/settings-model.ts`、`src/style.css`、`src-tauri/src/ui_appearance.rs`：自定义本地壁纸上传压缩、主色调自动取色、5 层光学毛玻璃滑块与 Rust 原生持久化。
- `src-tauri/src/windows_process.rs`、`scripts/claude_quota_online.py`：零 `PROCESS_VM_READ` 进程探测与 `(pid, created)` 缓存、官方 CLI 请求头指纹对齐与 Cloudflare `/cdn-cgi/trace` 出口国家门禁。
- `src/identities.tsx`、`src/identity-quota.ts`、`src-tauri/src/identities/profile.rs`、`scripts/claude_quota.py`：身份工牌、本地额度同步、5h/7d 消耗速率徽章与 `reset_inferred` 到期恢复展示。
- `src/claude-residue-panel.tsx`、`src/claude-cli-panel.tsx`、`src/usage-statistics.tsx`：残留分类筛选胶囊、CLI 环境变量三格式脱敏导出预览、用量分析 4 维效率 KPI 卡片。

常用针对性验证命令（按修改范围选择执行）：

```powershell
bun test
bun run build
python scripts/test-claude-quota-online.py
python scripts/test-claude-quota-local.py
node --experimental-strip-types scripts/test-identities-ui.ts --quota-reset-only
node --experimental-strip-types scripts/test-identities-ui.ts --cards-only
node scripts/test-usage-statistics.mjs --layout-only
cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol monitor_window
cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol ui_appearance
```

---

## 5. 踩过的坑：绝对不要再踩

1. **不要对原生 `claude.exe` 使用 `PROCESS_VM_READ` 或 `ReadProcessMemory`。**
   - 原生 `claude.exe`、`versions\X.Y.Z.exe`、`cowork-svc.exe` 仅需 `PROCESS_QUERY_LIMITED_INFORMATION` 句柄（`Handle::open_limited`）读取进程映象路径和创建时间，并结合 `CLAUDE_PROC_CACHE` 按 `(pid, created)` 缓存结果。只有 `node.exe` / `bun.exe` 等脚本宿主进程才按需读取 PEB 命令行参数以区分是否为 Claude CLI。
2. **不要在后台自动轮询 Anthropic OAuth API，手动校准必须对齐 CLI 指纹并通过出口国家预检。**
   - 任何高频或非官方 User-Agent 的 OAuth 请求及非支持地区 IP 极易触发 Anthropic 风控封号。悬浮监控窗必须保持 100% 纯本地文件读取；手动在线校准（`scripts/claude_quota_online.py`）必须携带 `claude-cli/<ver> (external, cli)`、`anthropic-version: 2023-06-01`、`x-app: cli` 并通过 `_verify_exit_country()` 门禁。
3. **主窗口与悬浮监控窗（`"main"` ↔ `"monitor"`）运行在独立 WebView 上下文，修改外观/壁纸/语言必须走跨窗口同步。**
   - 两个窗口共享同一 `localStorage`，但内存中的 React `useSyncExternalStore` 状态各自独立。修改 `src/settings-model.ts`、`src/wallpaper-store.ts` 或 `src/language-switch.tsx` 时，必须保持 `BroadcastChannel('claude-local:monitor-bus')` 广播与 `window.addEventListener('storage', ...)` 监听，确保主窗口切换主题、壁纸、毛玻璃滑块或语言时，已打开的悬浮窗即时同步。
4. **`src/floating-monitor.css` 必须严格使用 `src/style.css` 定义的 CSS 变量名。**
   - 主样式表使用的是 `--foreground`、`--muted-foreground`、`--panel`、`--card-elevated`、`--background`、`--shell-bg`、`--local-accent`、`--local-accent-soft`、`--border`，而非 `--text` 或 `--surface`。新增组件样式时务必对齐 `src/style.css` 的变量体系，确保 6 色强调色、亮暗模式与 5 层光学毛玻璃折射在所有窗口一致生效。
5. **双语 YAML 字典与源码 `t('...')` 调用受 `src/i18n.test.ts` 严格门禁保护。**
   - 任何新增或修改的 `t('key', ...)` 必须在 `src/locales/zh.yaml` 和 `src/locales/en.yaml` 中同时存在且插槽一致（例如平衡速率键名为 `quota.paceBalanced`），否则 `src/i18n.test.ts` 会立即失败。
6. **GitHub Release 保持干净，只上传单个安装包文件。**
   - 用户已明确要求清理过往杂乱的 Release，并且发布新版本时**只上传 `Claude-Local_<ver>_x64-setup.exe` 安装包文件**，不要上传 `source.zip`、`SHA256SUMS.txt`、`privacy-audit.json`、`resource-manifest.json` 等其它附属文件。
7. **不要擅自恢复身份页已移除的冗余控件，遵守左侧导航栏与窄窗口几何门禁。**
   - 身份页保持干净工牌列表与右上角按钮，不恢复搜索框或排序下拉框。
   - `src/navigation.test.ts` 要求 8 个中文导航标题严格保持四字；`scripts/window-layout-checks.mjs` 要求经典侧栏宽度 `<= 196px`、紧凑侧栏宽度 `== 72px`、导航文字零截断且 `760×640` 窄窗口零横向溢出。
8. **不终止 `claude.exe`，不清理共享工作树，敏感探针不入对话或 Git。**
   - 本机热更新只允许对精确路径及启动时间匹配的 `claude-local.exe` 备份后重启，失败回滚；绝不停止正在运行的 `claude.exe` 或浏览器进程。
   - 保留用户 `AGENTS.md` 修改与未跟踪目录；13 项私密探针值与本机个人安装路径不输出到对话或提交至 Git。
   - 每次改写 `HANDOFF.md` 前先归档至 `.local/` 并校验 SHA256；交接文档使用独立 `[skip ci]` 提交，不重建、不动产品标签 `v0.3.0`。

---

## 6. 需要历史细节时再读这些文件

- [0.3.0更新说明](docs/RELEASE_NOTES_0.3.0.md)、[0.2.4更新说明](docs/RELEASE_NOTES_0.2.4.md)、[0.2.3更新说明](docs/RELEASE_NOTES_0.2.3.md)、[0.2.2更新说明](docs/RELEASE_NOTES_0.2.2.md)、[0.2.1额度恢复](docs/QUOTA_RECOVERY_0.2.1.md)：用户可见行为与历次升级原因。
- [0.2.0更新说明](docs/RELEASE_NOTES_0.2.0.md)、[0.2.0交付核验](docs/RELEASE_VERIFICATION_0.2.0.md)：早期功能实施和分发边界。
- [开发说明](docs/DEVELOPMENT.md)、[分发与许可](docs/DISTRIBUTION.md)、`LICENSE`、`NOTICE.md`：独立产品、构建和第三方许可约束。不存在上游同步、自动公开发布或官方更新源。

本次交接整理只修改文档，不修改程序、用户数据或发布内容。下一会话首先承接用户的新需求，而不是继续已经完成的发布。

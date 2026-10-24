<!--
[INPUT]: Verified 0.3.0 delivery receipts, current repository state and the owner's final session-handoff request.
[OUTPUT]: Context-free task/status/next-step guide with exact delivery evidence and operational pitfalls.
[POS]: Repository root handoff; machine paths, PIDs, credentials and private probes stay in ignored .local/.
[PROTOCOL]: Archive this file and verify SHA256 before rewriting. Documentation-only commits never rebuild or move product tags.
-->
# Claude-Local 会话交接

更新日期：2026-10-24。本文件面向完全没有本会话上下文的新会话。先读本文、根目录 `AGENTS.md`、`CLAUDE.md`，修改具体模块前再读相应目录的 `CLAUDE.md` 和源码头部。

**当前事实：`0.3.0` 已完成全部功能研发、两轮全链路深度问题修复与防封升级、中性环境 NSIS 安装包打包、13 项私密探针全量解包审计、本机可回滚热更新及 GitHub `v0.3.0` 正式发布（过往所有历史 Release 与构建草稿已按用户要求清空，当前仅发布唯一安装包文件 `Claude-Local_0.3.0_x64-setup.exe`）。没有发布阻塞，也没有需要继续运行的构建、上传或子代理任务。用户最后只要求整理交接，不要自动再次构建、安装或发布。**

---

## 1. 我们在做什么任务

Claude-Local 是本仓库独立维护的 Windows x64 桌面产品，React/TypeScript 提供界面，Tauri/Rust 管理本机能力，Python 采集并写入额度账本。主程序 `claude-local.exe`，标识 `ai.local.claude-local`；伴生浏览器为 Claude-Local Browser。数据按用户保存在 `%APPDATA%/ai.local.claude-local`，普通启动不启动浏览器，只有用户动作或 `--browser` 才启动。

本会话承接 `0.2.4` 交付基线，按用户要求完成了 **`0.3.0` 旗舰能力建设** 以及 **两轮针对实机体验、防封深度与界面精简的全面排查优化**：

### 1.1 `0.3.0` 核心新增能力
1. **自定义本地壁纸与 5 层光学级毛玻璃视觉系统**：
   - 本地壁纸导入与主色调自动取色引擎（`src/wallpaper-store.ts`），支持图片 Canvas 等比压缩与高饱和像素加权计算推荐强调色（`rgbToSuggestedAccent`）。
   - Rust 原生外观与壁纸持久化（`src-tauri/src/ui_appearance.rs`），将 UI 外观偏好与自定义壁纸原子写入 `%APPDATA%\ai.local.claude-local\ui-appearance.json` 与 `ui-wallpaper.json`，并同步 Windows 原生窗口亮/暗色句柄主题。
   - 5 套一键主题预设、6 色强调色、5 种背景氛围及 3 维连续光学调校滑块（毛玻璃模糊度 `8px–40px`、面板不透明度 `45%–92%`、壁纸暗化遮罩 `0%–65%`）。
2. **当前活跃账号实时 Token/额度悬浮监控小窗（Floating Monitor HUD）**：
   - 独立置顶无边框透明悬浮窗模块（`src-tauri/src/monitor_window.rs`、`src/floating-monitor.tsx`、`src/floating-monitor-model.ts`、`src/floating-monitor.css`），由身份管理页顶栏「悬浮监控窗」按钮一键开关，坐标持久化至 `%APPDATA%\ai.local.claude-local\monitor-window-state.json`。
   - 对齐 Token Monitor 紧凑桌面看板风格（`340×278` 展开 / `340×152` 精简），100% 纯本地只读遥测（零后台网络请求），展示当前账号 5h/7d 双槽进度、7d 消耗步调刻度、实时速率（`tok/m`）、燃烧速率与触顶预警、缓存命中率及 200k 上下文水位。
   - 主窗口（`"main"`）与悬浮窗（`"monitor"`）通过 `BroadcastChannel('claude-local:monitor-bus')` 及 `storage` 事件实时同步主题、壁纸、毛玻璃参数、打码偏好与双语切换。
3. **四维防封号与内置浏览器深度联机体检体系**：
   - **进程探测零跨进程内存读取**：`src-tauri/src/windows_process.rs` 对原生 `claude.exe` / `versions\X.Y.Z.exe` / `cowork-svc.exe` 仅使用 `PROCESS_QUERY_LIMITED_INFORMATION` 受限句柄并结合 `(pid, created)` 缓存，彻底消除 `PROCESS_VM_READ`。
   - **官方 CLI 协议头指纹与出口国家预检门禁**：`scripts/claude_quota_online.py` 对齐 `claude-cli/<version> (external, cli)` 请求头，并在手动在线校准前通过 Cloudflare `/cdn-cgi/trace` 校验出口国家/地区。
   - **内置浏览器深度防封探针与 9 项全绿闭环**（`src/browser-model.ts`、`src/browser-network.ts`、`src/browser-verification.ts`、`src/browser-start.tsx`、`src-tauri/src/browser/network.rs`）：
     - 提取出口 ASN 与 `hosting` 标记并实现 `classifyExitIsp`，自动识别 AWS / GCP / DigitalOcean / Vultr / Choopa / Hetzner / OVH / M247 / Contabo / 阿里云 / 腾讯云等高危 IDC 机房出口，区分 `ISP 宽带 / 原生特征` 与 `IDC 机房 / 高风控`。
     - 新增本地实时无外网探针：`probeWebRtcLeak()`（校验 ICE 候选无公网/内网 IP 泄漏）、`probeGraphics()`（校验 `UNMASKED_RENDERER_WEBGL` 真实硬件 GPU 并拦截 `SwiftShader` / `llvmpipe` 软件渲染）、`navigator.webdriver === false` 反自动化特征及 `navigator.languages` 次选语言无中文残留检查。
     - 将浏览器实测上报的 `graphics_ok`、`webgl_renderer`、`webdriver`、`webrtc_ok` 接入 `src-tauri/src/browser/network.rs` 的第 8 项「真实图形与字体」与第 9 项「DNS / WebRTC 泄漏」，使主界面 **9 项检测在实测通过后全部变绿（`✓`）**。
     - 新增 **「第三方防封深度体检」** 专区（集成防封教程常用的 `Ping0.cc`、`CheckCC.org`、`BrowserScan`、`IPHey` 四大站点及达标判据：在隔离浏览器起始页支持一键打开检测与复制网址，在主窗口保持纯复制网址）。

### 1.2 两轮实机问题排查与体验精简（全部已解决）
1. **CPAMC 风格静态 `5h` 重置显示**：
   - 当前一次 5h 窗口已过重置时间（`reset_inferred`）且尚未开启新会话时，不再显示冗余的“预计已恢复”或“已恢复满额”，而是直接显示静态时钟与 **`5h`**（卡片左下角 `<时钟图标> 5h`，悬浮窗 `· 5h`），该数值不随时间递减，直至该账号登录 Claude 开始新一轮计时。
2. **悬浮监控窗（HUD）无法弹出修复**：
   - 修复了 Tauri v2 在 Windows WebView2 UI 线程同步调用 `WebviewWindowBuilder::build()` 引发的死锁（将 `src-tauri/src/monitor_window.rs` 命令全部改为 `pub async fn`），并在 `src-tauri/capabilities/main.json` 的 `"windows"` 列表中加入 `"monitor"` 授予 IPC 权限。
3. **用量分析卡死、身份管理空白、「昨天」统计与移除兜底卡片**：
   - 修复了 `src-tauri/src/identities/usage.rs` 中 `usage_statistics_read` 长时间持有全局 `identities::lock()` 导致阻塞 `identities_read` 的锁竞争问题（拆分独立 `USAGE_LOCK` 并在读快照后立即释放短锁）。
   - 在 `src/usage-model.ts`、`src/usage-statistics.tsx`、`src-tauri/src/identities/usage.rs` 中新增 **「昨天」（`yesterday`）** 统计时段；删除了「未归属历史兜底归属」UI 卡片，当未配置兜底账号时自动默认归属给首个可用账号。
4. **「同步本地额度」多账号失败修复**：
   - 修复了 `scripts/quota_archive.py` 中 `tar.exe` 因部分 `.baga` 归档缺少可选 `data/2`（`.claude/projects`）槽位且 stderr 超过 8KB 导致的管道截断报错；修复了 `scripts/claude_quota.py` 与 `src-tauri/src/identities/profile.rs` 中 `#identity` 账本槽位合并与缓存逻辑。
5. **Claude Code CLI 更新可靠性加固**：
   - 重构 `scripts/claude-cli.ps1`（引入 `InvokeExternal` 防止 PowerShell `$ErrorActionPreference = 'Stop'` 将 CLI stderr 进度输出误判为异常、在子进程内局部注入 `DISABLE_AUTOUPDATER='1'`、更新后自动调用 `CleanNativeLeftovers` 清理 `.staging`/`.tmp`/`.old` 残留），并在 `src-tauri/src/claude_cli.rs` 中透传配置的代理环境变量。
6. **全软件标签与文案精简**：
   - 清理了身份管理、悬浮监控窗、残留清理、CLI 面板、用量分析、浏览环境、电脑环境与软件设置中多余的口号式徽章、副标题与重复解释段落，在零歧义的前提下保持界面干净利落。

---

## 2. 已经完成了什么

### 2.1 当前用户可见行为
- **身份管理与 CPAMC 风格额度展示**：
  - 身份页顶栏右侧提供「悬浮监控窗」切换按钮、「同步本地额度」主按钮和「⋯」在线额度工具菜单。`180×286` 紧凑工牌展示 5h/7d 进度条与 7d 步调刻度；5h 到期恢复后直接显示静态 `<时钟图标> 5h`。
  - 点击额度区域弹出的「额度详情」弹窗精简为：顶部 5h/7d 双卡（含上次重置时间与已过时长 `上次重置 14:00（20m前）`）、单行「已于 X前 重置 · 在线校准额度」快捷动作条与底部紧凑订阅信息。
- **独立置顶桌面悬浮监控窗（HUD）**：
  - 点击「悬浮监控窗」立即在屏幕右上角弹出 `340×278` 无边框透明毛玻璃 HUD 小窗，支持拖拽、置顶锁定、精简/展开切换与一键刷新。
- **内置浏览器 9 项全闭环核验与第三方防封深度体检**：
  - 打开内置浏览器实测后，除核验出口国家、时区、语言、设备/CPU、定位外，自动实测 **出口 IP 属性（拦截 IDC 机房）**、**语言列表纯净度（拦截次选中文残留）**、**WebRTC 泄漏防护**、**反自动化特征（`webdriver`）** 与 **硬件图形渲染（WebGL）**，并回传主程序使 **全部 9 项检测变为绿色 `✓`**。
  - 内置浏览器实测页底部提供 `Ping0.cc`、`CheckCC.org`、`BrowserScan`、`IPHey` 达标判据与一键打开/复制；主程序「浏览环境」页底部提供一键复制网址。
- **用量分析**：
  - 支持 **今天 / 昨天 / 近7天 / 近30天 / 全部** 五档时间范围与账号筛选，切换流畅不阻塞身份管理页，未绑定历史自动归属默认账号。

### 2.2 `0.3.0` 最新交付基线与证据
- 产品源码最新提交：`09f3a11`（已推送到远端 `main`、`feature/functional-reliability-20261023` 与标签 `v0.3.0`；本文档更新将在其之上追加一个独立的 `docs(handoff): ... [skip ci]` 提交）。
- [GitHub 正式发布 v0.3.0 (Latest)](https://github.com/yq04/Claude-Local/releases/tag/v0.3.0) 已更新；当前 Release 仅包含唯一安装包资产 `Claude-Local_0.3.0_x64-setup.exe`（`140,387,841` 字节 / `133.88 MiB`）。
- 安装器 `Claude-Local_0.3.0_x64-setup.exe` SHA256：`c6f65f1374652be44e751ab8467ca13ab8b6cf6b843e4aed642bab239a5ba796`（与 GitHub Release 资产摘要 `sha256:c6f65f1374652be44e751ab8467ca13ab8b6cf6b843e4aed642bab239a5ba796` 完全一致）。
- 宿主 `claude-local.exe` SHA256：`456b67e2eda3f243c36148d76df3558b8bbe644894171d3c65cdf850cfdff4bf`。
- 独立资源审计 109 项、私密探针 13 项，零发现（`findings: 0`）。本机 102 个安装文件核验通过，变更文件先备份后原子替换。
- 更新后版本（`0.3.0`）、唯一主窗口句柄、Rust 额度核心（`--quota-core`）检查通过。更新前后未停止任何 `claude.exe` 或浏览器进程（`missingClaudeCount: 0`）。
- 私有回执与构建产物保存在忽略目录 `.local/`：`.local/last-local-update.json`、`.local/artifacts/20261024T194134Z-ae15430dbf7e4f698cd255dd51cf6ac4/`。

### 2.3 已执行的验证
- **前端、壁纸引擎、深度防封核验与双语字典测试**：`bun test` **21 个测试文件、108 项测试（9,429 断言）全部通过**；`bun run build`（`tsc --noEmit && vite build`）零错误通过。
- **窗口与侧栏多分辨率几何巡检**：`node scripts/test-usage-statistics.mjs .local/preview-usage`（39 组全量交互断言）、`--quick-only`（16/16）与 `--layout-only`（覆盖窄/默认/宽窗口下的中英双语及 `classic`/`compact` 侧栏模式，**96/96 项布局断言全部通过**）。
- **身份与额度 UI 专项回归**：`node --experimental-strip-types scripts/test-identities-ui.ts` 的 `--quota-reset-only`（6/6，含静态 `5h` 重置验证）与 `--cards-only`（26/26）全部通过。
- **Python 与 Rust 原生测试**：`test-claude-quota-local.py`（34/34）、`test-quota-archive.py`（7/7）、`test-windows.py`（25/25）及 Rust `browser::tests`（18/18，含 `deep_probes_close_graphics_and_webrtc_checks`）、`identities::usage_tests`、`monitor_window`、`ui_appearance` 全部通过。

---

## 3. 当前卡在哪、遗留什么、设计偏差

**没有交付阻塞。用户提出的全部问题、UI 精简、CPAMC `5h` 静态重置显示、内置浏览器深度防封升级、本地热更新、NSIS 安装包审计打包与 GitHub Release 上传均已全部完成；本次仅收尾交接文档。** 没有需要继续等待的后台脚本或子代理，也不需要再次触发构建或发布。

保留以下产品与工程边界，不要误判为未完成问题：
- **本地无感热更新 vs 安装器全流程验收**：本机采用审计后的文件替换热更新（`.local/tools/complete-local-update-0.3.0.ps1`），不在用户机器上直接运行 NSIS 安装器或卸载器。
- **主程序外链复制边界**：按 `AGENTS.md` 规定，主程序窗口（如 `src/browser.tsx`、`src/vps.tsx`）对外部站点保持纯复制网址（Copy-only），不自动调用系统浏览器打开外链；而在内置隔离指纹浏览器内部的实测起始页（`src/browser-start.tsx`）中，允许用户在当前隔离环境内一键打开第三方体检标签页或复制网址。
- **悬浮监控窗零网络轮询边界**：悬浮监控窗（`?window=monitor`）100% 仅读取本地账本与 JSONL 会话流文件，绝不自动发起任何 OAuth 后台网络请求。
- **工作树保留边界**：当前工作分支为 `feature/functional-reliability-20261023`，同时已同步推送到远端 `main`。保留用户已有的 `AGENTS.md` 修改及未跟踪的 `--help/`、`.planning/`、`.rivet/`、`docs/superpowers/`、`docs/plans/2026-10-22-identity-quota.md`、`p6b-i18n.json`、`TOKEN_MONITOR_RESEARCH_AND_PLAN.md`，不要顺手提交或删除。

---

## 4. 下一步计划是什么与代码入口

1. **新会话启动检查**：先只读查看 `git status`、最近提交、最终回执（`.local/last-local-update.json`）和用户最新指令。
2. **无新需求则保持静默已交付状态**：当前 `0.3.0` 已完整交付。若用户提出新需求或反馈，按改动范围精准修改并运行对应验证。
3. **本机更新与发布标准流程**：当需要再次更新本机安装与打包时，运行 `.local/tools/complete-local-update-0.3.0.ps1 -InstallDirectory 'D:\1_app\Claude-Local'` 完成中性目录构建、13 项隐私探针解包审计与热更新，随后使用 `gh release upload v0.3.0 <installer> --clobber` 仅上传单个 `Claude-Local_0.3.0_x64-setup.exe` 安装包。

核心源码入口：
- `src/identities.tsx`、`src/identity-quota.ts`、`src-tauri/src/identities/profile.rs`、`scripts/claude_quota.py`、`scripts/quota_archive.py`：身份工牌、CPAMC 静态 `5h` 重置显示、7d 消耗步调刻度、`.baga` 归档容错解压与本地额度同步。
- `src/browser-model.ts`、`src/browser-network.ts`、`src/browser-verification.ts`、`src/browser-start.tsx`、`src/browser.tsx`、`src-tauri/src/browser/network.rs`：内置浏览器 ASN/ISP/IDC 机房纯净度识别、WebRTC/WebGL/webdriver/语言序列深度防封探针、主界面 9 项检测闭环及第三方防封体检中心（`Ping0.cc` / `CheckCC.org` / `BrowserScan` / `IPHey`）。
- `src/floating-monitor.tsx`、`src/floating-monitor-model.ts`、`src/floating-monitor.css`、`src-tauri/src/monitor_window.rs`、`src-tauri/capabilities/main.json`：独立置顶实时额度悬浮监控窗（HUD）、异步窗口创建与跨窗口状态同步。
- `src/usage-statistics.tsx`、`src/usage-model.ts`、`src-tauri/src/identities/usage.rs`：用量分析（含「昨天」时段、默认未归属历史自动兜底、独立 `USAGE_LOCK` 防锁竞争）。
- `scripts/claude-cli.ps1`、`src-tauri/src/claude_cli.rs`、`src/claude-cli-panel.tsx`：Claude Code CLI 安全检查与原位更新、代理透传与 `.staging`/`.tmp`/`.old` 残留清理。

常用针对性验证命令：

```powershell
bun test
bun run build
python scripts/test-claude-quota-local.py
python scripts/test-quota-archive.py
python scripts/test-windows.py
node --experimental-strip-types scripts/test-identities-ui.ts --quota-reset-only
node --experimental-strip-types scripts/test-identities-ui.ts --cards-only
node scripts/test-usage-statistics.mjs .local/preview-usage --quick-only
node scripts/test-usage-statistics.mjs .local/preview-usage --layout-only
cargo test --locked --manifest-path src-tauri/Cargo.toml --features custom-protocol -- browser::tests
```

---

## 5. 踩过的坑：绝对不要再踩

1. **Tauri v2 在 Windows (WebView2) 下创建/操控子窗口的命令必须是 `pub async fn`，且必须在 `capabilities/main.json` 注册窗口名。**
   - 在 Windows 上，同步 `#[tauri::command] pub fn` 运行在主 UI 线程；若在其中同步调用 `WebviewWindowBuilder::build()`，会与 WebView2 内部消息泵发生死锁，导致前端 `invoke('monitor_window_toggle')` 永久挂起或报错。`src-tauri/src/monitor_window.rs` 中的窗口创建命令必须保持 `pub async fn`。
   - 同时，`src-tauri/capabilities/main.json` 的 `"windows"` 数组必须包含 `["main", "monitor"]`，否则 `"monitor"` 悬浮窗内的前端代码调用任何 `invoke(...)` 都会被 Tauri v2 ACL 静默拦截。
2. **`usage_statistics_read` 绝不能与 `identities_read` 共用同一个全局长锁。**
   - 用量分析扫描 `~/.claude/projects` 下的大量 JSONL 会话文件耗时较长。若持有 `identities::lock()`，会导致切换到「身份管理」页时 `identities_read` 被阻塞，表现为两个页面同时白屏卡死。必须保持 `src-tauri/src/identities/usage.rs` 中的独立 `USAGE_LOCK`，仅在瞬间克隆身份快照时短暂获取 `identities::lock()` 并立即释放。
3. **`.baga` 归档解压（`scripts/quota_archive.py`）绝不能因缺少可选槽位或 stderr 超过 8KB 而失败。**
   - 暂存身份的 `.baga` 归档不一定包含全部 3 个槽位（例如新保存或未产生项目会话的账号没有 `data/2` 即 `.claude/projects`），且 `tar.exe` 输出的错误/警告若超过 8192 字节，使用有限缓冲区截断后再检查 `returncode != 0` 会导致整个账号额度同步失败。在 `scripts/quota_archive.py` 中必须跳过缺失的可选槽位，并使用无损读取避免 8KB 截断报错。
4. **CPAMC 静态 `5h` 重置显示（`inferred === true`）绝不能使用 `<time>` 标签，且必须保持 `180×286` 卡片几何。**
   - `scripts/test-quota-reset.ts` 第 41 行明确断言：当 `data-quota-inferred="true"` 时，`current5h.locator('time').count() === 0`（防止把已过期的旧重置时刻当成未来倒计时渲染在卡片上）。因此静态 `5h` 必须渲染为 `<>{clockIcon}<span>{label}</span></>`，不可包裹在 `<time>` 中。
   - `scripts/test-usage-statistics.mjs` 的 `readIdentityGeometry` 会严格校验每张身份卡片尺寸精确为 `180×286`、`.identity-quota-reset` 字体为 `12px/16px`。
5. **在 `page.clock.install()` 虚拟时钟激活的 Playwright 测试中，不要用 `Escape` 关闭 Radix Select 下拉框。**
   - 在 `scripts/test-usage-statistics.mjs` 中启用了 `page.clock.install()` 冻结定时器；打开 Radix Select 后若按 `Escape`，Radix 的退出动画/焦点恢复定时器会被冻结，导致后续对 `.usage-trend` 的键盘聚焦失效。应直接点击当前已选中的选项（如 `await page.getByRole('option', {name: '全部', exact: true}).click()`）立即闭合下拉框。
6. **删除冗余文案时必须连同空容器标签（如 `<p>`）一起移除，不能留空标签。**
   - `scripts/test-usage-statistics.mjs` 的 `readSystemGeometry` 等几何检查会遍历卡片内所有 `h2, p, button, ...` 子节点并断言 `width > 0 && height > 0`。若只清空文案留下空 `<p></p>`，会导致 `height === 0` 触发几何测试失败。
7. **Rust `network::Report` 带有 `#[serde(deny_unknown_fields)]`，前后端新增字段必须双向对齐且带 `#[serde(default)]`。**
   - `src/browser-start.tsx` 上报给宿主 `/report` 的 JSON 由 `src-tauri/src/browser/network.rs` 的 `Report` 反序列化。若前端新增字段而 Rust `Report` 未同步添加 `#[serde(default)]` 字段，反序列化会直接报错导致内置浏览器显示“本地核验连接失败”。
8. **PowerShell `claude-cli.ps1` 调用外部 CLI 时必须包裹 `InvokeExternal` 并局部作用域注入环境变量。**
   - 在 `$ErrorActionPreference = 'Stop'` 下，外部程序（`claude.exe`、`npm`、`winget`）往 stderr 打印正常进度信息会被 PowerShell 包装成 `ErrorRecord` 抛出终止异常；必须通过 `InvokeExternal` 临时切换 `$ErrorActionPreference = 'Continue'` 并凭 `$LASTEXITCODE` 判断成败。同时 `DISABLE_AUTOUPDATER='1'` 只能在子进程调用期间临时设置并在 `finally` 中还原，不得污染宿主环境。
9. **不要对原生 `claude.exe` 使用 `PROCESS_VM_READ` 或 `ReadProcessMemory`，也不要在后台自动轮询 OAuth API。**
   - 原生 `claude.exe` 仅使用 `PROCESS_QUERY_LIMITED_INFORMATION`；手动在线校准必须携带官方 CLI 请求头指纹并通过 Cloudflare `/cdn-cgi/trace` 出口国家预检。
10. **双语 YAML 字典与源码 `t('...')` 调用受 `src/i18n.test.ts` 严格门禁保护。**
    - 任何新增或修改的 `t('key')` 必须在 `src/locales/zh.yaml` 和 `src/locales/en.yaml` 中同时存在、键集合完全一致、插槽一致，且 `en.yaml` 中绝不能混入任何中文字符，JSX 文本节点中也绝不能直接硬编码中文字符。
11. **部分源码文件（如 `src/locales/*.yaml`、`scripts/claude_quota.py`、`src/system.tsx`）采用 CRLF 行尾。**
    - 编辑这些文件时注意保持原有行尾格式，或使用单行精确替换 / 保守行尾脚本，避免因 LF/CRLF 混用导致多行匹配失败。
12. **GitHub Release 保持干净，只上传单个安装包文件。**
    - 发布或更新 Release 时**只上传 `Claude-Local_<ver>_x64-setup.exe` 安装包文件**，不要上传 `source.zip`、`SHA256SUMS.txt`、`privacy-audit.json`、`resource-manifest.json` 等附属文件。
13. **不终止 `claude.exe`，不清理共享工作树，敏感探针不入对话或 Git。**
    - 本机热更新只允许对精确路径匹配的 `claude-local.exe` 备份后重启，绝不停止正在运行的 `claude.exe` 或浏览器进程。
    - 每次改写 `HANDOFF.md` 前先归档至 `.local/handoff-backups/` 并校验 SHA256；交接文档使用独立 `[skip ci]` 提交，不重建、不动产品标签 `v0.3.0`。

---

## 6. 需要历史细节时再读这些文件

- [0.3.0更新说明](docs/RELEASE_NOTES_0.3.0.md)、[0.2.4更新说明](docs/RELEASE_NOTES_0.2.4.md)、[0.2.3更新说明](docs/RELEASE_NOTES_0.2.3.md)、[0.2.2更新说明](docs/RELEASE_NOTES_0.2.2.md)、[0.2.1额度恢复](docs/QUOTA_RECOVERY_0.2.1.md)：用户可见行为与历次升级原因。
- [0.2.0更新说明](docs/RELEASE_NOTES_0.2.0.md)、[0.2.0交付核验](docs/RELEASE_VERIFICATION_0.2.0.md)：早期功能实施和分发边界。
- [开发说明](docs/DEVELOPMENT.md)、[分发与许可](docs/DISTRIBUTION.md)、`LICENSE`、`NOTICE.md`：独立产品、构建和第三方许可约束。不存在上游同步、自动公开发布或官方更新源。

本次交接整理只修改文档，不修改程序、用户数据或发布内容。下一会话首先承接用户的新需求，而不是继续已经完成的发布。

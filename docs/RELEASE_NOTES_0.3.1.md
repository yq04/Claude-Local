<!--
[INPUT]: Source-confirmed Windows x64 0.3.1 Cleanroom Activity Log & Timeline Polish, Unified 3-Step/4-Step Identity & Warming Onboarding, Usage Analytics 2.1 with 2x Retina Auto-Screenshot Engine (Overview & Trend Poster + Export Dropdown), Equal-Height Trend/Model Layout, Hover Effort Breakdown Popover, Family/Depth Sorting (fable -> opus -> sonnet -> haiku; max -> xhigh -> high -> medium -> low), and Full-Stack Smart Relay / Auto-Wakeup / Glass GPU & IPC Performance Optimization.
[OUTPUT]: Bilingual public release notes; artifact hashes come only from the audited build's SHA256SUMS.txt.
[POS]: Public release notes linked from both READMEs and the v0.3.1 GitHub Release.
[PROTOCOL]: Retain attribution and persistent format compatibility; never require Companion Browser as the Windows default browser.
-->

# Claude-Local 0.3.1 发布说明 / Release Notes

Claude-Local 基于 [CCBaga](https://github.com/liseami/CCBaga)（[@liseami](https://github.com/liseami) 及贡献者）二次开发并独立维护，保留原贡献者版权与 [MIT 许可](https://github.com/yq04/Claude-Local/blob/main/LICENSE)。第三方组件遵循各自许可，详见 [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md)。

Windows 10 / 11 x64 · [下载安装包 / Download installer](https://github.com/yq04/Claude-Local/releases/download/v0.3.1/Claude-Local_0.3.1_x64-setup.exe) · [Release](https://github.com/yq04/Claude-Local/releases/tag/v0.3.1) · [SHA256SUMS.txt](https://github.com/yq04/Claude-Local/releases/download/v0.3.1/SHA256SUMS.txt)

## 简体中文

0.3.1 聚焦 **智能接力与自动续杯弹窗全链路丝滑提速（GPU 合成与 Rust IPC 深度优化）、身份切换净室日志排版与交互打磨、身份/养号三步与四步引导全面统一、用量分析 2.1（2× 高清数据/趋势截图引擎 + 总 Token 四维价值拆解）、趋势图与模型分布等高对齐、悬停 `Effort 档位分布` 浮层及模型家族/思考深度规范排序**。

- **智能接力、自动续杯与自定义壁纸毛玻璃全链路性能优化**：
  - **GPU 合成层减负**：移除毛玻璃表面底层 1% 透明度的全屏 SVG `<feTurbulence>` 分形噪点实时光栅化滤镜与模态遮罩层的二次全屏 `backdrop-filter: blur(2px)` 叠加，为弹窗赋予高不透明度独立合成表面与 `contain: paint/content` 滚动隔离，并在弹窗打开期间自动暂停底层活跃身份卡光晕动画（`src/style.css` / `src/identity-productivity.css`）。
  - **React 渲染与弹窗按需挂载优化**：将桌面端身份页与悬浮小窗的倒计时脉冲从 `1s` 收敛至 `10s/15s`，对配额目标集、智能接力候选评估、接力池汇总与自动续杯账号行全面引入 `useMemo` 记忆化，并在「自动续杯」与「智能接力」弹窗关闭期间跳过弹窗内部重型虚拟 DOM 树构造，消除后台 15 秒无变更快照的冗余重绘（`src/identities.tsx` / `src/identity-online-quota.ts` / `src/floating-monitor.tsx`）。
  - **Rust 原生 IPC 与文件读取提速**：`identities_wakeup_configure` 在运行环境已核验可用时跳过重复冷启动 `python.exe` 探针，并按 `quota_runtime.py` 文件签名缓存探针结果，使切换时段/待命阈值/单号暂停从 `~500ms` 降至毫秒级瞬时响应；`state_for` 单次读取解析 `quota_ledger.json` 与 `quota_web_metadata.json` 复用至全部账号摘要（消除 `N+1` 次重复磁盘读取与 JSON 解析），后台唤醒与配额指纹核验跳过无关的会话与 Token 账本扫描（`src-tauri/src/identities/wakeup.rs` / `online.rs` / `profile.rs` / `mod.rs`）。
- **身份切换净室日志排版净化与冗余时间线移除**：
  - 修复身份切换与清理活动条（`src/cleaner-activity.tsx` / `src/style.css`）中三段式净室管线胶囊（`① 进程与三锁校验` → `② 账号缓存与遥测净室隔离` → `③ 浏览器与出口对齐`）在中文窄视口下的挤压折行，步骤完成后指示器自动切换为显式 `✓` 完成勾选并收敛脉冲动画。
  - 彻底移除活动条底部及点击「关闭记录」后仍残留显示的冗余「最近操作审计时间线 [1]」折叠块（`src/identities.tsx`），让身份管理工作台与下方的 Free 养号专区视觉衔接更加干净利落。
- **「添加新号 3 步法」与「养号 4 步法」视觉及文案高度统一**：
  - 将身份管理顶部的「添加新号 3 步法」精简统一为动词短语标签（`新建并归档` → `核验并登录网页` → `CLI 授权备份`），与下方「养号 4 步法」（`新建卡片` → `配置并核验` → `注册与日常使用` → `升级后转正`）共享同一套玻璃胶囊步骤芯片（`.identity-guide-step-chip`）与流向箭头样式（`src/identity-productivity.css` / `src/locales/zh.yaml` / `src/locales/en.yaml`）。
- **用量分析 2.1 与 2× 高清原生截图分享引擎**：
  - 顶栏操作区升级为主操作按钮 **「📸 截图数据」**（一键生成核心花费与四类 Token 构成总览长图）与 **「📈 截图趋势」**（一键合成「核心总览 + 趋势面积图 + Top 模型分布」完整分析海报），原「复制 Markdown 简报 / 复制 TSV / 下载 TSV」收敛至右侧紧凑的 **「导出 ▾」** 下拉菜单（`src/usage-screenshot.ts` / `src/usage-statistics.tsx`）。
  - 自研 `renderUsageScreenshotBlob` 2× Retina Canvas 渲染器，自动适配当前浅色/深色主题，优先复制到系统剪贴板并同步触发本地高清 PNG 下载。
  - 全面升级「总 Token」核心主卡：新增 **「活跃天数 · 会话数」** 胶囊标签，单次均值精简为 `28.1K 去重响应数 · 均 347.2K tok/次`；下方 `2×2` 四色 Token 子卡直接展示各类别的 **官方 API 等效美元花费（`≈ $...`）**，非零极小占比精确显示为 **`<0.1%`**（告别误导性的 `0%`）；「缓存命中率」副标题优化为 `读写复用 56.7× · 命中 9.53B`，大额美元花费（`≥ $10,000`）自适应 `$K` 紧凑格式防换行。
- **趋势图与模型分布等高排版、悬停 `Effort 档位分布` 浮层及规范排序**：
  - **等高无留白布局**：默认状态下的「模型分布」卡片采用与「截图趋势」一致的 4 行精炼模型行（模型徽章 + 总量/占比、红色主占比条、等效花费/输出/命中率/节省摘要、四色缓存构成窄条），并在桌面双栏网格中与左侧「用量趋势」严格等高对齐（`height: 100%`），彻底消除使用 3 个 Claude 模型时左侧趋势图下方的大面积空白（`src/usage-trend.tsx` / `src/usage-statistics.css`）。
  - **悬停/聚焦展示 `Effort 档位分布` 浮层**：将鼠标悬停（或键盘 `Tab` 聚焦）在任意模型行上时，即时平滑弹出 `Effort 档位分布` 详情浮层，首行向下展开、其余行向上展开，100% 收纳于卡片内部绝不裁切或撑高外框。
  - **模型家族与思考深度固定优先级排序**：模型分布默认按 **`fable` → `opus` → `sonnet` → `haiku` → 其他** 家族顺序排列（同家族内按 Token 降序）；`Effort 档位分布` 默认按思考深度从高到低 **`max` → `xhigh` → `high` → `medium` → `low`** 排列（`src/usage-model.ts`）。

`BAGAID01` / `.baga`、SQLite `user_version = 3`、已有主密钥、账号 HMAC 与浏览器种子 100% 向下兼容；升级保留已有身份库与浏览器资料，不主动终止运行中的 `claude.exe`。0.3.1 使用新标签与新资产，既有 0.3.0 与 0.2.7 标签和安装包保持不变。

## English

Claude-Local is derived from [CCBaga](https://github.com/liseami/CCBaga) by [@liseami](https://github.com/liseami) and contributors, and maintained independently. Original copyright and the [MIT license](https://github.com/yq04/Claude-Local/blob/main/LICENSE) are retained; third-party terms are documented in [NOTICE](https://github.com/yq04/Claude-Local/blob/main/NOTICE.md).

0.3.1 delivers **Smart Relay & Auto-Wakeup Dialog GPU/IPC Performance Optimization, Cleanroom Activity Log & Timeline Polish, Unified 3-Step & 4-Step Identity/Warming Onboarding, Usage Analytics 2.1 with a 2× Retina Auto-Screenshot Engine, Equal-Height Trend/Model Layout, Hover `Effort Breakdown` Popover, and Canonical Model Family & Thinking Depth Sorting**.

- **Smart Relay, Auto-Wakeup & Glass Surface Performance Optimization**:
  - **GPU Compositing & Modal Isolation**: Eliminates full-screen SVG `<feTurbulence>` filter rasterization and nested `.app-dialog-overlay` `backdrop-filter: blur(2px)` stacking over custom wallpapers, gives modal surfaces an isolated high-opacity paint layer with `contain: paint/content` scrollable account lists, and pauses background active-card aura animations while any modal dialog is open (`src/style.css` / `src/identity-productivity.css`).
  - **React Memoization & On-Demand Dialog Rendering**: Relaxes desktop countdown ticks from `1s` to `10s/15s`, memoizes quota target sets, Smart Relay candidate evaluations, pool summaries, and Auto-Wakeup account rows via `useMemo`, skips building heavy dialog VDOM subtrees while `Auto-Wakeup` or `Smart Relay` dialogs are closed, and deduplicates unchanged 15s native scheduler snapshots (`src/identities.tsx` / `src/identity-online-quota.ts` / `src/floating-monitor.tsx`).
  - **Rust Native IPC & Single-Pass Ledger/Metadata Reads**: Caches verified Python runtime capability by `quota_runtime.py` file signature so toggling Auto-Wakeup time presets, thresholds, or per-account pauses no longer cold-spawns `python.exe` on every click; reads and parses `quota_ledger.json` and `quota_web_metadata.json` once per `state_for` call instead of `N+1` times, and skips session/token-ledger scans during background wakeup and quota binding checks (`src-tauri/src/identities/wakeup.rs` / `online.rs` / `profile.rs` / `mod.rs`).
- **Cleanroom Activity Log Polish & Redundant Audit Timeline Removal**:
  - Fixes wrapping and badge sizing in the 3-stage cleanroom switch pipeline (`① Process & 3-lock check` → `② Cache & telemetry cleanroom` → `③ Browser & exit alignment`), and displays an explicit `✓` checkmark on completed step pills (`src/cleaner-activity.tsx` / `src/style.css`).
  - Completely removes the redundant `"Recent Operation Audit Timeline [1]"` block both inside the open log and after clicking `Dismiss` (`src/identities.tsx`).
- **Unified 3-Step Identity & 4-Step Warming Onboarding**:
  - Streamlines the `"3-step add flow"` (`Create & archive` → `Verify & sign in` → `CLI auth & backup`) to match the concise pill styling and rhythm of the `"4-step warming flow"` (`Create card` → `Configure & verify` → `Sign up & daily use` → `Upgrade & promote`) via shared `.identity-guide-step-chip` components (`src/identity-productivity.css` / `src/locales/zh.yaml` / `src/locales/en.yaml`).
- **Usage Analytics 2.1 & 2× Retina Auto-Screenshot Engine**:
  - Replaces top-level text export buttons with one-click **`📸 Snap Overview`** (Overview KPI card) and **`📈 Snap Trend`** (`Overview + Daily Trend Chart + Top Models` poster) buttons plus a compact **`Export ▾`** dropdown menu for Markdown Brief, Copy TSV, and Download TSV (`src/usage-screenshot.ts` / `src/usage-statistics.tsx`).
  - Upgrades the `Total Tokens` hero card with **`Active days · Sessions`** pills, concise per-response averages (`Deduped responses · avg ... tok/req`), per-bucket **`≈ $` official API equivalent cost** on all four `2×2` token composition subcards, and **`<0.1%`** precision for non-zero small shares; refines the `Cache Hit Rate` subtitle (`Read/write reuse {ratio}× · Hit {read}`) and compact `$K` formatting for large USD figures (`>= $10,000`).
- **Equal-Height Trend/Model Layout, Hover `Effort Breakdown` Popover & Family/Depth Sorting**:
  - **Equal-height zero-dead-space layout**: Default rows in `Model Breakdown` use a compact 4-line summary matching `Snap Trend` and align in height (`height: 100%`) with `Usage Trend`, eliminating large blank gaps below the chart when 3 Claude models (`opus` / `sonnet` / `haiku`) are active (`src/usage-trend.tsx` / `src/usage-statistics.css`).
  - **Hover / focus `Effort Breakdown` popover**: Hovering or focusing any model row opens a floating `Effort Breakdown` tooltip inside `.usage-model-card` without clipping or stretching the card.
  - **Canonical family & thinking-depth ordering**: Models sort by family priority **`fable` → `opus` → `sonnet` → `haiku` → other** (`sortUsageModels`), and thinking depth sorts from highest to lowest **`max` → `xhigh` → `high` → `medium` → `low`** (`sortUsageEfforts` in `src/usage-model.ts`).

`BAGAID01` / `.baga`, SQLite `user_version = 3`, existing master keys, account HMACs and browser seeds remain 100% compatible. Upgrades preserve vaults and browser profiles without terminating running `claude.exe` sessions. Version 0.3.1 uses a new tag and assets; existing 0.3.0 and 0.2.7 artifacts remain unchanged.

## 安装包校验 / Installer verification

请将以下结果与本版 Release 的 `SHA256SUMS.txt` 比对。 / Compare the result with `SHA256SUMS.txt` from this release.

```powershell
Get-FileHash .\Claude-Local_0.3.1_x64-setup.exe -Algorithm SHA256
```

<!--
[INPUT]: 对标 GitHub 主流开源项目（EcoPaste / pot-desktop / coco-app / cc-switch / claudia / ccusage / bozdemir-claude-usage-widget / niccolo-sabato-claude-usage-widget / jv-k-claude-gauge / Maciek-Claude-Code-Usage-Monitor / Win-CodexBar）的架构与功能调研，结合 Claude-Local v0.2.5 当前代码库全链路审计。
[OUTPUT]: 历史开源对标方案与已交付成果索引；2026-11-02 单身份加密包已取消，其他既有优化保留，未核验的建议不标记为已实现。
[POS]: docs/ 历史规划与状态说明；单身份 .clpack / .bagapack 不再是实施任务，其他范围以 HANDOFF.md 与当前源码为准，不包含任何真实身份、IP、凭据或个人路径。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
-->

# Claude-Local 开源对标调研与全链路改进优化方案

> **2026-11-02 范围澄清**：用户取消的是 P3 中未实现的单身份加密导入/导出（早期称 `.clpack`，后续称 `.bagapack`）及跨机登录态搬运，不是取消本文件全部调研或既有功能。HUD、用量摘要、定向额度查询、智能接力和卡片交互等现有成果继续保留。P3 已交付的是“复制交接说明”，不能当作已实现的加密包；`statusLine` 自检等独立建议不因本次取消自动变成新待办，也未在本轮确认全部落地。下文早期阶段安排仅为历史记录，当前状态以 `HANDOFF.md` 和源码为准。

> **编制时间**：2026-11-01  
> **基准版本**：`v0.2.5`（含 PayPal/Braintree 美国家宽分流加固与额度小窗预热修复）  
> **核心原则**：在严格坚守 `Claude-Local` 既有安全铁律（绝不中断运行中 `claude.exe`、绝不写 `.claude.json`、绝不发起后台 OAuth 轮询、`Python` 独占写 `quota_ledger.json`、智能接力保持默认关闭且手动确认）的前提下，深度吸收 GitHub 同类高星开源项目的成熟工程实践与交互设计。

---

## 一、 核心对标开源项目矩阵（调研总结）

| 领域 | 代表性开源项目（GitHub） | 核心亮点与可借鉴设计 | 对应本项目的改进映射 |
| :--- | :--- | :--- | :--- |
| **Tauri v2 多窗口与悬浮工具架设** | • `EcoPasteHub/EcoPaste`<br>• `pot-app/pot-desktop`<br>• `infinilabs/coco-app`<br>• `luci1741/Win-CodexBar` | 1. **静态声明式二级窗口**：在 `tauri.conf.json` 中静态声明常驻隐藏的 HUD/Popup 窗口（`visible: false`, `decorations: false`, `transparent: true`, `shadow: false`, `skipTaskbar: true`），交由 Tauri 在 `App::setup` 统一初始化，彻底规避运行期 WebView2 环境竞争与消息泵死锁。<br>2. **Tauri v2 Capabilities 显式授权**：在 `capabilities/*.json` 的 `windows` 列表中显式纳入所有二级窗口 label，并细化窗口拖拽/置顶/隐藏权限。<br>3. **多屏 DPI 坐标记忆与离屏自愈**：持久化悬浮窗位置，显示器热插拔后自动夹紧回可见工作区。 | **P0**：彻底根治「额度小窗」在 Windows 11 下的窗口创建、Tauri v2 ACL 权限拦截、无边框圆角白边与坐标持久化问题。 |
| **Claude 桌面额度悬浮窗（HUD / Widget）** | • `bozdemir/claude-usage-widget`<br>• `niccolo-sabato/claude-usage-widget`<br>• `projectvelox/claude-usage-widget`<br>• `jv-k/claude-gauge` | 1. **时间流逝刻度线（Pace Tick Marker）**：在 5h/7d 进度条上叠加当前窗口「已过时间比例」刻度线，直观对比「消耗进度 vs 时间进度」。<br>2. **5h 收盘预计消耗（Projected End %）**：不仅算耗尽 ETA，还给出按当前速率到 5h 结束时的预计消耗百分比。<br>3. **锁定态鼠标穿透（Click-Through / Ghost Peek）**：小窗置顶锁定时支持鼠标悬停半透明穿透，不遮挡底层 IDE 代码编辑。<br>4. **托盘右键一键开关 HUD**：无需先打开主窗口即可从系统托盘直接显隐小窗。 | **P1**：升级「额度小窗（Quota HUD）」的视觉刻度、抗遮挡穿透交互与系统托盘直达控制。 |
| **本地 Token 与 5h 计费块分析** | • `ryoppippi/ccusage`<br>• `Maciek-roboblog/Claude-Code-Usage-Monitor` | 1. **`ccusage blocks`（5h 滚动计费块视图）**：以 Claude 实际的 5h 会话窗口为单位聚合 Token、API 等效美元花费（`$`）与缓存节省（`$`），并与历史峰值块（Max Block）对比。<br>2. **一键导出脱敏 Markdown 摘要**：便于用户留档或分享算力效率。 | **P2**：在「用量分析」新增 5h 活跃计费块洞察与一键脱敏 Markdown 统计摘要复制。 |
| **Claude Code 多账号切换与配置健康** | • `farion1231/cc-switch`<br>• `getAsterisk/claudia`<br>• `XueshiQiao/CCSwitcher`<br>• `realiti4/claude-swap` | 1. **单账号独立加密导出/导入**：支持将单个配置好的账号及其专属环境参数独立打包迁移，无需整库备份暴露全部账号。<br>2. **配置与 `statusLine` 健康度自检**：实时检测 `~/.claude/settings.json` 被动采集钩子与凭据状态，损坏时一键无损修复。 | **P3**：新增「单身份/单养号卡加密便携包（`.clpack`）」（完美契合代注册充值后移交朋友电脑场景）与 `statusLine` 健康自检。 |
| **指纹浏览器与支付/KYC 防封风控** | • `Fingerprint Chromium` 生态<br>• `Clash Verge Rev` / `Mihomo` 最佳实践 | 1. **支付/KYC 地区 Cookie 污染预检与清理提示**：防止历史访问遗留的地区 Cookie（如 PayPal `/hk/`）干扰新家宽出口。<br>2. **浏览器控制台顶栏实时展示断路器（Kill-Switch）与当前锁定国家/时区摘要**。 | **P4**：打磨「风控验证」与「浏览环境」的支付/KYC 飞行前预检闭环。 |

---

## 二、 分阶段改进优化详细方案（P0 → P4）

### P0（最高优 · 架构级根治）：Tauri v2 额度小窗声明式生命周期、Capabilities ACL 授权与 Win11 透明圆角优化

#### 1. 深度审计发现的三个关键技术点
1. **发现一（Tauri v2 Capabilities ACL 权限缺失）**：
   - 检查 `src-tauri/capabilities/main.json` 发现当前配置为：
     ```json
     {
       "identifier": "main-capability",
       "description": "Main application window permissions",
       "windows": ["main"],
       "permissions": ["core:default"]
     }
     ```
   - 在 Tauri v2 中，`windows` 数组未包含 `"monitor"` 时，`"monitor"` 窗口（`index.html?window=monitor`）被视为无权限上下文，其内部发起的 `invoke('monitor_live_telemetry')`、`listen('monitor-window-state')`、`getCurrentWindow().hide()` / `startDragging()` 会被 Tauri IPC 权限层拒绝。
2. **发现二（静态声明 vs 动态 `WebviewWindowBuilder::new`）**：
   - 对比 `EcoPaste` 与 `pot-desktop` 的源码及 `tauri-2.12.1/src/app.rs:2691`：在 `tauri.conf.json`（及分平台配置）中直接声明 `"label": "monitor"`（`visible: false`），Tauri 会在启动 `app::setup` 第一步用与 `"main"` 完全一致的原生通道完成创建，从根源上消除运行期二次初始化 WebView2 的一切竞态。
3. **发现三（Windows 11 无边框窗口直角阴影与底色白边）**：
   - 当前 `"monitor"` 未开启 `transparent: true` 与 `shadow: false`，在 Windows 11 下切换为贴边折叠胶囊（`52×138`）或圆角卡片时，Win32 窗口外框会残留默认矩形底色或系统阴影边框。

#### 2. P0 具体改造清单
- **文件 1：`src-tauri/capabilities/main.json` & `src-tauri/src/local_edition_tests.rs`**
  - 将 `"windows"` 扩展为 `["main", "monitor"]`；
  - 在 `local_edition_tests.rs` 中新增回归断言：确保 `capabilities/main.json` 同时包含 `"main"` 与 `"monitor"`，且绝不引入 `updater:` 或 `process:` 权限。
- **文件 2：`src-tauri/tauri.conf.json`、`src-tauri/tauri.windows.conf.json`、`src-tauri/tauri.linux.conf.json`、`src-tauri/tauri.macos.conf.json`**
  - 在 `app.windows` 中静态声明 `"monitor"` 窗口配置：
    ```json
    {
      "label": "monitor",
      "title": "Claude-Local Monitor",
      "url": "index.html?window=monitor",
      "width": 340,
      "height": 258,
      "minWidth": 340,
      "minHeight": 258,
      "maxWidth": 340,
      "maxHeight": 258,
      "resizable": false,
      "maximizable": false,
      "decorations": false,
      "transparent": true,
      "shadow": false,
      "alwaysOnTop": true,
      "skipTaskbar": true,
      "focus": false,
      "visible": false
    }
    ```
- **文件 3：`src-tauri/src/monitor_window.rs` & `src/floating-monitor.css`**
  - `monitor_window::setup` 直接接管已由 Tauri 静态创建的 `"monitor"` 窗口（若不存在仍保留主线程共享 `ICoreWebView2Environment` 的动态创建兜底），执行右上角初始定位或从私有 `app_data/monitor-window-state.json` 恢复上次坐标与模式（含多屏拔插后的离屏边界自愈夹紧）；
  - 在 `floating-monitor.css` 中为 `html:has(.fm-viewport), body:has(.fm-viewport)` 设置 `background: transparent !important;`，配合 `shadow: false` 实现纯净无白边的悬浮毛玻璃与贴边胶囊视觉。

---

### P1（高优 · 额度小窗 HUD 体验对标升级）：时间流逝刻度线、锁定穿透模式与托盘快捷开关

#### 1. 开源借鉴点
- **借鉴 `jv-k/claude-gauge` 与 `ryoppippi/ccusage`**：单看「5h 已用 65%」无法立即判断风险——如果 5h 窗口才刚开始 30 分钟就用了 65% 是极度危险，如果 5h 窗口还剩 10 分钟才用 65% 则是极其充裕。在进度条上增加**「时间流逝游标（Time-Elapsed Pace Marker）」**与**「预计收盘占比（Projected End %）」**能把空间与时间合二为一。
- **借鉴 `EcoPaste` / `bozdemir/claude-usage-widget`**：置顶悬浮窗在写代码时容易遮挡编辑器右上角按钮；支持在「锁定位置（Lock）」的基础上开启**「鼠标穿透（Ghost / Click-Through）」**，并在系统托盘菜单提供一键开关/解除穿透。

#### 2. P1 具体改造清单
- **文件 1：`src/floating-monitor-model.ts` & `src/floating-monitor-model.test.ts`**
  - 新增纯函数 `computeWindowTimePace(resetAtSec, windowDurationSec, usedPct, nowSec)`：
    - 计算当前窗口已流逝时间百分比 `elapsedPct`（`0~100%`）；
    - 计算偏差 `paceDeltaPct = usedPct - elapsedPct`（超前消耗 vs 节余）；
    - 计算按当前速率到窗口重置时的预计累计百分比 `projectedEndPct`。
- **文件 2：`src/floating-monitor.tsx` & `src/floating-monitor.css`**
  - 在 5h 与 7d 进度条轨道上渲染 `elapsedPct` 垂直刻度游标线（Time Tick）；
  - 新增「鼠标穿透（Click-Through）」按钮（调用 `window.set_ignore_cursor_events(true)`，并在鼠标移至顶部控制栏热区或通过托盘菜单时一键恢复交互）。
- **文件 3：`src-tauri/src/ui_language.rs` & `src-tauri/src/main.rs`**
  - 在系统托盘菜单（中/英双语）新增 `额度小窗 / Quota HUD` 显隐切换项，无需打开主界面即可直接唤出或关闭悬浮窗。

---

### P2（中高优 · 用量分析升级）：对标 `ccusage blocks` 的 5h 计费块洞察与一键 Markdown 统计摘要

#### 1. 开源借鉴点
- **`ryoppippi/ccusage`（`ccusage blocks --active`）**：Claude Pro / Max 的核心限流周期是 **5 小时滚动块（5-hour block）**。在「用量分析」中除按天/按小时趋势外，提供当前 5h 活跃块的 Token 构成、等效 API 美元花费（`$`）、缓存节省（`$`）与平均速率（TPM），并支持一键复制脱敏 Markdown 统计简报。

#### 2. P2 具体改造清单
- **文件 1：`src/usage-model.ts` & `src/usage-export.ts` & `src/usage-model.test.ts`**
  - 新增 `formatUsageMarkdownSummary(report, scopeLabel, locale, privacyMask)`：生成结构化、遵循隐私打码（自动隐藏邮箱前段）的 Markdown 统计卡片（含总 Token、四类构成占比、API 等效花费 `$`、缓存节省 `$`、缓存复用倍数及主力模型分布）。
- **文件 2：`src/usage-statistics.tsx`**
  - 在顶部导出操作区（复制 TSV / 下载 TSV 旁）新增「复制 Markdown 简报」按钮与即时勾号反馈。

---

### P3（历史提案，单身份加密包已取消）：跨机移交与配置自检调研

以下加密包与单卡导入/导出改造清单已取消，不执行。既有“复制交接说明”继续保留；配置健康检查属于独立建议。

#### 1. 开源借鉴点与真实痛点解决
- **解决跨机移交核心痛点**：在「本机代注册、代充值 PayPal 后将新号移交朋友电脑」的实际工作流中，整库备份（`.clbackup`）会把本机所有身份全部打包，不适合发给朋友；而手动抄写 `seed`、代理地址、时区又容易出错。
- **借鉴 `XueshiQiao/CCSwitcher` 与 `farion1231/cc-switch`**：
  1. 提供**「导出单张身份卡 / 养号卡便携包（`.clpack`）」**：使用用户设定的传输口令（PBKDF2-HMAC-SHA256 + AES-256-GCM，复用 `backup.rs` 加密原语）仅打包所选的**单个身份归档（`.baga`）+ 绑定的浏览器确定性 `seed` + 目标地区/语言/时区 + 脱敏代理端口模板 + 手动订阅到期日**；朋友电脑点击「导入单卡便携包」即可一键复刻全部防关联参数与身份！
  2. 在「身份管理」顶栏同步状态旁展示被动额度 `statusLine` 钩子健康状态，异常时支持一键修复。

#### 2. P3 具体改造清单
- **文件 1：`src-tauri/src/identities/backup.rs` & `src-tauri/src/identities/mod.rs`**
  - 在不改动现有整库备份契约的前提下，新增单身份加密导出/预检/导入命令（或者在单卡 `⋯` 菜单中提供「导出防关联配置与指纹种子卡」）。
- **文件 2：`src/identities.tsx` & `src/warming-cards.tsx`**
  - 在身份卡与养号卡的 `⋯` 菜单中增加「复制跨机移交配置清单（含 Seed / 时区 / 代理端口）」与单卡加密导出入口，让移交朋友电脑实现「零手抄失误」。

---

### P4（中优 · 支付与 KYC 防封体验打磨）：站点地区 Cookie 污染提醒与浏览器顶栏防漏摘要

#### 1. P4 具体改造清单
- **文件 1：`src/risk-verification.tsx` & `src/browser.tsx`**
  - 在「风控验证」与「浏览环境」中新增「PayPal / Stripe / Persona KYC 飞行前检查提示」：明确提醒若此前在未锁美国家宽时访问过 `paypal.com`（曾触发 `/hk/` 重定向），需在伴生浏览器中清除 `paypal.com` 站点 Cookie 后再打开，并提供一键复制 `chrome://settings/content/all?searchSubpage=paypal.com` 清理地址的快捷按钮。

---

## 三、 实施排期与验证标准

| 阶段 | 包含模块 | 预计改动范围 | 自动化与真机验证标准 |
| :--- | :--- | :--- | :--- |
| **第一阶段（立即执行）** | **P0 + P1**（额度小窗 Tauri v2 静态声明 + Capabilities ACL 修复 + Win11 透明去白边 + 位置记忆 + 时间刻度游标 + 托盘开关） | `capabilities/main.json`, `tauri*.conf.json`, `monitor_window.rs`, `floating-monitor.tsx/css/model.ts`, `ui_language.rs`, `main.rs` | 1. `bun x tsc --noEmit && bun test` 全绿；<br>2. `cargo test` 全绿；<br>3. 真机点击「额度小窗」与托盘菜单 100% 瞬开、数据实时刷新、四角无白边、胶囊态贴边丝滑、跨重启保留位置。 |
| **第二阶段（已完成）** | **P2 + P3 + P4**（Markdown 统计简报导出 + 跨机移交防关联配置卡 + 支付 Cookie 预检提示） | `usage-export.ts`, `usage-statistics.tsx`, `identities.tsx`, `warming-cards.tsx`, `risk-verification.tsx` | 1. 新增单测覆盖导出脱敏与跨机移交清单生成；<br>2. 全程零中断 `claude.exe`，零真实信息入库。 |
| **第三阶段（已完成）** | **P5 + P6 + P7**（智能接力深度审计修复 + 额度查询未知/过期定向批次 + 用量分析单次请求效率与多维排序 + 身份页无闪烁静默同步） | `smart-relay-model.ts`, `identity-online-quota.ts`, `floating-monitor-model.ts`, `floating-monitor.tsx`, `identities.tsx`, `settings.tsx`, `usage-statistics.tsx`, `usage-table.tsx`, `usage-export.ts` | 1. 修复 `inferred7d`/`inferred5h` 已回血账号分级，补齐 `affinityMode` 三态语义与账号池容量汇总条；<br>2. 在线额度弹窗新增「仅查未知/过期」定向查询；<br>3. 用量分析新增单次请求均值（`tok/req`、`$/req`）、峰值时段徽章、账号表五维排序与时段明细花费/缓存列；<br>4. 悬浮小窗保持纯净 3 指标卡底栏（不显示接力备选条防遮挡），主窗口支持穿透模式一键恢复交互与 5s 合并无闪烁静默本地额度同步。 |


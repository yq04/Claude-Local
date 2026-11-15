<!-- [INPUT]: Verified 0.3.5 UI de-AI compact refactor, 9-page layout overhaul, 286-key bilingual microcopy compression, and Step 1 workbench polish on top of v0.3.3. -->
<!-- [OUTPUT]: Bilingual public GitHub Release notes for Claude-Local v0.3.5 (no automatic updater; non-disruptive Windows x64 upgrade). -->
<!-- [POS]: Tracked documentation artifact paired with git tag v0.3.5 and SHA256SUMS.txt. -->

# Claude-Local v0.3.5

> **独立 Windows x64 发行说明 / Standalone Windows x64 Release Notes**
> 发布日期 Date: `2026-11-15` · 应用标识 Bundle ID: `ai.local.claude-local` · 主程序 Executable: `claude-local.exe` · 伴侣浏览器 Companion Browser: `Claude-Local-Browser`

---

## 中文说明

### 核心更新摘要

`v0.3.5` 在 `v0.3.3` 稳定性与安全边界基线之上，对桌面端全 9 个工作区页面完成系统性的 **去 AI 样板化（De-AI）、高密度排版重构与双语微文案精简**，大幅减少冗余留白与视觉噪音，保持已有数据结构与隔离边界 100% 不变：

1. **统一桌面外壳与共享视觉规范**
   - **`src/style.css` / `src/productivity-shell.css`**：全工作区统一 `44px` 页头与 `18px` 中性 `H1` 标题、`12px` 卡片圆角、`28×28` 中性图标容器与紧凑 `.settings-row` 行高。
   - **关键几何零回归**：完整保留身份工牌 `.identity-card`（`166×286`）与浏览器验证 `.browser-verification-page` / `.browser-start` / `.verification-*` 既有布局约束。
   - **轻量添加引导**：身份库顶部 `.identity-onboarding-bar` 改为轻量药丸徽章 + 面包屑步骤条，窄屏 `680..700px` 仍自动换行、无横向滚动。

2. **9 大工作区高密度排版重构**
   - **快速配置（`src/quick-actions.tsx` / `src/quick-setup.css`）**：顶部新增 4 栏横向环境状态条（浏览 / 电脑 / 身份 / Claude Code CLI），下方重组为紧凑 2 列工作台动作网格（覆盖 8 项配置与排障入口），去除重复底部目标摘要。
   - **浏览 / 电脑 / 网络环境共享样式（`src/env-pages.css`、`src/browser.tsx`、`src/system.tsx`、`src/vps.tsx`）**：
     - 浏览环境改用紧凑两区顶栏与双列实测核验矩阵；
     - 电脑环境上方增加 4 栏美区基线对齐摘要条，下方整合为分组三行统一设置卡（时区 / 语言 / 定位），继续保持当前观测与目标草稿分离；
     - 网络环境升级为三联代理卡片（iKuuu / Kookeey / 提示词）与紧凑域名连通性诊断行，仅保留授权只读复制动作。
   - **风控验证（`src/risk-verification.tsx` / `src/risk-verification.css`）**：静态防漏体检（3 项）与跨域实测（3 项）升级为响应式 3 列 `.risk-grid-3` 网格；合并顶部冗余徽章为统一安全态势条，去除机械编号列表。
   - **使用说明（`src/help.tsx`）**：保留置顶「新用户与添加新号」三步法，正文转为响应式双列 `.help-topics` 网格，以中性图标与强调色标头取代数字序号。
   - **软件设置与加密备份（`src/settings.tsx`、`src/backup-panel.tsx`、`src/backup-panel.css`）**：
     - 设置页采用左标题 + 居中胶囊 Tabs（通用 / 外观与布局 / 数据管理 / 关于）；「恢复默认界面设置」归位到「外观与布局」底部与「关于」页；清除壁纸与重置默认统一采用中性 `secondary` 按钮；
     - 备份表单精简范围说明（完整保留 `warming_cards.json`、`manual_subscriptions.json` 与 `profile/` 排除边界），新增并排导出与隔离恢复 `.backup-forms-grid`，`.backup-location` 路径与操作按钮单行水平对齐（窄于 `680px` 自动换行），`.backup-rescue-toggle` 调整为清晰的 `12px` 正文规格。

3. **生产力子面板与智能接力细节打磨**
   - **Claude Code CLI 维护卡（`src/claude-cli-panel.tsx`）**：改用中性 `>_` 终端图标徽章（`.cli-terminal-badge`），保持运行中禁用更新与只读挂载边界。
   - **Claude 残留与凭据审查（`src/claude-residue-panel.tsx`）**：补齐 CLI 代理边界胶囊的 `SOCKS5` 与不完整代理状态明细及 `shieldWarnHint` 悬浮提示（与 `risk-verification.tsx` 对齐）；「选入异常登录项」按钮改用中性 `secondary` 皮肤并收紧列表行距。
   - **智能接力模型（`src/smart-relay-model.ts`）**：化简首选推荐候选判定表达式，消除冗余条件分支。
   - **双语微文案压缩（`src/locales/zh.yaml` / `src/locales/en.yaml`）**：联合精简 `286` 个中英条目，去除空话与重复说明，保留全部操作提示与安全警告。

### 兼容性与无损升级说明

- **数据格式 100% 向下兼容**：完整保留 `BAGAID01` 魔数、`.baga` 归档编码、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串以及 `%APPDATA%\ai.local.claude-local` 私有目录结构。
- **平滑无中断升级**：支持从 `0.1.x`、`0.2.x`、`0.3.0`、`0.3.1`、`0.3.2` 或 `0.3.3` 直接安装升级至 `0.3.5`，保留所有已有身份、密钥与隔离浏览器资料，不中断正在运行的 `claude.exe` 会话。
- **校验与核验**：安装程序构建与隐私核验汇总于随附 `SHA256SUMS.txt`；安装前可用 PowerShell 校验：
  ```powershell
  Get-FileHash .\Claude-Local_0.3.5_x64-setup.exe -Algorithm SHA256
  ```

---

## English Release Notes

### Highlights

Building on the `v0.3.3` stability and isolation baseline, **`v0.3.5`** delivers a comprehensive **UI De-AI unification, high-density 9-page layout overhaul, and bilingual microcopy slimming**, removing excessive whitespace and decorative clutter while keeping every storage format and safety boundary intact:

1. **Unified Desktop Shell & Shared Tokens**
   - **`src/style.css` / `src/productivity-shell.css`**: Standardizes `44px` headers with neutral `18px` `H1` headings, `12px` card radii, `28×28` neutral icon containers, and compact `.settings-row` spacing across all views.
   - **Preserved Critical Geometry**: Keeps `.identity-card` (`166×286`) and `.browser-verification-page` / `.browser-start` / `.verification-*` dimensions unchanged.
   - **Lightweight Onboarding Bar**: Refines `.identity-onboarding-bar` into a subtle pill badge and breadcrumb trail that wraps cleanly at `680..700px` without horizontal overflow.

2. **9-Page Compact Workbench Redesign**
   - **Quick Setup (`src/quick-actions.tsx` / `src/quick-setup.css`)**: Adds a 4-cell horizontal telemetry bar (`Browser` / `System` / `Identity` / `Claude Code CLI`) above a 2-column action grid across 8 destinations, dropping duplicate footer summaries.
   - **Shared Environment Layout (`src/env-pages.css`, `src/browser.tsx`, `src/system.tsx`, `src/vps.tsx`)**: Compact 2-zone browser hero + 2-column verification matrix; US baseline summary strip + unified 3-row inset system settings (`Timezone` / `Language` / `Location`) with observed values separated from drafts; 3-column proxy chain cards and concise connectivity probes with copy-only referral actions.
   - **Risk Verification (`src/risk-verification.tsx` / `src/risk-verification.css`)**: Upgrades both 3-item static leak checks and 3-item live cross-domain probe cards to responsive 3-column `.risk-grid-3` grids, merges top pill noise into a single posture bar, and removes numbered checklists.
   - **Help (`src/help.tsx`)**: Retains the pinned 3-step Quick Start and reorganizes topics into a responsive 2-column `.help-topics` grid with neutral icons and accent headers.
   - **App Settings & Backup (`src/settings.tsx`, `src/backup-panel.tsx`, `src/backup-panel.css`)**: Left title + centered pill tabs (`General` / `Appearance & layout` / `Data management` / `About`); relocates `Reset interface defaults` into `Appearance & layout` (plus `About`); uses neutral `secondary` styling for `Clear wallpaper` and `Reset defaults`; side-by-side `.backup-forms-grid` export & isolated restore forms; single-row `.backup-location` action alignment (wrapping below `680px`); and crisp `12px` `.backup-rescue-toggle` typography.

3. **Productivity Subpanels, Shield Parity & Copy Compression**
   - **Claude Code CLI Panel (`src/claude-cli-panel.tsx`)**: Switches the panel header badge to a neutral `>_` terminal badge (`.cli-terminal-badge`) while retaining read-only mount and active-process safeguards.
   - **Claude Residue Inspector (`src/claude-residue-panel.tsx`)**: Brings CLI proxy boundary pills into parity with `risk-verification.tsx` (`socks5` and `incomplete` proxy states + `shieldWarnHint` tooltip), styles the anomaly preset button as neutral `secondary`, and tightens file row padding.
   - **Smart Relay Model (`src/smart-relay-model.ts`)**: Simplifies the candidate recommendation check without changing routing semantics.
   - **Bilingual Copy Compression (`src/locales/zh.yaml` / `src/locales/en.yaml`)**: Trims `286` Chinese/English locale entries for concise, non-repetitive UI copy while retaining every functional cue and safety warning.

### Compatibility & Non-Disruptive Upgrade

- **Full Backward Compatibility**: `BAGAID01` vault headers, `.baga` archives, SQLite `user_version = 3`, account HMAC rules, legacy browser seed strings, and `%APPDATA%\ai.local.claude-local` paths remain unchanged.
- **Seamless In-Place Upgrade**: Upgrades directly from `0.1.x`, `0.2.x`, `0.3.0`, `0.3.1`, `0.3.2`, or `0.3.3` to `0.3.5` without re-creating identities or interrupting active `claude.exe` sessions.
- **Checksums**: Compare `Claude-Local_0.3.5_x64-setup.exe` against the published `SHA256SUMS.txt` asset via:
  ```powershell
  Get-FileHash .\Claude-Local_0.3.5_x64-setup.exe -Algorithm SHA256
  ```

---

## Attribution & License

- Maintained in this repository as an independent Windows x64 project under the [MIT License](../LICENSE) with preserved third-party copyright notices in [NOTICE](../NOTICE.md).

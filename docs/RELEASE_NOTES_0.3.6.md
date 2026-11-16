<!-- [INPUT]: Verified 0.3.6 Quick-Setup-aligned workbench overhaul & second-pass polish across Browser, Computer, Network, and Risk & KYC on top of v0.3.5. -->
<!-- [OUTPUT]: Bilingual public GitHub Release notes for Claude-Local v0.3.6 (no automatic updater; non-disruptive Windows x64 upgrade). -->
<!-- [POS]: Tracked documentation artifact paired with git tag v0.3.6 and SHA256SUMS.txt. -->

# Claude-Local v0.3.6

> **独立 Windows x64 发行说明 / Standalone Windows x64 Release Notes**
> 发布日期 Date: `2026-11-15` · 应用标识 Bundle ID: `ai.local.claude-local` · 主程序 Executable: `claude-local.exe` · 伴侣浏览器 Companion Browser: `Claude-Local-Browser`

---

## 中文说明

### 核心更新摘要

`v0.3.6` 承接 `v0.3.5` 桌面工作台去 AI 基线，参考「快速配置」的视觉密度与栅格秩序，对 **「浏览环境」「电脑环境」「网络环境」与「风控验证」四大核心页面** 进行系统性重构与二次像素级打磨，彻底消除历史样式冲突引发的错位留白、多层嵌套卡片与窄屏折行失衡，并保持全部加密保险库、隔离槽位与进程守卫边界 100% 不变：

1. **统一环境样式底座与容器响应式契约（`src/env-pages.css`）**
   - 确立基于 `@container` 的共享 4 栏发丝分割遥测条（`.env-telemetry-strip`）、`.settings-group-heading` 区块标头、边到边发丝分隔核验/域名矩阵与去嵌套边框规范，通过精确作用域优先级完全取代 `style.css` 历史遗留卡片规则。

2. **「浏览环境」双区控制与遥测去重重构（`src/browser.tsx`）**
   - **消除顶卡横轴留白**：移除导致右侧 ~30% 空洞的错误居中类，重构为全宽双区操作控制栏 + 4 栏去重遥测条（活跃 CLI 身份与关联状态、当前浏览器资料与内核版本、代理路由与断路器守护、核验范围边界），消除次行重复回显身份名的冗余文案；
   - **矩阵与场景卡片齐平**：核验矩阵改为边到边双列发丝网格；底部合并为「日常释放缓存 / 深度重置当前浏览器」双列横向卡片；展开态「环境与代理设置」统一采用 `16px` 水平内距并对齐 `@container browser-env (max-width: 580px)` 单列断点。

3. **「电脑环境」美区基线对齐与定位按钮去重（`src/system.tsx`）**
   - **基线条层级对齐**：顶部 4 栏升级为美区基线遥测条，「本机语言 / 区域」栏展示可读语言名与区域代号层级（如 `English` / `en-US`），分组标头右侧保留纯净等宽目标基线（`America/Los_Angeles · America/New_York · en-US`）；
   - **三行卡片与按钮精简**：消除双重内距空洞并将「目标时区 / 目标语言」控件改为水平内联单行基线；当系统定位已确认为「已关闭」时省略右侧冗余的禁用「已关闭定位」按钮，仅保留「打开定位设置」。

4. **「网络环境」链式拓扑遥测与无跳动诊断（`src/vps.tsx`）**
   - 新增顶部 4 栏双跳链式代理拓扑遥测条（`iKuuu` 前置专线 → `Kookeey` 美国家宽 → `:7899` 防漏入口 → 四域名连通状态）；
   - 三张配置卡补齐 `28×28` 图标徽章、角色药丸、强调色微混悬停边框与底部分步发丝栏，仅保留授权只读复制动作；复制反馈固定于页头右上角状态胶囊彻底消除页面跳动；四域名诊断升级为边到边 2×2 发丝矩阵并完善深色模式语义色。

5. **「风控验证」模块化工作台重建（`src/risk-verification.tsx` / `src/risk-verification.css`）**
   - 拆解多层套娃巨型卡片为四大清晰正交模块：
     1. **态势顶栏 + 4 栏紧凑去重遥测条**：对齐 `13.5px` / `11.5px` 排版与前缀去重（完整说明与告警保留至悬浮提示），允许首栏作用域声明完整两行展示，底部紧贴单行「为什么核验」说明；
     2. **「DNS 防漏与 KYC 跨域核验」双层 3 列发丝矩阵**：补充 `.settings-group-heading` 标头，全部断点迁移至 `@container risk-env`（`≥ 700px` 三列均分、窄屏直接转单列杜绝 `2+1` 孤儿空洞）配贴底修复栏；
     3. **手机扫码 KYC 同源桥接**：拆分标题 3 枚网络边界徽章 + 二维码下方语义对应徽章（避免英文标题徽章换行），LAN 表单与离线矢量二维码列等高拉伸消除底部空隙，Clash Mi 等非小火箭独立双跳模式采用卡片全宽贴边发丝分隔；
     4. **6 步前置飞行清单**：顶部双栏防风控提示条（真机铁律 vs PayPal/Stripe 跨区清理直达）配齐整 2×3 发丝清单网格。

6. **双语目录与兼容性边界（`src/locales/zh.yaml` / `src/locales/en.yaml`）**
   - 新增并同步 33 组工作台遥测与分组文案（全目录 `2,867` 个键值与插槽保持 100% 中英对齐）；完整保留 `.identity-card`（`166×286`）、`.browser-verification-page` / `.browser-start` / `.verification-*` 验证页几何、以及所有既有数据与隐私边界。

### 兼容性与无损升级说明

- **数据格式 100% 向下兼容**：完整保留 `BAGAID01` 魔数、`.baga` 归档编码、SQLite `user_version = 3`、账号 HMAC 规则、既有浏览器种子字符串以及 `%APPDATA%\ai.local.claude-local` 私有目录结构。
- **平滑无中断升级**：支持从 `0.1.x`、`0.2.x`、`0.3.0`、`0.3.1`、`0.3.2`、`0.3.3` 或 `0.3.5` 直接安装升级至 `0.3.6`，保留所有已有身份、密钥与隔离浏览器资料，绝不中断正在运行的 `claude.exe` 会话。
- **校验与核验**：安装程序构建与隐私核验汇总于随附 `SHA256SUMS.txt`；安装前可用 PowerShell 校验：
  ```powershell
  Get-FileHash .\Claude-Local_0.3.6_x64-setup.exe -Algorithm SHA256
  ```

---

## English Release Notes

### Highlights

Building on the `v0.3.5` UI De-AI baseline and adopting the **Quick Setup** density standard, **`v0.3.6`** overhauls **Browser, Computer, Network, and Risk & KYC** with unified container-queried architecture and a second-pass visual polish — eliminating legacy CSS leaks, dead horizontal space, nested boxes, and awkward narrow wraps while keeping every storage format, isolation boundary, and process guard intact:

1. **Shared Environment Styling & Container Query Contract (`src/env-pages.css`)**
   - Establishes a shared `@container`-driven 4-column hairline telemetry strip (`.env-telemetry-strip`), `.settings-group-heading` bars, edge-to-edge diagnostic/domain hairline matrices, and scoped selectors that cleanly supersede legacy `style.css` rules without affecting `.identity-card` (`166×286`) or the companion browser verification page.

2. **Browser Environment Overhaul & Telemetry De-duplication (`src/browser.tsx`)**
   - Eliminates the ~30% trailing blank gap caused by legacy `network-action-card` styling with a full-width two-zone hero bar and de-duplicated 4-cell telemetry strip (active CLI identity & link status, selected profile & engine version, proxy route & Kill-Switch, verification scope).
   - Aligns the 2-column observation matrix, horizontal cache/reset scenario cards, `16px`-inset advanced settings accordion, and `@container browser-env (max-width: 580px)` responsive breakpoint.

3. **Computer Environment Baseline & Location Control Cleanup (`src/system.tsx`)**
   - Adds a 4-cell US baseline telemetry strip (`Timezone`, `English / en-US` language hierarchy, `Location`, `Target Region`) above a unified 3-row inset settings card with single-line horizontal `.system-inline-controls` and clean monospace target specs (`America/Los_Angeles · America/New_York · en-US`).
   - Omits the redundant disabled `Location disabled` button when system location is already confirmed off, leaving only `Location settings`.

4. **Network Environment Chain Topology & Jitter-Free Probes (`src/vps.tsx`)**
   - Adds a 4-cell two-hop proxy chain topology strip (`iKuuu` transit → `Kookeey` US residential → `127.0.0.1:7899` anti-leak listener → 4-domain status), equal-height 3-column setup cards with subtle accent hover states and copy-only referral actions, a fixed header copy-status pill (zero vertical layout shift), and an edge-to-edge 2×2 hairline connectivity matrix.

5. **Risk & KYC 4-Module Workbench Rebuild (`src/risk-verification.tsx` / `src/risk-verification.css`)**
   - Splits the oversized nested container into four crisp modules:
     1. **Posture Banner + Compact 4-Cell Telemetry Strip**: Aligns `13.5px` / `11.5px` typography and strips redundant prefixes (preserving full details & warnings on hover tooltips), renders the full two-line browser-scope disclaimer without ellipsis clipping, and tucks `Why verify` cleanly into a single-line footer;
     2. **Unified 2-Tier 3-Column Hairline Audit/Probe Matrix**: Adds the `DNS Anti-Leak & KYC Exit Audit` `.settings-group-heading` and migrates breakpoints to `@container risk-env` (3 balanced columns above `700px`, switching straight to 1 column below to avoid `2+1` orphan slots) with a flush remediation bar;
     3. **Mobile KYC Residential Bridge**: Keeps 3 single-line boundary pills in the section header while placing ephemeral-auth / offline-QR pills truthfully beneath the equal-height QR column (offline-QR only in Shadowrocket standalone mode), and gives standalone non-Shadowrocket clients a full-width edge-to-edge hairline footer bar;
     4. **6-Step Pre-KYC Flight Checklist**: 2-column hardware/PayPal-cookie header banner paired with a balanced `2×3` hairline grid.

6. **Bilingual Catalog & Backward Compatibility (`src/locales/zh.yaml` / `src/locales/en.yaml`)**
   - Synchronizes 33 new workbench telemetry & section keys (`2,867` total keys matched across Chinese and English) with zero missing slots or hardcoded UI text.

### Compatibility & Non-Disruptive Upgrade

- **Full Backward Compatibility**: `BAGAID01` vault headers, `.baga` archives, SQLite `user_version = 3`, account HMAC rules, legacy browser seed strings, and `%APPDATA%\ai.local.claude-local` paths remain unchanged.
- **Seamless In-Place Upgrade**: Upgrades directly from `0.1.x`, `0.2.x`, `0.3.0`, `0.3.1`, `0.3.2`, `0.3.3`, or `0.3.5` to `0.3.6` without re-creating identities or interrupting active `claude.exe` sessions.
- **Checksums**: Compare `Claude-Local_0.3.6_x64-setup.exe` against the published `SHA256SUMS.txt` asset via:
  ```powershell
  Get-FileHash .\Claude-Local_0.3.6_x64-setup.exe -Algorithm SHA256
  ```

---

## Attribution & License

- Maintained in this repository as an independent Windows x64 project under the [MIT License](../LICENSE) with preserved third-party copyright notices in [NOTICE](../NOTICE.md).

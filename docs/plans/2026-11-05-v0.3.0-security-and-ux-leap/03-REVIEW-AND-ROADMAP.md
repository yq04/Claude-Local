<!--
[INPUT]: 第一轮 3 阶段 6 批次代码实现、第二轮双子代理（Security & Cleanroom Boundary Auditor + UX, Smart Relay & Wakeup Auditor）全量交叉审计报告、第二轮双子代理（Phase 1 Finisher + Phase 2/3 Finisher）闭环精修结果、全仓 Bun/Vite/Rust 测试验收数据。
[OUTPUT]: Claude-Local v0.3.0 改进优化全量清单（含首轮实现与二轮深度复审补漏对照表）、安全边界验证结论，以及面向用户最终审查与后续发布确认的分步方案。
[POS]: v0.3.0 实施收官与复审总报告；供用户进行最终代码与方案审查。
[PROTOCOL]: 未获用户最终确认前，绝不执行本地热更新（deploy）、安装包构建（build:windows）或代码上传（git push）。
-->
# Claude-Local v0.3.0 深度复审报告、优化成果全览与后续推进方案

## 一、 执行摘要（Executive Summary）

围绕 `Claude-Local v0.3.0` **「使用、体验、交互、切换、反馈、动画」** 与 **「安全、风控、防护、隔离、接力、唤醒（续杯）」** 双轨跃迁目标，我们完成了：
1. **第一阶段：二进制取证与开源对标**：对本机 `claude.exe v2.1.318` 执行偏移级逆向分析（提取 8 大类 35+ 核心外联域名与 16 项账号绑定缓存键），并对标剖析 6 个标杆开源项目（`yetone/magpie`、`stablyai/orca`、`farion1231/cc-switch`、`realiti4/claude-swap`、`lbjlaq/Antigravity-Manager`、`jlcodes99/cockpit-tools`）。
2. **第二阶段：3 阶段 6 批次（Batch 1A ～ Batch 3B）核心功能落地**：完成净室切号隔离、OAuth 新路由守卫、全域名防漏升级、CLI 遥测与 MCP 供应链只读体检、智能接力 2.0、唤醒前后锚点验真、三段式净室反馈与悬浮窗 2.0。
3. **第三阶段：多子代理二轮交叉审计与闭环补漏**：派发 2 个专项审计子代理对前后端全部改动进行了逐行复审，精准揪出 **8 项深层接线与边界遗漏**，随后派发 2 个专项精修子代理在无冲突文件分区上 100% 闭环修复并通过全量测试。

---

## 二、 二轮子代理深度复审：发现的 8 项遗漏与闭环修复对照表

在第二轮专项审计中，子代理重点排查了「模型已定义但 UI 未接线」「桌面端已覆盖但移动端规则漏配」「空账号或超大遥测文件边缘分支」等隐患，并已全部修复完毕：

| 编号 | 审计维度 | 二轮审计发现的遗漏 / 隐患 | 闭环修复内容与代码落点 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| **R2-1** | **Phase 1 · 净室锁与遥测死信** | 1. `clear_stale_locks()` 仅在 `maintain_account_caches()` 与 `stop_processes()` 调用，未在写入 `.claude.json` 前的 `apply_config()` 入口调用；<br>2. `maintain_account_caches()` 在 `acct == None`（登出/空身份）时提前返回，跳过了 `.claude/telemetry` 与目录清理；<br>3. 漏清理 `.claude/statsig` 目录；<br>4. `1p_failed_events.*.json` 超过 4 MiB 时 `continue` 跳过未删除，且同账号跨组织切换未校验 `organizationUuid`。 | 在 [`src-tauri/src/cleaner_identity.rs`](../../../src-tauri/src/cleaner_identity.rs) 中：<br>1. 在 `apply_config()` 入口前置调用 `clear_stale_locks(root_dir)`；<br>2. 无论 `acct` 是否为 `None`，均强制清理 `.claude/plugins/synced`、`.claude/cache/model-catalog` 与 **`.claude/statsig`**；<br>3. 对 `> 4 MiB` 的死信遥测文件直接安全移除（避免读入内存），并增加 `organizationUuid` / `organization_uuid` 跨组织比对。 | ✅ 已修复并单测验证 |
| **R2-2** | **Phase 1 · 移动端桥接防漏规则** | `buildDesktopMihomoAntiLeakYaml()` 已补齐 `v2.1.318` 域名，但 `buildShadowrocketUniversalAntiLeakConf()` 与 `buildMobileBridgeConfig()`（`shadowrocket` / `clash-mi` / `stash` / `sing-box` 四个分支）仅依赖兜底 `FINAL`/`MATCH`，未显式写入高优先级 Claude 与遥测防漏域名规则。 | 在 [`src/risk-model.ts`](../../../src/risk-model.ts) 中新增 `MOBILE_ANTI_LEAK_DOMAIN_SUFFIXES` 与 `DOMAIN-KEYWORD,datadoghq`，在通用小火箭配置与全部 4 类移动端桥接配置中显式注入 `claude.com`、`browser-intake-us5-datadoghq.com`、`growthbook.io`、`withpersona.com` 等 28+ 核心后缀规则，并同步更新 [`src/risk-model.test.ts`](../../../src/risk-model.test.ts)。 | ✅ 已修复并单测验证 |
| **R2-3** | **Phase 1 · 残留面板 CLI/MCP 体检条** | 首轮仅在风控页（`src/risk-verification.tsx`）展示了 CLI 遥测护盾与 MCP 供应链体检胶囊，未按计划同步接入身份页底部的「Claude 文件残留」面板（`src/claude-residue-panel.tsx`）。 | 在 [`src-tauri/src/cleaner.rs`](../../../src-tauri/src/cleaner.rs) 与 [`src-tauri/src/cleaner_residue.rs`](../../../src-tauri/src/cleaner_residue.rs) 的 `Scan` 结构中附带 `cli_security` 快照，并在 [`src/claude-residue-panel.tsx`](../../../src/claude-residue-panel.tsx) 顶部渲染「CLI 遥测护盾 + MCP 供应链边界」体检条与一键复制修复配置按钮。 | ✅ 已修复并单测验证 |
| **R2-4** | **Phase 2 · 动态切换裕度防抖接线** | `meetsDynamicSwitchMargin()`（借鉴 `stablyai/orca` 的 `min(activeRem * 2, activeRem + 3%)` 动态防抖裕度）在 [`src/smart-relay-model.ts`](../../../src/smart-relay-model.ts) 中已定义并导出，但在 `evaluateSmartRelay()` 内部未被调用，导致当前账号未耗尽时仍可能无条件提示 `better_candidate`。 | 在 [`src/smart-relay-model.ts`](../../../src/smart-relay-model.ts) 的 `evaluateSmartRelay()` 中接入 `meetsDynamicSwitchMargin(topStrategySaved, currentCandidate)`，当活跃账号未耗尽且候选账号未超越动态防抖裕度时抑制乒乓切换推荐。 | ✅ 已修复并单测验证 |
| **R2-5** | **Phase 2 · 限流冷却自动挂起与单向防回跳锁** | 1. 界面已有「解除冷却」按钮，但在线配额刷新或唤醒返回 `rate_limited` 时未自动触发冷却记录；<br>2. `identities.tsx` 的 `change()` 调用 `noteRelayAccountSwitch(previousActiveId, target.id)` 时漏传第 3 个参数 `previousReset5hSec`，导致 `noReturnAccountId` 单向防回跳锁未生效。 | 1. 在 [`src/smart-relay-model.ts`](../../../src/smart-relay-model.ts) 新增 `noteRelayAccountRateLimited()`，并在 [`src/identities.tsx`](../../../src/identities.tsx) 的批量配额进度、快照采纳与单账号唤醒遇到 `rate_limited` 时自动挂起冷却；<br>2. 在 `change()` 中捕获 `previousReset5hSec` 并传入 `noteRelayAccountSwitch(previousActiveId, target.id, previousReset5hSec)`。 | ✅ 已修复并单测验证 |
| **R2-6** | **Phase 2 · 唤醒前后 5h 锚点验真接线** | `verifyWakeupAnchorAdvancement()` 在 [`src/wakeup-presentation.ts`](../../../src/wakeup-presentation.ts) 中已实现，但未在 [`src/identities.tsx`](../../../src/identities.tsx) 的 `wakeupSingleAccount()` 中调用展示。 | 在 [`src/identities.tsx`](../../../src/identities.tsx) 的 `wakeupSingleAccount()` 中调用 `verifyWakeupAnchorAdvancement()`，按账号记录 `wakeupAnchorMap`，在唤醒反馈消息与唤醒抽屉账号行渲染「✓ 已开启全新 5h 周期 / 沿用当前活跃 5h 周期 / 5h 重置锚点待核验」徽章。 | ✅ 已修复并单测验证 |
| **R2-7** | **Phase 2/3 · 净室审计时间线 UI 渲染** | `useCleanupActivity()` 已在内存维护最近 20 条 `AuditHistoryItem[]`（`activity.history`），但 [`src/cleaner-activity.tsx`](../../../src/cleaner-activity.tsx) 的 JSX 尚未渲染该历史列表。 | 在 [`src/cleaner-activity.tsx`](../../../src/cleaner-activity.tsx) 底部新增可折叠 `<Disclosure>`「最近净室与切换审计记录（N）」，展示每次操作的状态图标、本地化标题/详情与精确耗时（秒）。 | ✅ 已修复并验证 |
| **R2-8** | **Phase 3 · 诚实 99% 规则、浮窗进度条与呼吸光环选择器** | 1. 浮窗 `computeMonitorWindowBar()` 在 `99.6%` 已用（剩余 `0.4%`）时因 `Math.round` 导致 `fillWidthPct` 坍缩为 `0%`；<br>2. 浮窗 `formatPaceTooltip()` 调用 `t('monitor.paceTickTooltip')` 漏传 `used` 参数；<br>3. 智能接力横幅与 `identity-quota.ts` 仍使用 `Math.round` 或原始浮点拼接；<br>4. 激活卡呼吸光环 CSS 选择器写成了 `.identity-card.current-identity`，而实际 DOM 类名为 `.identity-card.current`。 | 1. 修复 [`src/floating-monitor-model.ts`](../../../src/floating-monitor-model.ts) 在 `99.6%` 已用时保留 `4%` 最小可见宽度，并在 [`src/floating-monitor.tsx`](../../../src/floating-monitor.tsx) 补传 `used: bar.usedLabel`；<br>2. 在 [`src/identities.tsx`](../../../src/identities.tsx) 智能接力横幅与 [`src/identity-quota.ts`](../../../src/identity-quota.ts) 全面改用 `formatTruthfulPercent()`；<br>3. 在 [`src/identity-productivity.css`](../../../src/identity-productivity.css) 修正选择器为 `.identity-card.current, .identity-card.current-identity`。 | ✅ 已修复并单测验证 |

---

## 三、 `Claude-Local v0.3.0` 全量改进与优化成果总览

### 3.1 安全、风控、防护与净室隔离轨（Security & Cleanroom Isolation）

1. **跨账号遥测死信投毒阻断（[`src-tauri/src/cleaner_identity.rs`](../../../src-tauri/src/cleaner_identity.rs)）**：
   - 切号执行 `maintain_account_caches()` 时，自动扫描 `~/.claude/telemetry/1p_failed_events.*.json`，一旦发现死信批次内的 `account_uuid` 或 `organization_uuid` 与当前目标身份不一致（或文件异常超大/无活跃身份），立即通过安全边界校验（防符号链接穿透）予以物理清除，彻底阻断“B 账号用自身代理与 Token 替 A 账号重发遥测日志”的跨号关联漏洞。
   - 同步强制清理 `.claude/statsig`、`.claude/plugins/synced` 与 `.claude/cache/model-catalog`。
2. **16 项 `v2.1.318` 账号绑定缓存键与三锁协同防护（[`src-tauri/src/cleaner_config.rs`](../../../src-tauri/src/cleaner_config.rs)、[`src-tauri/src/cleaner_identity.rs`](../../../src-tauri/src/cleaner_identity.rs)）**：
   - 将 `ACCOUNT_KEYS` 从原有的 8 项扩展至 **16 项**，新增 `additionalModelOptionsCache`、`claudeAiMcpEverConnected`、`clientDataCache`、`clientDataCacheSlots`、`connectorOAuthCache`、`modelAccessCache`、`orgModelDefaultCache`、`penguinModeOrgEnabled`（同时严守 `s13` 设备指纹保护红线，绝不误删 `userID` 64 位设备 ID 与客户端实验门控键）。
   - 在 `apply_config()` 写入 `.claude.json` 前及 `maintain_account_caches()` 中协同清理过期锁文件（`.claude/.oauth_refresh.lock`、`.claude/.storage-write.lock`、`.claude.json.lock`）。
3. **新版 OAuth 授权路由守卫（[`src-tauri/src/browser/oauth_route.rs`](../../../src-tauri/src/browser/oauth_route.rs)）**：
   - `authorization_endpoint()` 新增识别 `v2.1.318` 迁移后的 `https://claude.com/cai/oauth/authorize`（严格校验 HTTPS + `code_challenge` PKCE + loopback `redirect_uri`），确保 CLI `/login` 授权请求被伴生浏览器 `IdentityGuard` 精准拦截并路由至独立身份容器，同时明确排除控制台 API Key 铸造域名 `platform.claude.com`。
4. **八大类 35+ 外联域名全覆盖与连字符遥测拦截（[`src/risk-model.ts`](../../../src/risk-model.ts)、[`src/vps.tsx`](../../../src/vps.tsx)、[`src-tauri/src/risk_check.rs`](../../../src-tauri/src/risk_check.rs)）**：
   - 针对 `browser-intake-us5-datadoghq.com` 连字符域名绕过 `DOMAIN-SUFFIX,datadoghq.com` 的问题，在桌面端 Mihomo、移动端小火箭（Shadowrocket）、Clash Mi、Stash、Sing-box 及 AI 诊断提示词中全面加入 `DOMAIN-KEYWORD,datadoghq`、`browser-intake-us5-datadoghq.com`、`growthbook.io`、`storage.googleapis.com`、`claude.app/dev/site`、`ant.dev`、`anthropic.dev`。
   - `inspect_mihomo_config()` 新增 `has_telemetry_rules` 检查项并在风控页展示「Datadog/遥测分流：已覆盖」胶囊。
5. **只读式 CLI 遥测护盾 & MCP 供应链边界体检（[`src-tauri/src/risk_check.rs`](../../../src-tauri/src/risk_check.rs)、[`src/risk-verification.tsx`](../../../src/risk-verification.tsx)、[`src/claude-residue-panel.tsx`](../../../src/claude-residue-panel.tsx)）**：
   - 只读扫描 `~/.claude/settings.json`、`.claude.json` 与 `.mcp.json`（绝不自动写入用户配置）：
     - 检查 3 项 CLI 遥测免疫环境变量（`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`、`DISABLE_TELEMETRY`、`DISABLE_ERROR_REPORTING`）；
     - 统计未锁定版本（`@latest` 或无版本号）的 `npx -y` / `bunx` / `uvx` MCP 服务与外联公网 SSE/HTTP MCP 端点；
   - 在「风控核验页」与「身份页 Claude 文件残留面板」同步展示体检状态，并提供一键复制 `settings.json` 防漏合并片段。

### 3.2 智能接力 2.0、唤醒/续杯 2.0 与交互微动效轨（UX, Smart Relay 2.0 & Wakeup 2.0）

1. **智能接力 2.0（[`src/smart-relay-model.ts`](../../../src/smart-relay-model.ts)、[`src/identities.tsx`](../../../src/identities.tsx)）**：
   - **诚实 99% 规则（`formatTruthfulPercent`）**：借鉴 `claude-swap`，当已用配额处于 `99.05% ~ 99.99%`（或剩余处于 `0.01% ~ 0.94%`）时精确显示 1 位小数（如 `99.4%` 已用 / `0.6%` 剩余），仅在真实达到 `100%` 时显示 `100%`，彻底消除“明明还有额度却显示 100% 已耗尽”的焦虑与误判。
   - **时间感知燃尽配速差（`computeWindowPaceDelta`）**：实时计算 5h / 7d 窗口的「已用百分比 − 时间流逝百分比」，在身份卡片与悬浮窗展示 `超前 +18%`（琥珀色预警）或 `余量 -12%`（翡翠绿安全）胶囊。
   - **动态防抖切换裕度（`meetsDynamicSwitchMargin`）**：借鉴 `stablyai/orca`，在活跃账号未耗尽前，候选账号必须满足 `min(activeRem * 2, activeRem + 3%)` 的领先裕度才触发 `better_candidate` 推荐，杜绝双账号剩余相近时的乒乓抖动。
   - **单向防回跳锁（`noReturnAccountId`）**：切出旧账号时记录其 `quota_5h_reset_at`，在旧账号 5h 窗口真正重置前禁止自动接力回跳。
   - **限流冷却禁闭与一键解除（`noteRelayAccountRateLimited` / `clearAccountCooldown`）**：在线配额刷新或唤醒遇到 `rate_limited` 时自动挂入 15 分钟（或 `retry_at`）冷却期，在候选列表显示「冷却中」徽章与「解除冷却」按钮。
2. **唤醒/续杯 2.0 前后锚点验真（[`src/wakeup-presentation.ts`](../../../src/wakeup-presentation.ts)、[`src/identities.tsx`](../../../src/identities.tsx)）**：
   - 唤醒完成后调用 `verifyWakeupAnchorAdvancement(beforeResetSec, afterResetSec, nowSec)`，自动比对唤醒前后的 5h 重置时间戳，在唤醒抽屉反馈栏与账号行直观标识：
     - `✓ 已开启全新 5h 周期`（绿色确认）；
     - `沿用当前活跃 5h 周期`（中性提示）；
     - `5h 重置锚点待核验`（警告提示）。
3. **三段式净室切换管线与可折叠审计时间线（[`src/cleaner-activity.tsx`](../../../src/cleaner-activity.tsx)）**：
   - 切号与清理进度条顶部渲染三段式宏观管线胶囊：`① 进程与三锁校验` ➔ `② 账号缓存与遥测净室隔离` ➔ `③ 浏览器与出口对齐`。
   - 底部提供可展开的「最近净室与切换审计记录」，保留最近 20 次操作的状态、消息与耗时（秒）。
4. **悬浮监控窗 2.0、激活卡呼吸光环与后台动画节能（[`src/floating-monitor.tsx`](../../../src/floating-monitor.tsx)、[`src/identity-productivity.css`](../../../src/identity-productivity.css)、[`src/main.tsx`](../../../src/main.tsx)）**：
   - 悬浮窗全面接入诚实百分比、`formatWindowPaceBadge()` 5h 燃尽配速胶囊与完整的时间刻度 Tooltip。
   - 当前活跃 CLI 身份卡片增加柔和的 `.identity-card.current` 呼吸边框光环（遵循 `prefers-reduced-motion`）。
   - 主窗口隐藏至托盘或不可见时自动挂载 `document.documentElement.dataset.windowHidden = 'true'` 暂停全部无限循环 CSS 动画，确保后台零 GPU/CPU 空转开销。

---

## 四、 全量自动化验证结果（Verification Matrix）

所有测试均在隔离合成数据下运行，未触碰任何真实账号、未中断任何运行中的 `claude.exe`：

| 验证维度 | 执行命令 | 结果 | 关键覆盖明细 |
| :--- | :--- | :--- | :--- |
| **前端全量单元测试** | `bun test` | **182 pass, 0 fail**<br>（26 个测试文件，14,048 次断言） | 含 `risk-model.test.ts` (12 pass)、`smart-relay-model.test.ts` (18 pass)、`wakeup-presentation.test.ts` (6 pass)、`floating-monitor-model.test.ts` (12 pass)、`i18n.test.ts` 中英双语键 100% 对齐校验。 |
| **TypeScript 类型与生产构建** | `bun run build` (`tsc --noEmit && vite build`) | **0 errors** | 生产级前端 Bundle 构建通过。 |
| **Rust 净室与身份存储测试** | `cargo test --manifest-path src-tauri/Cargo.toml identities::optimization_tests` | **14 pass, 0 fail** | 验证 16 项 `v2.1.318` 账号缓存键清理、`.claude/telemetry/1p_failed_events.*.json` 跨号死信清除、`.claude/statsig` 清理与 `.claude/.storage-write.lock` 过期锁清理。 |
| **Rust 清理器与残留扫描测试** | `cargo test --manifest-path src-tauri/Cargo.toml cleaner::` | **26 pass, 0 fail** | 含 `cleaner::tests` (19 pass，包括 `s13_account_cleanup_preserves_device_and_client_state`) 与 `cleaner::residue::tests` (7 pass)。 |
| **Rust 浏览器 OAuth 路由守卫测试** | `cargo test --manifest-path src-tauri/Cargo.toml browser::oauth_route` | **2 pass, 0 fail** | 验证 `claude.ai/oauth/authorize` 与 `claude.com/cai/oauth/authorize` 均被精准识别，`platform.claude.com` 被排除。 |
| **Rust 风控与 CLI/MCP 边界审计测试** | `cargo test --manifest-path src-tauri/Cargo.toml risk_check` | **13 pass, 0 fail** | 验证 `has_telemetry_rules` 与 `audit_claude_cli_security_dir` 对遥测护盾和未锁版本/远端 MCP 的只读识别。 |

---

## 五、 接下来的推进方案（等待您最终审查确认）

根据您的指令，我们目前**严格保持在「仅源码与测试就绪，不执行本地热更新、不打包、不上传」的待审状态**。请您审阅上述改动与本目录下的方案文档：

1. **第一步：您审查确认代码与功能细节**
   - 您可以直接检阅本报告及对应源码文件（点击上方链接即可跳转至具体文件与行号）。
   - 若您对任何文案、阈值（如冷却默认 15 分钟、动态防抖裕度 3% 等）或 UI 布局有微调意见，请随时指出，我将立即精修。
2. **第二步：获您明确授权后，按序执行版本号升级、构建、热更新与发布操作**
   - 待您确认“可以开始打包/更新”后，我们将严格按以下标准流程执行：
     1. **统一递增版本号至 `0.3.0`**：同步更新 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`HANDOFF.md` 与 `CHANGELOG.md`；
     2. **安全本地热更新（或安装体验）**：先检查是否存在正在运行的 `claude.exe`（绝不打断正在工作的 CLI 会话），仅替换 `Claude-Local` 桌面端二进制进行实机核验；
     3. **构建正式版 Windows NSIS 安装包**：运行 `bun run build:windows`（自动携带 `--features custom-protocol`），校验产物 `claude-local_0.3.0_x64-setup.exe`；
     4. **Git 提交与归档**：确认 `.local/` 等临时调研目录完全处于 `.gitignore` 保护下，提交代码并在您授权时推送远端仓库。

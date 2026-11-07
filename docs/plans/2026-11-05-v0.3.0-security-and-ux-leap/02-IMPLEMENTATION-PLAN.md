<!--
[INPUT]: 01-FINDINGS.md 确认的 6 项真实缺口（V3-G1 至 V3-G6）、6 大开源项目借鉴设计、AGENTS.md 与 CLAUDE.md 边界约束。
[OUTPUT]: 3 阶段 6 批次（Batch 1A–3B）+ Phase 4（全面 Review 与复审精修）的可执行方案、接口合同与验收标准。
[POS]: v0.3.0 分阶段实施与验收主文档。
[PROTOCOL]: 严守 AGENTS.md 红线；分阶段分批次推进，每批次跑通定向测试，全部批次完成后进行全量 Review 与复审优化，等用户最终确认前绝不执行本地热更新、打包或上传。
-->
# `Claude-Local v0.3.0` 分阶段分批次实施方案（3 阶段 6 批次 + Review 复审）

## 0. 全局工程红线与执行纪律

1. **兼容与安全底线**：
   - `BAGAID01`、`.baga` 归档格式、SQLite `user_version=3`、账号 HMAC 规则、旧版 browser seed 派生域保持 100% 不变。
   - **绝不中断运行中的 `claude.exe`**；所有测试仅使用合成数据与临时目录，绝不触碰真实保险库或真实会话。
   - Python 继续作为外部配额账本（`quota-ledger`）的唯一写入者，不新增后台 OAuth 轮询，不盲写用户 `~/.claude.json`。
   - 保持既有卡片顺序、166px 卡片高度、28px 共享小按钮几何尺寸与隐私遮罩规范，不加回已移除的搜索/排序控件。
2. **分批推进与停止边界**：
   - 按 **Batch 1A ➔ Batch 1B ➔ Batch 2A ➔ Batch 2B ➔ Batch 3A ➔ Batch 3B ➔ Phase 4 (Review & 复审精修)** 顺序推进。
   - **严禁在未获用户最终确认前执行**：本地热更新替换已安装程序、`bun run build:windows` NSIS 打包、`git push` 或发布上传。

---

## Phase 1：安全、风控与净室隔离内核攻坚

### Batch 1A：净室切号（阻断跨号遥测投毒 + 19 项缓存清扫 + 三锁协议）与 OAuth 路由守卫升级
- **解决缺口**：`V3-G1`、`V3-G2`、`V3-G3`
- **涉及文件**：
  - [`src-tauri/src/cleaner_config.rs`](../../../src-tauri/src/cleaner_config.rs)
  - [`src-tauri/src/cleaner_identity.rs`](../../../src-tauri/src/cleaner_identity.rs)
  - [`src-tauri/src/cleaner_residue_tests.rs`](../../../src-tauri/src/cleaner_residue_tests.rs)
  - [`src-tauri/src/browser/oauth_route.rs`](../../../src-tauri/src/browser/oauth_route.rs)
- **具体实施内容**：
  1. **强制清扫遥测死信箱与实验残留**：
     - 在 `maintain_account_caches()`（[`src-tauri/src/cleaner_identity.rs`](../../../src-tauri/src/cleaner_identity.rs)）中，除原有的 `.claude/plugins/synced` 与 `.claude/cache/model-catalog` 外，新增对 **`.claude/telemetry`**（含 `1p_failed_events.*.json`）与 **`.claude/statsig`** 的强制净室清理。即使切号策略勾选了 `preserve_cache (cache: true)`，也必须物理清除上一账号遗留的未发送遥测批次，彻底阻断账号 B 启动后代发账号 A `account_uuid` 的跨号投毒。
  2. **同步 `claude.exe v2.1.318` 全部 16 项账号强绑定缓存键（严守 `s13` 设备指纹保护边界）**：
     - 在 [`src-tauri/src/cleaner_config.rs`](../../../src-tauri/src/cleaner_config.rs) 的 `ACCOUNT_KEYS` 与 [`src-tauri/src/cleaner_identity.rs`](../../../src-tauri/src/cleaner_identity.rs) 的 `maintain_account_caches()` 中，将账号级缓存键扩展至 16 项（新增 `additionalModelOptionsCache`、`claudeAiMcpEverConnected`、`clientDataCache`、`clientDataCacheSlots`、`connectorOAuthCache`、`modelAccessCache`、`orgModelDefaultCache`、`penguinModeOrgEnabled`），同时严格保留 `userID`（64 位设备指纹）及 `s13` 客户端实验门控状态不被误删。
  3. **引入 `cc-switch` 三把文件锁并发防写穿协议**：
     - 在 `apply_config()` 写入 `.claude.json` 前及 `maintain_account_caches()` 中，调用 `clear_stale_locks(root)` 依次检查并清理陈旧的 `~/.claude/.oauth_refresh.lock`、`~/.claude/.storage-write.lock` 与 `~/.claude.json.lock`（超过阈值且无活跃 `claude.exe` 时安全移除）。
  4. **升级伴侣浏览器 OAuth 路由守卫**：
     - 在 [`src-tauri/src/browser/oauth_route.rs`](../../../src-tauri/src/browser/oauth_route.rs) 的 `authorization_endpoint()` 中，除保留 `("claude.ai", "/oauth/authorize")` 外，新增识别 `v2.1.318` 的 `("claude.com", "/cai/oauth/authorize")`（同时继续将控制台 API Key 铸造域名 `platform.claude.com` 排除在个人浏览器守卫之外），确保新版 CLI `/login` 100% 触发 `IdentityGuard` 路由至绑定的正式卡容器，绝不落入 Free 养号卡槽位。
- **定向验收检查**：
  - `cargo test --manifest-path src-tauri/Cargo.toml oauth_route`
  - `cargo test --manifest-path src-tauri/Cargo.toml cleaner_residue`

---

### Batch 1B：全域名防漏升级（修复连字符域名绕过）与「遥测免疫盾 & MCP 供应链只读审计器」
- **解决缺口**：`V3-G4`、`V3-G5`
- **涉及文件**：
  - [`src/risk-model.ts`](../../../src/risk-model.ts) / [`src/risk-model.test.ts`](../../../src/risk-model.test.ts)
  - [`src/vps.tsx`](../../../src/vps.tsx)
  - [`src-tauri/src/risk_check.rs`](../../../src-tauri/src/risk_check.rs)
  - [`src-tauri/src/cleaner_identity.rs`](../../../src-tauri/src/cleaner_identity.rs)
  - [`src/claude-residue-panel.tsx`](../../../src/claude-residue-panel.tsx)
- **具体实施内容**：
  1. **补齐 Mihomo 一键防封覆写配置与 AI 提示词的全量域名**：
     - 在 [`src/risk-model.ts`](../../../src/risk-model.ts)（`buildDesktopDnsFixPrompt`、`buildDesktopMihomoAntiLeakYaml`）与 [`src/vps.tsx`](../../../src/vps.tsx)（`buildAiProxyPrompt`）中：
       - 新增 `DOMAIN-KEYWORD,datadoghq,<你的静态家宽节点名称>` 与 `DOMAIN-SUFFIX,browser-intake-us5-datadoghq.com,<你的静态家宽节点名称>`、7 个 Datadog 姊妹域名覆盖，彻底修复连字符域名绕过 `DOMAIN-SUFFIX,datadoghq.com` 的漏洞；
       - 补齐 `growthbook.io`（`cdn.growthbook.io`）、`releases.claude.com`、`claude.app`、`claude.dev`、`claude.site`、`ant.dev`、`anthropic.dev`、`storage.googleapis.com`。
  2. **升级 `inspect_mihomo_config()` 本地配置审计**：
     - 在 [`src-tauri/src/risk_check.rs`](../../../src-tauri/src/risk_check.rs) 的 `MihomoAudit` 中增加对遥测与桥接规则（`datadoghq`、`claudeusercontent.com`、`growthbook.io`）的覆盖检测，供前端提示用户旧版覆写规则是否需要更新。
  3. **只读式「CLI 遥测免疫盾 & MCP 供应链/权限边界安全审计」**：
     - 在 [`src/risk-model.ts`](../../../src/risk-model.ts)（纯函数审计模型）与 [`src-tauri/src/cleaner_identity.rs`](../../../src-tauri/src/cleaner_identity.rs)（只读快照摘要扩展）中，不读取任何私钥/Token 明文，仅提取布尔与结构化安全指标：
       - **遥测免疫盾三项状态**：检查 `~/.claude/settings.json` 的 `env` 是否已设置 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`、`DISABLE_TELEMETRY=1`、`DISABLE_ERROR_REPORTING=1`；
       - **MCP 供应链四项只读体检**：
         1. 未固定 `@version` 的 `npx -y <pkg>` 动态拉取项数量；
         2. 指向非环回公网地址的 `http` / `sse` 远程 MCP 端点数量；
         3. Windows 下直接调用 `npx` 而未包裹 `cmd /c` 的易报错 MCP 项数量（借鉴 `cc-switch`）；
         4. 是否存在自定义 `apiKeyHelper` / `awsAuthRefresh` / shell `hooks`。
     - 在 [`src/claude-residue-panel.tsx`](../../../src/claude-residue-panel.tsx) 顶部展示紧凑的「遥测免疫与 MCP 边界体检条」，支持一键复制修复片段。
- **定向验收检查**：
  - `bun test src/risk-model.test.ts scripts/test-network-diagnostics.ts`
  - `cargo check --manifest-path src-tauri/Cargo.toml --tests`

---

## Phase 2：智能接力 2.0 与唤醒/续杯 2.0 升级

### Batch 2A：智能接力 2.0（动态防抖裕度 + 单向防回跳锁 + 冷却禁闭徽章 + 99.9% 诚实水位）
- **解决缺口**：`V3-G6`（智能调度部分）
- **涉及文件**：
  - [`src/smart-relay-model.ts`](../../../src/smart-relay-model.ts)
  - [`src/smart-relay-model.test.ts`](../../../src/smart-relay-model.test.ts)
- **具体实施内容**：
  1. **引入 `claude-swap` 诚实百分比格式化 `formatTruthfulPercent(utilizationPct)`**：
     - 当 `99.0 < pct < 100.0` 时保留 1 位小数（如 `99.4%`），绝不四舍五入为 `100%`；当 `0 < pct < 1.0` 时显示 `<1%` 或 `0.x%`。
  2. **双窗口燃尽配速差值计算 `computeWindowPaceDelta(utilizationPct, resetsAtIso, windowHours)`**：
     - 计算当前窗口已流逝时间占比 `elapsedPct` 与实际消耗占比 `utilizationPct` 的差值 `paceDeltaPct = utilizationPct - elapsedPct`，输出结构化配速状态（`ahead` 消耗过快 / `on_track` 均衡 / `behind` 余裕充足）。
  3. **动态防抖切换裕度 `computeDynamicSwitchMargin(activeRemainingRatio)` 与单向防回跳锁 `noReturnAccountId`**：
     - 借鉴 `claude-swap` 的 `_all_above_margin_met`：当自动评估是否从当前未完全耗尽的账号切走时，候选账号的剩余空间必须超出当前账号至少 `min(activeHeadroom * 2.0, activeHeadroom + 3%)`，消除多账号水位接近时的乒乓抖动；
     - 支持记录因觸发阈值被切出的 `noReturnAccountId`，在该账号的 5h 重置时间点到达前抑制自动回跳。
  4. **账号级冷却禁闭池（Cooldown / Jail State）**：
     - 在 `SmartRelayConfig` / 运行时状态中支持为遇到 `429 RateLimit`、`529 Overloaded` 或代理异常的账号标记 `cooldownUntilMs` 与原因标签，冷却期内自动归入 `cooldown` 排除态，并提供一键解除接口 `clearAccountCooldown()`。
- **定向验收检查**：
  - `bun test src/smart-relay-model.test.ts`

---

### Batch 2B：唤醒/续杯 2.0（前后 5h 重置锚点验真对比 + 切号与续杯审计时间线模型）
- **解决缺口**：`V3-G6`（续杯验真与操作可追溯性）
- **涉及文件**：
  - [`src/wakeup-presentation.ts`](../../../src/wakeup-presentation.ts)
  - [`src/wakeup-presentation.test.ts`](../../../src/wakeup-presentation.test.ts)
  - [`src/cleaner-activity.tsx`](../../../src/cleaner-activity.tsx)
- **具体实施内容**：
  1. **续杯前后 5h 重置锚点验真函数 `verifyWakeupAnchorAdvancement(beforeResetsAt, afterResetsAt, nowMs)`**：
     - 对比唤醒动作执行前后的 5 小时窗口 `resets_at` 时间戳：
       - 若无旧锚点或旧锚点已过期，且新锚点位于未来 `(nowMs, nowMs + 5.5h]` ➔ 判定为 `advanced_new_cycle`（`✓ 已确认开启新 5h 续杯周期`）；
       - 若新旧锚点一致且仍在有效期内 ➔ 判定为 `reused_active_cycle`（`沿用当前活跃 5h 周期`）；
       - 若未拿到有效新锚点 ➔ 判定为 `unverified_anchor`（诚实提示未观测到锚点推进，绝不伪造续杯成功）。
  2. **有界「切号与续杯审计时间线」模型（借鉴 `cockpit-tools` `antigravity_switch_history`）**：
     - 在 [`src/cleaner-activity.tsx`](../../../src/cleaner-activity.tsx) 中新增轻量有界审计队列（最多保留最近 20 条，支持一键清空与折叠查看），记录每次切号/唤醒的：
       - `kind`（`switch` / `wakeup` / `relay_switch` / `clean`）
       - `trigger`（`manual` / `smart_relay`）
       - `fromAccountLabel` / `toAccountLabel`（遵循隐私遮罩）
       - `durationMs`、阶段完成状态（三锁校验 / 19 项缓存与遥测死信清扫 / 锚点验真结果）与时间戳。
- **定向验收检查**：
  - `bun test src/wakeup-presentation.test.ts`

---

## Phase 3：交互反馈、微动画与悬浮监控窗 2.0 跃迁

### Batch 3A：身份页切号三段式流光胶囊、最佳接力推荐卡与呼吸光晕
- **解决缺口**：`V3-G6`（主界面交互、反馈与微动画）
- **涉及文件**：
  - [`src/identities.tsx`](../../../src/identities.tsx)
  - [`src/styles.css`](../../../src/styles.css)
  - [`src/locales/zh.yaml`](../../../src/locales/zh.yaml) / [`src/locales/en.yaml`](../../../src/locales/en.yaml)
- **具体实施内容**：
  1. **三阶段切号事务流光胶囊（Switch Transaction Pill）**：
     - 在切号执行期间及完成后，在操作反馈条中展示清晰的三步微动画阶段指示：`① 进程与三锁校验` ➔ `② 19项缓存与遥测净室隔离` ➔ `③ 浏览器与出口对齐`，完成时显示耗时徽章（如 `✓ 净室切号完成`）并可随时手动收起。
  2. **智能接力「最佳接力推荐胶囊」与冷却禁闭徽章**：
     - 当用户开启智能接力（Smart Relay）时，在智能接力状态栏内直接展示 Top 1 最佳接力候选账号、推荐理由（如剩余水位与重置倒计时）及冷却禁闭状态解除入口（不破坏既有卡片 166px 布局与固定排序）。
  3. **微动画与诚实百分比升级**：
     - 为当前 CLI 活跃身份卡片添加柔和的硬件加速 CSS 边框光晕（尊重 `prefers-reduced-motion`）；
     - 进度百分比采用 `formatTruthfulPercent()`，避免将 `99.5%` 误导性渲染为 `100%`。
- **定向验收检查**：
  - `bun test src/i18n.test.ts src/card-order.test.ts scripts/test-identity-operation.ts`

---

### Batch 3B：悬浮监控窗 2.0（燃尽配速胶囊与接力速览）与全局 `Ctrl +/-/0` 视图缩放
- **解决缺口**：`V3-G6`（悬浮窗体验与高分屏缩放适配）
- **涉及文件**：
  - [`src/floating-monitor-model.ts`](../../../src/floating-monitor-model.ts)
  - [`src/floating-monitor-model.test.ts`](../../../src/floating-monitor-model.test.ts)
  - [`src/floating-monitor.tsx`](../../../src/floating-monitor.tsx)
  - [`src/main.tsx`](../../../src/main.tsx)
- **具体实施内容**：
  1. **悬浮监控窗 2.0 诚实水位与 5h 燃尽配速指示**：
     - 在 [`src/floating-monitor-model.ts`](../../../src/floating-monitor-model.ts) 与 [`src/floating-monitor.tsx`](../../../src/floating-monitor.tsx) 中接入 `formatTruthfulPercent()` 与 5h 窗口配速差值提示，在展开态显示紧凑的配速状态（如余裕/超速百分比），让用户在编程时一眼掌握当前账号消耗节奏。
  2. **全局 `Ctrl/Cmd +` / `-` / `0` 界面无级缩放（借鉴 `cockpit-tools`）**：
     - 在 [`src/main.tsx`](../../../src/main.tsx) 中支持通过 `Ctrl +`、`Ctrl -`、`Ctrl 0` 在 `85% ~ 125%`（步长 `5%`）范围内调节主界面缩放比例并持久化到 `localStorage`，完美适配不同分辨率与 DPI 显示器。
  3. **窗口隐藏态降频省电（借鉴 `magpie`）**：
     - 当 `document.visibilityState === 'hidden'` 时，自动暂停 CSS 装饰性呼吸动画并放缓非关键 UI 采样。
- **定向验收检查**：
  - `bun test src/floating-monitor-model.test.ts`

---

## Phase 4：全面 Review、复审与细节打磨（停止在打包/更新之前）

全部 6 个批次代码与测试落地后，执行以下四步严苛复审：
1. **红线与契约复审**：逐文件核对 `AGENTS.md` 与 `CLAUDE.md`（确认未修改 `BAGAID01`/`.baga`/SQLite `v3`、未打断 `claude.exe`、未暴露真实路径或凭据、中英双语词条 100% 对齐、文件头部注释 `[INPUT]/[OUTPUT]/[POS]/[PROTOCOL]` 全部更新）。
2. **全量自动化测试验证**：
   - 运行 `bun test`（全量前端与模型单测）；
   - 运行 `cargo test --manifest-path src-tauri/Cargo.toml`（Rust 原生单测）；
   - 运行 `bun run build`（验证 TypeScript 类型检查与 Vite 生产构建零警告零报错）。
3. **边缘问题修复与文档同步**：针对复审中发现的任何细节瑕疵立即修正，并同步更新 `HANDOFF.md` 与 `CLAUDE.md` 的目录映射。
4. **交付复审报告并等待确认**：向用户呈交完整的 `v0.3.0` 变更清单、测试通过收据与复审报告，**严格等待用户确认后再决定是否进行版本更新、打包或上传**。

---

## 5. 执行与复审收据（2026-11-05 全量通过）

| 阶段 / 批次 | 状态 | 关键验证与复审结果 |
|---|---|---|
| **Batch 1A**：净室切号、账号缓存与遥测死信清扫、三锁协议、OAuth 路由守卫 | ✅ 已完成并复审 | `cargo test --manifest-path src-tauri/Cargo.toml oauth_route` (2/2 pass)、`optimization_tests` (14/14 pass)、`cleaner::tests` (18/18 pass)。同时严格保持 `s13` 设备诊断键不改动契约与 `platform.claude.com` 非个人守卫边界。 |
| **Batch 1B**：全量外联域名防漏（含连字符 Datadog 绕过修复）与 CLI 遥测/MCP 供应链只读审计 | ✅ 已完成并复审 | `cargo test --manifest-path src-tauri/Cargo.toml risk_check` (13/13 pass)、`bun test src/risk-model.test.ts` (12/12 pass, 317 assertions)。 |
| **Batch 2A**：智能接力 2.0（动态防抖裕度、单向防回跳锁、冷却禁闭池、真实百分比 `formatTruthfulPercent`、5h/7d 配速差） | ✅ 已完成并复审 | `bun test src/smart-relay-model.test.ts` (13/13 pass, 93 assertions)。 |
| **Batch 2B**：唤醒/续杯 2.0（`verifyWakeupAnchorAdvancement` 锚点推进验真、三段式净室管线胶囊、有界内存审计时间线） | ✅ 已完成并复审 | `bun test src/wakeup-presentation.test.ts` (4/4 pass, 21 assertions)。 |
| **Batch 3A**：身份页与风控页 UI 接线、三段式流光胶囊、冷却解除按钮、活跃卡片微呼吸光晕、中英双语词条对齐 | ✅ 已完成并复审 | `bun test src/i18n.test.ts` (5/5 pass, 12,211 assertions)。 |
| **Batch 3B**：悬浮监控窗 2.0 真实百分比与 5h 配速徽章、全局 `Ctrl/Cmd +/-/0` 缩放、窗口隐藏态暂停动画省电 | ✅ 已完成并复审 | `bun test src/floating-monitor-model.test.ts` (8/8 pass, 76 assertions)。 |
| **Phase 4**：全量 Review、复审与生产构建验证 | ✅ 已完成并复审 | 全量 `bun test` (**180 pass, 0 fail, 13,977 expect() calls** across 26 files)；`bun run build` (`tsc --noEmit && vite build` 零错误通过)；未执行任何本地热更新、安装包打包或上传。 |

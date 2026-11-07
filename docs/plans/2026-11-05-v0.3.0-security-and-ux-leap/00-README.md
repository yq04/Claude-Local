<!--
[INPUT]: @MinLiBuilds 推文线索、claude.exe v2.1.318 二进制逆向证据、6 大开源项目（Magpie/Orca/CC Switch/claude-swap/Antigravity-Manager/Cockpit Tools）源码审计、Claude-Local v0.2.7 源码。
[OUTPUT]: v0.3.0 调研结论、双轨跃迁目标、3 阶段 6 批次路线图与执行纪律。
[POS]: 方案总入口；统领 01-FINDINGS.md 与 02-IMPLEMENTATION-PLAN.md。
[PROTOCOL]: 严格遵守 AGENTS.md 与开发纪律：分阶段分批次推进，完成后执行 Review 与复审精修，未获用户最终确认前不执行本地热更新、打包或上传。
-->
# Claude-Local v0.3.0 调研结论与双轨跃迁总览

## 一、 核心调研结论速览

针对 `@MinLiBuilds`（实践哥 Li）关于 Claude Code 封号机制与遥测外联的推文，我们对 `claude.exe v2.1.318`（Bun `1.4.4` 打包二进制）进行了偏移级逆向拆解，并横向剖析了 **6 个优质开源项目**（`yetone/magpie`、`stablyai/orca`、`farion1231/cc-switch`、`realiti4/claude-swap`、`lbjlaq/Antigravity-Manager`、`jlcodes99/cockpit-tools`），得出以下核心结论：

1. **外联域名远不止推文中的 4 个**：
   - 推文 24 小时空载监控仅抓到了 `api.anthropic.com`、`http-intake.logs.us5.datadoghq.com`、`bridge.claudeusercontent.com`、`downloads.claude.ai`。
   - 二进制内嵌的官方主机表 `k$`（偏移 `0x12d76000`）、白名单 `Qn`（`0x1128d391`）与 OAuth/MCP 配置表（`0x110e7150`）实锤存在 **8 大类 35+ 个核心外联域名**，包括连字符拼接域名 `browser-intake-us5-datadoghq.com`、Sentry 崩溃收集 `o1158394.ingest.us.sentry.io`、GrowthBook 实验配置 `cdn.growthbook.io`、Google GCS 插件统计桶 `storage.googleapis.com`、第一方云端 MCP 网关 `mcp-proxy.anthropic.com` / `*.mcp.claude.com`，以及 **`v2.1.318` 新迁移的 OAuth 授权入口 `claude.com/cai/oauth/authorize` 与 `platform.claude.com/oauth/authorize`**。
2. **定位出 `Claude-Local v0.2.7` 的 6 项真实安全与体验缺口（`V3-G1` 至 `V3-G6`）**：
   - **`V3-G1`（最高危·跨号遥测投毒）**：`~/.claude/telemetry/1p_failed_events.*.json` 在切号时未被 `maintain_account_caches()` 清理，导致账号 B 启动后用自身 Token 与代理 IP 自动重发账号 A 残留的 `account_uuid` 遥测批次。
   - **`V3-G2`（最高危·OAuth 守卫串槽）**：[`src-tauri/src/browser/oauth_route.rs`](../../../src-tauri/src/browser/oauth_route.rs) 仅匹配 `claude.ai/oauth/authorize`，漏掉了 `v2.1.318` 新版 `claude.com/cai/oauth/authorize` 与 `platform.claude.com/oauth/authorize`，导致 CLI `/login` 授权请求可能绕过 `IdentityGuard` 落入 Free 养号卡槽位。
   - **`V3-G3`（高危·19 项账号缓存键清理滞后与并发锁缺失）**：`ACCOUNT_KEYS` 目前仅清理 5 项旧键，漏掉了 `v2.1.309~2.1.318` 新增的 `additionalModelOptionsCache`、`modelAccessCache`、`orgModelDefaultCache`、`clientDataCache` 等 19 项账号强绑定缓存键；且缺少对 `.oauth_refresh.lock` / `.storage-write.lock` / `.claude.json.lock` 的协同防御。
   - **`V3-G4`（高危·连字符遥测域名绕过 `DOMAIN-SUFFIX` 与 DNS 预解析探针）**：`DOMAIN-SUFFIX,datadoghq.com` 无法匹配连字符域名 `browser-intake-us5-datadoghq.com`；同时规则缺失 `growthbook.io`、`claude.app/dev/site`；且 `claude.exe` 的 `askResolverAheadOfLogs` 会在发日志前主动发起 UDP/53 DNS 预解析。
   - **`V3-G5`（中危·MCP 供应链与本地权限边界缺少可视化只读审计）**：缺少对 `~/.claude.json` / `.mcp.json` 中未锁定版本 `npx -y`、外联公网 SSE/HTTP MCP、Windows `npx` 缺失 `cmd /c` 包装及自定义 `apiKeyHelper`/`hooks` 的只读安全体检。
   - **`V3-G6`（体验与智能调度跃迁空间）**：智能接力缺少 `claude-swap` 的动态防抖裕度、单向防回跳锁与 `99.9%` 诚实百分比显示；切号与续杯缺少阶段化微动画反馈、前后重置锚点验真条、最佳接力推荐胶囊与历史审计时间线。

---

## 二、 分阶段分批次推进路线图（3 Phases / 6 Batches + Phase 4 复审精修）

我们严格遵循**“只改源码与测试、分阶段分批次验证、全部完成后统一 Review 复审精修、未获用户最终确认前绝不执行本地热更新/打包/上传”**的推进纪律：

| 阶段 | 批次 | 核心交付内容 | 涉及核心模块 |
| :--- | :--- | :--- | :--- |
| **Phase 1**<br>安全、风控与净室隔离内核攻坚 | **Batch 1A**<br>净室切号与 OAuth 路由收口 | 1. 强制清理 `.claude/telemetry/`（`1p_failed_events.*.json`）与 `.claude/statsig/`；<br>2. 扩展 `ACCOUNT_KEYS` 至 19 项 `v2.1.318` 账号缓存键；<br>3. 切号写入前协同检查 `.oauth_refresh.lock` / `.storage-write.lock` / `.claude.json.lock`；<br>4. 修复 [`oauth_route.rs`](../../../src-tauri/src/browser/oauth_route.rs) 支持 `claude.com/cai/oauth/authorize` 与 `platform.claude.com/oauth/authorize`。 | `cleaner_identity.rs`<br>`cleaner_config.rs`<br>`browser/oauth_route.rs` |
| **Phase 1**<br>安全、风控与净室隔离内核攻坚 | **Batch 1B**<br>全域名防漏升级与 MCP/遥测只读审计 | 1. 修复 `browser-intake-us5-datadoghq.com` 连字符绕过（引入 `DOMAIN-KEYWORD,datadoghq` 并补齐 `growthbook.io`、`claude.app/dev/site`）；<br>2. 增强 `inspect_mihomo_config()` 审计遥测与桥接域名规则覆盖率；<br>3. 新增只读式「CLI 遥测免疫盾 & MCP 供应链安全体检」模型与面板展示（含 Windows `npx` `cmd /c` 诊断）。 | `risk-model.ts`<br>`vps.tsx`<br>`risk_check.rs`<br>`claude-residue-panel.tsx` |
| **Phase 2**<br>智能接力 2.0 与唤醒/续杯 2.0 | **Batch 2A**<br>智能接力 2.0 与诚实配速引擎 | 1. 吸收 `claude-swap` 动态防抖裕度 `min(active_headroom * 2.0, active_headroom + 3%)` 与单向防回跳锁 `noReturnAccountId`；<br>2. 新增 `formatTruthfulPercent()`（`99.1%~99.9%` 不虚标为 `100%`）与双窗口燃尽差值指标；<br>3. 新增账号级限流/异常冷却禁闭倒计时（Cooldown）状态与手动一键解除。 | `smart-relay-model.ts`<br>`smart-relay-model.test.ts` |
| **Phase 2**<br>智能接力 2.0 与唤醒/续杯 2.0 | **Batch 2B**<br>唤醒/续杯 2.0 前后锚点验真与审计记录 | 1. 唤醒前后 5h 重置锚点（`resets_at`）对比验真模型（明确标识「已确认开启新 5h 周期 / 沿用既有周期 / 凭证待刷新」）；<br>2. 维护内存/本地有界「切号与续杯审计时间线」记录（触发源、耗时、前后身份、清理项数、锚点变化）。 | `wakeup-presentation.ts`<br>`cleaner-activity.tsx`<br>`identities.tsx` |
| **Phase 3**<br>交互反馈、微动画与浮窗跃迁 | **Batch 3A**<br>身份页微动效、最佳接力胶囊与三段式反馈 | 1. 切号三阶段进度流光胶囊（`进程与三锁校验 ➔ 19项缓存与遥测净室隔离 ➔ 浏览器与出口对齐`）；<br>2. 智能接力开启时的顶部「最佳接力推荐胶囊」与冷却禁闭徽章；<br>3. 当前 CLI 激活卡柔和呼吸光环与诚实配速展示（严格保留既有卡片顺序、166px 高度与按钮几何规范）。 | `identities.tsx`<br>`styles.css`<br>`locales/zh.yaml`<br>`locales/en.yaml` |
| **Phase 3**<br>交互反馈、微动画与浮窗跃迁 | **Batch 3B**<br>悬浮监控窗 2.0 与全局视图缩放 | 1. 悬浮窗（`floating-monitor.tsx`）新增诚实百分比、5h 燃尽配速胶囊与「下一顺位接力候选」速览提示；<br>2. 主窗口支持 `Ctrl/Cmd +` / `-` / `0`（`85% ~ 125%`）无级视图缩放与快捷键复位。 | `floating-monitor-model.ts`<br>`floating-monitor.tsx`<br>`main.tsx` |
| **Phase 4**<br>全面 Review、复审与细节打磨 | **Review & Polish** | 1. 跨模块静态审查与安全红线复核（零敏感信息泄露、零 `claude.exe` 中断、零格式破坏）；<br>2. 全量 `bun test`、`cargo check --tests`、Python 合成测试与 `bun run build` 生产前端构建验证；<br>3. 修复复审发现的边缘 Case，输出复审报告并等待用户最终确认。 | 全仓验证（不热更新、不打包、不上传） |

<!--
[INPUT]: @MinLiBuilds 推文、Claude Code CLI (v2.1.318) 二进制偏移级取证、6 个开源项目（yetone/magpie、stablyai/orca、farion1231/cc-switch、realiti4/claude-swap、lbjlaq/Antigravity-Manager、jlcodes99/cockpit-tools）源码审计、Claude-Local v0.2.7 源码审计。
[OUTPUT]: 推文逆向验真报告、八大类 35+ 外联域名全景表、6 大开源项目技术拆解矩阵、Claude-Local v0.2.7 现存 6 项真实缺口（V3-G1 至 V3-G6）。
[POS]: 技术取证与对标分析文档；支撑 02-IMPLEMENTATION-PLAN.md 的每一项改动决策。
[PROTOCOL]: 严格基于二进制偏移证据与开源仓库源码，不包含个人工作站路径或真实凭据。
-->
# 调研发现：`claude.exe v2.1.318` 逆向验真、全量外联域名版图与六大开源项目深度对标

## 一、 `@MinLiBuilds` 推文的二进制级逆向验真

`@MinLiBuilds` 通过 24 小时进程级流量监控捕获了 Claude Code 的 4 个外联地址（`api.anthropic.com`、`http-intake.logs.us5.datadoghq.com`、`bridge.claudeusercontent.com`、`downloads.claude.ai`），指出其遥测体系涵盖设备/会话标识、账户及组织 UUID、模型版本、系统环境、订阅类型及 Git 信息，并警示了 MCP/Skills 的权限边界风险。

我们对 `claude.exe v2.1.318`（Bun `1.4.4` 单文件可执行程序，`GIT_SHA: ca1fa9dea62c1027756786c841c548788644560d`）的 `.bun` 段进行了精确偏移定位与 JS 字节码还原，得出以下实锤证据：

### 1. 1P 核心遥测管道（`api.anthropic.com/api/event_logging/v2/batch`）
- **代码位置**：`class h_`（偏移 `0x114921dc`）、上下文组装函数 `H_o`（偏移 `0x11490f26`）、Protobuf 序列化定义 `tW`（偏移 `0x1145de2b`）。
- **核心载荷字段**：
  1. **身份与设备锚点**：`device_id`（取自 `~/.claude.json` 中的 64 位 hex `userID`）、`userBucket`（30 桶哈希分片）、`session_id`、`account_uuid`、`organization_uuid`、`email`、`subscriptionType`。
  2. **Git 与工作区指纹**：
     - `rh`（由 `rq()` 生成，对 `git config --get remote.origin.url` 做清洗后取 SHA-256 前 16 位 hex）；
     - `_PROTO_head_sha`（由 `oq()` 执行 `git rev-parse HEAD` 获取）；
     - `_PROTO_is_clean_tree_at_start`、`_PROTO_changed_file_count_at_start`、`_PROTO_untracked_file_count_at_start`（由 `oO()` 统计）。
  3. **宿主环境与工具链**：`terminal`、`shell`、`package_managers`、`runtimes`、`process`（Base64 编码的进程 RSS/Heap/CPU 采样）、`mcp_server_name`、`mcp_tool_name`、`skill_name`。
- **`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` 的双重阻断效应**：
  - 在 `H_o()`（偏移 `0x11490f26`）中，`let U = q()` 检查 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`。当其为真时，**不仅在网络层通过 `Lq()` 关闭 `1p_event_logging`、Datadog 与 GrowthBook，更在本地采集层直接跳过 `rq()`（Git 仓库哈希）、`oq()`（HEAD SHA）、`oO()`（工作区文件状态）、`nq()`（运行时扫描）和 `sq()`（进程指标采样）**。

### 2. Datadog 双通道与主动 DNS 预解析探针（`askResolverAheadOfLogs`）
- **通道 A（运维事件）**：`https://http-intake.logs.us5.datadoghq.com/api/v2/logs`（偏移 `0x1198ae4f`，客户端 Token `Kfo = "pubea5604404508cdd34afb69e6f42a05bc"`），监控 35 类 `tengu_*` 事件（含 `tengu_init`、`tengu_oauth_error`、`tengu_api_error` 等）。
  - **主动 DNS 抢答隐患**：在偏移 `0x1198f347`（`HZt` / `askResolverAheadOfLogs`）中，客户端在发送日志前显式调用 `dns.promises.lookup("http-intake.logs.us5.datadoghq.com")` 与 `new dns.promises.Resolver({timeout: 1000, tries: 1}).resolve4(...)`。若未关闭遥测且未启用 TUN `dns-hijack`，Node 的 `Resolver.resolve4` 会直接向系统网卡 DNS 发起 UDP/53 明文查询。
- **通道 B（错误追踪，推文漏抓的第 5 端点）**：`https://browser-intake-us5-datadoghq.com/api/v2/logs`（偏移 `0x1198fa70`），专用于上报 `claude-code-error-tracking`。
  - **连字符域名绕过 `DOMAIN-SUFFIX` 陷阱**：`browser-intake-us5-datadoghq.com` 的二级域名是 `browser-intake-us5-datadoghq.com`（`us5` 与 `datadoghq` 之间是连字符 `-` 而非点号 `.`）。因此 Clash/Mihomo 规则中的 `DOMAIN-SUFFIX,datadoghq.com` **根本无法匹配该域名**！必须使用 `DOMAIN-KEYWORD,datadoghq` 或显式包含 `browser-intake-us5-datadoghq.com`。

---

## 二、 `claude.exe v2.1.318` 全量八大类 35+ 外联域名全景图

通过提取二进制偏移 `0x12d76000`–`0x12d77b00`（官方内部主机注册表 `k$`）、`0x1128d391`（第一方域名白名单 `Qn`/`Zn`）及 `0x110e7150`（OAuth/MCP 端点表），完整梳理出 `claude.exe v2.1.318` 在不同生命周期下会访问的 **8 大类外联域名**：

| 类别 | 包含域名（二进制硬编码） | 对应二进制偏移 / 常量名 | 触发场景与防漏要求 |
| :--- | :--- | :--- | :--- |
| **1. 核心 API 与 1P 遥测** | `api.anthropic.com`<br>`api-staging.anthropic.com` | `0x12d7640d`<br>`k$.ANTHROPIC_API_HOST` | `/v1/messages`、`/api/event_logging/v2/batch`、`/api/oauth/profile`、`/api/oauth/usage`、`/api/web/domain_info`（`WebFetch` 预检）。必须走静态住宅出口。 |
| **2. OAuth 认证与账号中心**<br>*(含 v2.1.318 重大变更)* | `claude.com`<br>`platform.claude.com`<br>`claude.ai`<br>`clau.de`<br>`sso.claude.com`<br>`portal.anthropic.com`<br>`claude.fedstart.com`<br>`claude.app` / `claude.dev` / `claude.site`<br>`ant.dev` / `anthropic.dev` | `0x110e7150` (`CLAUDE_AI_AUTHORIZE_URL` / `CONSOLE_AUTHORIZE_URL` / `TOKEN_URL`)<br>`0x1128d391` (`Qn`) | **`v2.1.318` 已将个人 OAuth 授权入口迁至 `https://claude.com/cai/oauth/authorize`，Console 授权入口为 `https://platform.claude.com/oauth/authorize`，Token 刷新为 `https://platform.claude.com/v1/oauth/token`**。必须与 CLI 共用同一静态住宅出口，且伴侣浏览器 OAuth 守卫必须全部拦截。 |
| **3. 遥测、崩溃与实验门控** | `http-intake.logs.us5.datadoghq.com`<br>`browser-intake-us5-datadoghq.com`<br>`browser-intake-datadoghq.com`<br>`browser-intake-us3-datadoghq.com`<br>`browser-intake-ap1-datadoghq.com`<br>`browser-intake-ap2-datadoghq.com`<br>`browser-intake-datadoghq.eu`<br>`browser-intake-ddog-gov.com`<br>`o1158394.ingest.us.sentry.io` (`*.sentry.io`)<br>`cdn.growthbook.io` (`growthbook.io`)<br>`statsig.com` / `statsigapi.net`<br>`featuregates.org` / `prodregistryv2.org` | `0x1198ae4f`<br>`0x1198fa70`<br>`0x12d7692f` (`k$.DATADOG_INTAKE_HOSTS`)<br>`0x12d7678b` (`k$.SENTRY_INGEST_HOST`)<br>`0x113bf914` (`GrowthBook`) | 优先通过 `settings.json` 遥测免疫盾在源头关停；网络层通过 `DOMAIN-KEYWORD,datadoghq`、`DOMAIN-SUFFIX,growthbook.io`、`DOMAIN-SUFFIX,sentry.io` 锁死同一静态家宽出口，严防遥测包直连漏出真实 IP。 |
| **4. 更新、模型目录与 GCS 桶** | `downloads.claude.ai`<br>`releases.claude.com`<br>`storage.googleapis.com`<br>`assets.claude.ai`<br>`redirector.gvt1.com` (`*.gvt1.com`) | `0x12d7640d` (`VM_BUNDLE_HOST` / `UPDATE_FEED_HOST` / `GCS_SIGNED_URL_HOST`)<br>`0x11e47a5d` | 拉取 `/claude-code-releases/latest`、`/model-catalog/v1/catalog.json` 以及 GCS 桶 `claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/plugin-stats/plugin-details.json`。 |
| **5. 桥接、沙箱与云端 MCP** | `bridge.claudeusercontent.com`<br>`www.claudeusercontent.com`<br>`*.frame.claudeusercontent.com`<br>`sandbox.claudemcpcontent.com`<br>`*.claudemcpcontent.com`<br>`mcp-proxy.anthropic.com`<br>`slack.mcp.claude.com`<br>`gcal.mcp.claude.com`<br>`gmail.mcp.claude.com`<br>`microsoft365.mcp.claude.com`<br>`drivemcp.googleapis.com`<br>`gmailmcp.googleapis.com` | `0x1261f809`<br>`0x12d766a1`<br>`0x110e73ef` (`MCP_PROXY_URL`)<br>`0x144f1154` | Remote Control 会话桥接、Claude in Chrome、Artifacts 渲染沙箱及第一方托管 MCP 服务。 |
| **6. 插件市场与依赖源** | `api.github.com`<br>`raw.githubusercontent.com`<br>`objects.githubusercontent.com`<br>`gist.githubusercontent.com`<br>`registry.npmjs.org`<br>`pypi.org` / `files.pythonhosted.org` | `0x115c8053` (`tengu_plugin_remote_fetch`)<br>`0x12d77500` (`DEPENDENCY_INSTALL_DOMAINS`) | `/plugin` 官方及第三方市场拉取、MCP 依赖包安装。 |
| **7. 网页 KYC、支付与风控** | `withpersona.com` / `persona.com` / `persona.org`<br>`personacustomer.com` / `persona-cdn.com`<br>`stripe.com` / `stripe.network` / `stripecdn.com`<br>`paypal.com` / `braintreegateway.com`<br>`challenges.cloudflare.com` / `hcaptcha.com`<br>`arkoselabs.com` / `funcaptcha.com`<br>`workos.com` / `authkit.app`<br>`sift.com` / `siftscience.com`<br>`intercom.io` / `intercomcdn.com` | 伴侣浏览器网页登录、订阅升级与身份核验 | 必须与 `claude.ai` 100% 走同一静态住宅出口，严禁跨出口分流。 |
| **8. 多云推理与 Codex 协同** | `aiplatform.googleapis.com`<br>`oauth2.googleapis.com` / `sts.googleapis.com`<br>`telemetry.googleapis.com`<br>`bedrock-runtime.*.amazonaws.com`<br>`openai.com` / `chatgpt.com`<br>`oaistatic.com` / `oaiusercontent.com` / `auth0.com` | `0x12d7692f` (`VERTEX_AUTH_HOSTS`)<br>Codex 协同插件 | 避免双 AI 工具协同开发时因 DNS 或节点切换误伤 Claude 会话。 |

---

## 三、 六大开源标杆项目源码与二进制深度对标

| 项目名称 | 核心模块与代码位置 | 可借鉴的工程设计精华 | 取舍结论 |
| :--- | :--- | :--- | :--- |
| **`farion1231/cc-switch`** | `src-tauri/src/services/claude_account/snapshot/mod.rs`<br>`switch.rs` / `usage.rs` / `claude_mcp.rs` | 1. 维护完整的 **19 项 `ACCOUNT_CACHE_KEYS`**，切号时彻底剥离上一账号在 `.claude.json` 中的模型目录、Feature Gate 与主体指标缓存；<br>2. 切号前同时获取 `.oauth_refresh.lock`、`.storage-write.lock`、`.claude.json.lock` 三把文件锁（含 60s 过期锁清理），防止 CLI 后台进程并发写穿；<br>3. Windows 下 MCP `npx` 缺失 `cmd /c` 包装自动检测。 | **全面采纳**（纳入 Batch 1A 与 Batch 1B）。 |
| **`realiti4/claude-swap`** | `src/claude_swap/pace.py`<br>`src/claude_swap/autoswitch.py` | 1. **诚实百分比 `pct_label`**：`99.0% < pct < 100.0%` 时显示 `99.x%`（绝不四舍五入为 `100%` 掩盖剩余裕度）；<br>2. **动态切换防抖裕度 `_all_above_margin_met`**：`margin = min(active_headroom * 2.0, active_headroom + 0.03)`，候选账号必须在 5h 与 7d 两个窗口同时超出当前账号该裕度才触发切换；<br>3. **单向防回跳锁 `noReturnAccount`**：因打满退出的账号在下一周期完全重置前锁定不回跳。 | **全面采纳**（纳入 Batch 2A 与 Batch 3A/3B）。 |
| **`lbjlaq/Antigravity-Manager`** | `docs/CLAUDE_CODE_10_VERSIONS_DIFF.md`<br>`src/components/accounts/QoSStatusBadge.tsx`<br>`BestAccounts.tsx` | 1. 顶部「最佳接力账号推荐胶囊」直观展示评分最优的下一顺位身份；<br>2. 账号限流/异常时的冷却禁闭倒计时徽章（Cooldown Badge）与手动一键解除；<br>3. 当前活跃卡片柔和呼吸光晕。 | **采纳 UI 与状态机设计**（纳入 Batch 2A 与 Batch 3A）；不采纳其 MITM 本地 API 网关架构。 |
| **`jlcodes99/cockpit-tools`** | `crates/cockpit-core/src/modules/antigravity_switch_history.rs`<br>`src/App.tsx` | 1. 结构化记录每次切号与唤醒的触发源（手动/智能接力）、前后身份、耗时与结果摘要；<br>2. 全局 `Ctrl/Cmd +` / `-` / `0` 界面缩放快捷键与持久化。 | **全面采纳**（纳入 Batch 2B 与 Batch 3B）。 |
| **`yetone/magpie`** | `docs/session-relocation.md`<br>`docs/subsystems/mcp-router.md`<br>`docs/subsystems/gui-shell.md` | 1. MCP 工具暴露面与外联源安全审计；<br>2. 窗口最小化/隐藏至托盘时自动降频以降低 WebView2 内存与 CPU 占用。 | **采纳 MCP 只读审计与隐藏态减负**（纳入 Batch 1B 与 Batch 3B）。 |
| **`stablyai/orca`** | `docs/relay-region-correction/RELAY-REGION-CORRECTION-PLAN.md` | 代理出口区域漂移检测与风控联动提示。 | **与既有 Kill-Switch 和预检融合**。 |

---

## 四、 `Claude-Local v0.2.7` 现存 6 项真实缺口定级（`V3-G1` 至 `V3-G6`）

1. **`V3-G1`（最高危）：`~/.claude/telemetry/1p_failed_events.*.json` 跨账号遥测投毒漏洞**
   - **现状**：`claude.exe` 的 `class h_`（`0x114921dc`）在网络切换或进程退出未完成上报时，会将含账号 A `account_uuid`、`organization_uuid`、`user_id` 的批次写入 `~/.claude/telemetry/1p_failed_events.<sessionId>.<runId>.json`。切换到账号 B 后，`h_.retryPreviousBatches()` 会用账号 B 的 OAuth Bearer Token 将账号 A 的 UUID 发送至 `api.anthropic.com/api/event_logging/v2/batch`。
   - **代码缺口**：[`src-tauri/src/cleaner_identity.rs`](../../../src-tauri/src/cleaner_identity.rs) 的 `maintain_account_caches()` 仅清理了 `.claude/plugins/synced` 与 `.claude/cache/model-catalog`，未清理 `.claude/telemetry` 与 `.claude/statsig`。
2. **`V3-G2`（最高危）：[`src-tauri/src/browser/oauth_route.rs`](../../../src-tauri/src/browser/oauth_route.rs) OAuth 守卫未覆盖 `v2.1.318` 新授权域名**
   - **现状**：`authorization_endpoint()` 仅允许 `https://claude.ai/oauth/authorize`，而 `claude.exe v2.1.318`（`0x110e7150`）已将个人订阅授权地址改为 `https://claude.com/cai/oauth/authorize`，Console 授权地址为 `https://platform.claude.com/oauth/authorize`。这会导致新版 CLI 拉起伴侣浏览器登录时绕过 `IdentityGuard`，存在落入 Free 养号槽位的串槽风险。
3. **`V3-G3`（高危）：`.claude.json` 账号缓存键清理滞后（5 项 vs 19 项）且缺少三锁协同**
   - **现状**：[`src-tauri/src/cleaner_config.rs`](../../../src-tauri/src/cleaner_config.rs) 的 `ACCOUNT_KEYS` 与 [`src-tauri/src/cleaner_identity.rs`](../../../src-tauri/src/cleaner_identity.rs) 的 `maintain_account_caches()` 仅清理 5 个旧键，未清理 `v2.1.318` 的 `additionalModelOptionsCache`、`modelAccessCache`、`orgModelDefaultCache`、`clientDataCache`、`clientDataCacheSlots`、`metricsStatusCacheByPrincipal`、`penguinModeOrgEnabled`、`claudeAiMcpEverConnected` 等账号级缓存键；且写入前未检查 `.oauth_refresh.lock` 与 `.storage-write.lock`。
4. **`V3-G4`（高危）：连字符域名 `browser-intake-us5-datadoghq.com` 绕过 `DOMAIN-SUFFIX` 及 `growthbook.io` 缺失**
   - **现状**：[`src/risk-model.ts`](../../../src/risk-model.ts) 与 [`src/vps.tsx`](../../../src/vps.tsx) 使用 `DOMAIN-SUFFIX,datadoghq.com`，无法匹配连字符域名 `browser-intake-us5-datadoghq.com`；同时漏掉了 `growthbook.io`、`claude.app`、`claude.dev`、`claude.site`；且 [`src-tauri/src/risk_check.rs`](../../../src-tauri/src/risk_check.rs) 的 `inspect_mihomo_config()` 未审计遥测与桥接域名规则是否配齐。
5. **`V3-G5`（中危）：缺少只读式「CLI 遥测免疫盾 & MCP 供应链/权限边界审计器」**
   - **现状**：[`src/claude-residue-panel.tsx`](../../../src/claude-residue-panel.tsx) 能够清理磁盘残留，但尚未直观展示当前 `~/.claude/settings.json` 是否已激活三项遥测免疫环境变量，也未对 `~/.claude.json` / `.mcp.json` 中的高风险 MCP 配置（未锁版本的 `npx -y`、外联 HTTP/SSE MCP、Windows 下缺失 `cmd /c` 的 `npx`、自定义 `apiKeyHelper`/`hooks`）进行只读审计提示。
6. **`V3-G6`（体验与智能调度）：智能接力防抖、续杯前后锚点验真与切号三段式反馈待跃迁**
   - **现状**：[`src/smart-relay-model.ts`](../../../src/smart-relay-model.ts) 尚未引入动态防抖裕度、单向防回跳锁、冷却禁闭管理与 `99.9%` 诚实百分比；唤醒/续杯缺少前后 `resets_at` 锚点推进验真对比；切号过程缺少三阶段可视化进度胶囊与历史审计时间线。

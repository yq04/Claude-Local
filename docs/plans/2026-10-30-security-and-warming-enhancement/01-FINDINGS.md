<!--
[INPUT]: GitHub 开源项目源码/README、X 帖子原文（agent-reach 抓取）、项目源码深度审计、历史 S01–S12 采纳记录复核。
[OUTPUT]: 分层级事实与推断的调研发现，GitHub 对比表，社区知识三层分析，现有能力精准盘点，经源码校准的安全缺口识别。
[POS]: 调研证据（源码校准版）；与实施计划分开阅读。
[PROTOCOL]: 区分已证事实、合理推测和社区玄学。不把已修复历史项误列为缺口，不把搜索摘要扩大为官方事实。
-->
# 调研发现与开源对比（源码校准版）

日期：2026-10-30（经前后端源码二次审计校准）。

## 1. GitHub 开源项目分析

### 1.1 多账号切换工具对比

调研覆盖 10+ 个 GitHub 项目，以下为与 Claude-Local 功能最相关的对比：

| 项目 | 语言/平台 | 核心能力 | Stars | Claude-Local 对比 |
|------|----------|---------|-------|------------------|
| [realiti4/claude-swap](https://github.com/realiti4/claude-swap) | Python | 无需 logout 切换、5h/7d 额度仪表盘、自动限额轮换（`--strategy best/next-available`）、并行会话、VS Code 集成 | 高 | Claude-Local 切号更安全（加密归档），且在 `identities.tsx` 已实现每卡 5h/7d 进度、周配速刻度与“切到最优号”推荐 |
| [stephengardner/claude-auto-switch](https://github.com/stephengardner/claude-auto-switch) (ccx) | Node.js | 读取 transcript 检测限额、自动换号、`--resume` 保持上下文、live dashboard、`CLAUDE_CONFIG_DIR` 隔离 | 高 | Claude-Local 已支持受控会话交接与独立统计账本 |
| [XueshiQiao/CCSwitcher](https://github.com/XueshiQiao/CCSwitcher) | Swift/macOS | 菜单栏一键切换、实时额度追踪、会话成本追踪 | 中 | Claude-Local 在 `usage-statistics.tsx` 与悬浮 HUD 已实现官方 API 等值 USD 成本与缓存节省分析 |
| [SimpliAj/claude-account-switcher](https://github.com/SimpliAj/claude-account-switcher) | Chrome 扩展 | Cookie 快照保存/恢复、免登出换号 | 中 | Claude-Local 通过每卡独立 Chromium profile 与确定性 seed 更彻底地解决了此问题 |
| [ItsMeEAera/claude-switcher](https://github.com/ItsMeEAera/claude-switcher) | Go TUI | API Key 存入 OS 凭据管理器（Keychain/Credential Manager）、快速切换 | 中 | Claude-Local 采用 `BAGAID01` + AES-256-GCM 独立保险库 |
| [cody-hutson/claude-account-switcher](https://github.com/cody-hutson/claude-account-switcher) | Bash/jq | 隔离 billing profile、共享 skills/hooks/sessions | 低 | Claude-Local 已更完善地实现了此能力 |
| [ming86/cc-account-switcher](https://github.com/ming86/cc-account-switcher) | Shell | 凭据快照切换 | 低 | 功能较简单 |
| [kaitranntt/ccs](https://github.com/kaitranntt/ccs) | CLI | 多服务代理切换（Claude/Gemini/Copilot/OpenRouter） | 中 | 多服务支持超出 Claude-Local 范围 |

### 1.2 环境安全与防封工具对比

| 项目/来源 | 核心能力 | Claude-Local 对比 |
|----------|---------|------------------|
| **claude-switcher（11项审计版）** | 启动前 11 项环境指纹审计、手写 STUN 协议栈检测 WebRTC、**Kill-Switch 断网急停**（代理掉线或 IP 漂移立即切断网络） | Claude-Local 有 20+6 项核验（更全），需补充**伴侣浏览器运行期按需守护的 Kill-Switch 与地区一致性监测** |
| **ai-coding-anti-ban** | 拆解 Claude Code 时区/代理黑名单探测逻辑、四步 SOP 防封方案、标准化排查脚本 | SOP 标准化思路可作为非阻断参考融入养号卡编辑弹窗 |
| **claude-env-cleanup** | 只读安全审计（时区/语言/DNS/路由/出口）、认证缓存清理 | Claude-Local 的 `cleaner_identity.rs` 已更完整（1572 行，含窄缓存维护与诊断清理） |

### 1.3 备份与迁移工具

| 项目 | 核心能力 | Claude-Local 对比 |
|------|---------|------------------|
| **claude-folder-move** | 项目迁移 TUI、自动重定向状态、SHA256 验证、自动回滚 | Claude-Local `backup.rs` 已有 staging + SHA256 验证 + 私有目录恢复，可扩展纳入养号与手动订阅元数据 |
| **claude-sesh-mover** | 会话导入/导出/跨 profile 迁移 | Claude-Local 已有手动任务交接（`task-handoff.tsx`） |

### 1.4 Claude-Local 的独特优势（其他项目均不具备）

| 能力 | Claude-Local | 最接近的开源替代 |
|------|-------------|----------------|
| 加密身份归档 (BAGAID01/AES-256-GCM) | ✅ 分帧认证、防篡改截断 | ❌ 多数为明文 JSON |
| 确定性指纹 + 真实硬件渲染模式 | ✅ `--fingerprint={seed}` + 默认 `native_graphics=true`（`--disable-spoofing=font,audio,gpu,canvas,clientrects` 避免合成噪声触发反爬） | ❌ 需外挂指纹浏览器或易被 Cloudflare 识别 |
| WebRTC/UDP 泄露防护 | ✅ `disable_non_proxied_udp` + `--disable-quic` | 部分有简单检测 |
| 20+6 项风控核验 | ✅ DNS/TUN/strict-route/IP出口/浏览器指纹 | 最多 11 项审计 |
| 四阶段养号管理 | ✅ `unregistered` → `kyc_passed` → `warming_free` → `pro_ready` | ❌ |
| Python 单写者额度账本 | ✅ 跨进程锁 + 原子替换 + 较新锚点优先 | ❌ |
| 账号切号窄缓存维护与隔离 | ✅ 切号仅维护账号绑定缓存白名单，保护原始会话不被改写 | 部分有简单清理 |

---

## 2. X/Twitter 社区防封知识三层分析

### 数据来源

使用 agent-reach 工具抓取以下 6 篇 X 帖子原文并交叉验证：

1. **夙愿学长**（@suyuan1711）：封 30+ 号实战教程，完整注册→订阅→Max 流程
2. **make_claude**（@make_claude）：18 条“积分制”框架
3. **Flynn**（@fly3nn）：封号说法验真表——官方实锤/实测/纯玄学三档分类，**可信度最高**
4. **爱出海**（@ai_chuhai）：逐条评价 make_claude 的 18 条，区分行业通用逻辑和具体细节
5. **逸尘**（@gengdaJ）：注册/订阅/过KYC 完整教程
6. **SuSu_酥酥**（@NFT_Chen）：积分制总结帖

### 三层可信度分析

#### 第一层：官方实锤（条款/文档明确写明）

| 封号原因 | 官方来源 | 对 Claude-Local 的影响 |
|---------|---------|----------------------|
| 不支持地区使用（物理所在地） | `anthropic.com/supported-countries` 条款明确要求受支持国家/地区 | **核心风险**：代理掉线直连或 DNS 泄露会暴露非支持地区位置 |
| 共享/转卖/拼车账号 | Consumer Terms | 单人顺序使用多账号不属于共享，但需防环境串号 |
| 订阅号接中转/反代 | Legal Compliance：`x-anthropic-billing-header` 含 `cc_gateway` | 不做 API 中转即可规避 |
| 自动化注册 | Terms 禁止 "automated or non-human means" | 养号流程坚持人工注册与操作，绝不自动化 |
| 反复违规内容 | Usage Policy：先警告再封 | 与本工具无关 |
| 手机号限制 | 支持地区号码，同号最多绑定有限账号 | 可在养号卡备注记录关联信息 |

*(注：社区帖引述的透明度报告统计称半年封禁逾千万账号、申诉率约 3.5%、申诉推翻率约 10.6%，该数据来自社区对透明度报告的转述汇总，作为背景参考。)*

#### 第二层：行业通用反欺诈逻辑（合理推测但非官方公开规则）

| 因素 | 可信度 | 评估依据 | 对 Claude-Local 的启发 |
|------|--------|---------|----------------------|
| 出口国家与时区稳定性 | ✅ 高 | 账号在短期内跨国跳变（如美国家宽突然直连回国）是典型风控信号 | **养号卡国家/时区锁定监测（F3）**与**断线保护（F1）**是最高优先级 |
| 老号容错高于新号 | ✅ 高 | 账号存续时间是反欺诈基础信任维度 | 养号卡 Day N 自然日追踪有实际价值 |
| 支付卡与突发升级风控 | ✅ 合理 | 刚注册立即高额升级易触发支付审查 | 在养号编辑弹窗参考建议中非阻断提示“建议先稳定使用再升级” |
| 突发极限消耗 | ✅ 合理 | 单次瞬间打满全部窗口特征明显 | 在额度详情提供非阻断的使用节奏参考提示（F5） |

#### 第三层：社区玄学（无官方依据或已被反例证伪，绝不写入校验逻辑）

| 说法 | 可信度 | 反驳依据 |
|------|--------|---------|
| Linux 减分 / Desktop 加分 | ❌ | 无依据，相关性≠因果性 |
| 记忆功能加分 / Fable 减分 | ❌ | 产品功能与反欺诈风控相互独立 |
| 必须住宅 IP 否则必封 | ❌ | 存在大量稳定固定机房 IP 长期正常使用的反例 |
| 时区/语言不一致直接封号 | ❌ | 官方已推出多语言界面，但保持环境一致仍有辅助益处 |
| 苹果内购更防封 | ❌ | 无证据，条款明确违规封号不退款 |

---

## 3. 项目现有安全能力源码级盘点（已校准）

### 3.1 已实现的安全能力

| 层面 | 能力 | 准确代码位置 | 状态 |
|------|------|---------|------|
| 浏览器独立代理 | per-profile `config.proxy` → `--proxy-server` + `--host-resolver-rules` | [config.rs:183-198](../../../src-tauri/src/browser/config.rs#L183-L198) | ✅ 已实现 |
| 确定性指纹种子 | `--fingerprint={config.seed}` 及平台/并发/语言/时区参数 | [config.rs:157-168](../../../src-tauri/src/browser/config.rs#L157-L168) | ✅ 已实现 |
| 真实硬件渲染防反爬 | `native_graphics=true` 时传 `--disable-spoofing=font,audio,gpu,canvas,clientrects` 关闭合成噪声 | [config.rs:174-181](../../../src-tauri/src/browser/config.rs#L174-L181) | ✅ 已实现 |
| WebRTC 防泄露 | `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` | [config.rs:169-170](../../../src-tauri/src/browser/config.rs#L169-L170) | ✅ 已实现 |
| QUIC 禁用 | `--disable-quic` | [config.rs:171](../../../src-tauri/src/browser/config.rs#L171) | ✅ 已实现 |
| 地区与时区推导 | `Config::region` 匹配 13 个预设国家与时区 | [config.rs:63-93](../../../src-tauri/src/browser/config.rs#L63-L93)、[regions.rs:213-292](../../../src-tauri/src/regions.rs#L213-L292) | ✅ 已实现 |
| DNS 与 TUN 审计 | Mihomo YAML 解析、TUN 适配器与辅助明文 DNS 检测 | [risk_check.rs:26-57, 284-511, 810-850](../../../src-tauri/src/risk_check.rs#L26-L57)、[risk-model.ts:365-401](../../../src/risk-model.ts#L365-L401) | ✅ 已实现 |
| TUN `strict-route` 检测 | `tun_strict_route === false` 时警告 | [risk_check.rs:37, 394, 961-971](../../../src-tauri/src/risk_check.rs#L37)、[risk-model.ts:382-383](../../../src/risk-model.ts#L382-L383) | ✅ 检测已实现 |
| HTTP 出口一致性采样 | `current_risk_browser_context` + `risk_probe_consistency` 冻结 slot/配置/路由，前后变化拒收 | [browser/mod.rs:171-299](../../../src-tauri/src/browser/mod.rs#L171-L299)、[risk_check.rs:1136-1167](../../../src-tauri/src/risk_check.rs#L1136-L1167) | ✅ 已实现 |
| 切号窄缓存维护与只读安全 | 切号仅调 `maintain_account_caches`；`Store::open` 与 `save_inner` 零会话改写（S01/S02 已完成） | [cleaner_identity.rs:1055-1148](../../../src-tauri/src/cleaner_identity.rs#L1055-L1148)、[store.rs:36-109](../../../src-tauri/src/identities/store.rs#L36-L109) | ✅ 已实现 |
| 身份加密归档与短邮箱打码 | `BAGAID01`/AES-256-GCM、`mask_email` 短邮箱打码（S03/S11 已完成） | [codec.rs](../../../src-tauri/src/identities/codec.rs)、[browser/mod.rs:917-965](../../../src-tauri/src/browser/mod.rs#L917-L965) | ✅ 已实现 |
| 窄 OAuth 授权分流 | 养号选中时验证 PKCE S256 窄形状并分流至当前 CLI 既有独立 profile | [oauth_route.rs:43-187](../../../src-tauri/src/browser/oauth_route.rs#L43-L187) | ✅ 已实现 |
| 正式卡 5h/7d 额度与切到最优号 | 每卡展示 5h/7d 进度、周配速刻度、重置时间，并提供 `recommendSaved`“切到最优号” | [identities.tsx:49-109, 321-332, 1617-1621](../../../src/identities.tsx#L49-L109) | ✅ 已实现 |

### 3.2 经校准的真实待补齐缺口（排除已修复的 S01/S02/S03/S11）

| 编号 | 真实缺口 | 优先级 | 校准说明 |
|------|------|---------|------|
| **G1** | **伴侣浏览器运行期缺少代理断线/国家漂移急停（Kill-Switch）** | 🔴 P0 | 需按需守护所有运行中的受管伴侣浏览器槽位，触发后不锁死后续重开操作（对应 **F1**） |
| **G2** | **`strict-route=false` 缺少分层修复向导与一键复核 UI** | 🔴 P0 | 尊重 Clash Verge 三层配置机制，提供 Merge 覆写片段复制与一键复核闭环（对应 **F2**） |
| **G3** | **养号卡未记录锁定国家/时区，打开前缺少漂移预检** | 🔴 P0 | `network::probe()` 返回 2 位国家码（`"US"`）与 IANA 时区，应据此记录与对比（对应 **F3**） |
| **G4** | **养号卡编辑弹窗缺少四阶段参考建议面板** | 🟡 P1 | 放入编辑弹窗折叠面板，严守 `180×286` 卡片尺寸红线，标注“参考建议”（对应 **F4**） |
| **G5** | **正式卡额度详情缺少高负载使用节奏提示** | 🟡 P1 | 当 5h 使用率 ≥ 85% 或 7d 显著超前配速时在详情弹窗给出温和提示（对应 **F5**） |
| **G6** | **保险库备份未纳入 `warming_cards.json` 与 `manual_subscriptions.json`** | 🟡 P1 | 必须同步修改 `collect_files`、`verify_staged` 白名单与 `restore` 拷贝逻辑（对应 **F6**） |
| **G7** | **`CLAUDE_CONFIG_DIR` 独立目录隔离尚未评估** | 🟢 P2 | `cleaner_identity::root()` 指向 `%USERPROFILE%`，单活跃 CLI 模型下仅做低优探索（对应 **F7**） |
